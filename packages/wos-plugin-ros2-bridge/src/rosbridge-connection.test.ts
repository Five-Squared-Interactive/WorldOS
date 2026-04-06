// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, WebSocket as WsWebSocket } from 'ws';
import { RosbridgeConnection } from './rosbridge-connection.js';
import type { ConnectionConfig } from './types/rosbridge.js';

function createConfig(port: number): ConnectionConfig {
  return {
    url: `ws://127.0.0.1:${port}`,
    topics: [{ name: '/joint_states', type: 'sensor_msgs/JointState' }],
    services: ['/set_mode'],
  };
}

describe('RosbridgeConnection', () => {
  let wss: WebSocketServer;
  let port: number;
  let conn: RosbridgeConnection;

  beforeEach(async () => {
    // Start a mock WS server on random port
    wss = new WebSocketServer({ port: 0 });
    const addr = wss.address();
    port = typeof addr === 'object' ? addr.port : 0;
  });

  afterEach(() => {
    conn?.disconnect();
    wss?.close();
  });

  it('connects and transitions to connected state', async () => {
    conn = new RosbridgeConnection('arm-1', createConfig(port));
    const connectedSpy = vi.fn();
    conn.on('connected', connectedSpy);

    await conn.connect();

    expect(conn.getState()).toBe('connected');
    expect(connectedSpy).toHaveBeenCalledOnce();
    expect(conn.getConnectedSince()).toBeTypeOf('number');
  });

  it('disconnects cleanly', async () => {
    conn = new RosbridgeConnection('arm-1', createConfig(port));
    await conn.connect();

    conn.disconnect();

    expect(conn.getState()).toBe('disconnected');
    expect(conn.getConnectedSince()).toBeNull();
  });

  it('sends and receives messages', async () => {
    const serverReceived: string[] = [];

    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        serverReceived.push(data.toString());
        // Echo back a publish message
        ws.send(JSON.stringify({ op: 'publish', topic: '/test', msg: { value: 42 } }));
      });
    });

    conn = new RosbridgeConnection('arm-1', createConfig(port));
    await conn.connect();

    const messagePromise = new Promise<void>((resolve) => {
      conn.on('message', (msg) => {
        expect(msg.op).toBe('publish');
        expect(msg.topic).toBe('/test');
        resolve();
      });
    });

    conn.send({ op: 'subscribe', topic: '/test', type: 'std_msgs/String' });
    await messagePromise;

    expect(serverReceived.length).toBeGreaterThan(0);
    expect(JSON.parse(serverReceived[0]).op).toBe('subscribe');
  });

  it('tracks subscriptions', async () => {
    conn = new RosbridgeConnection('arm-1', createConfig(port));
    await conn.connect();

    conn.subscribeTopic('/joint_states', 'sensor_msgs/JointState', 100);
    conn.subscribeTopic('/odom', 'nav_msgs/Odometry');

    expect(conn.getSubscribedTopics()).toEqual(['/joint_states', '/odom']);

    conn.unsubscribeTopic('/odom');
    expect(conn.getSubscribedTopics()).toEqual(['/joint_states']);
  });

  it('tracks advertised topics', async () => {
    conn = new RosbridgeConnection('arm-1', createConfig(port));
    await conn.connect();

    conn.advertise('/cmd_vel', 'geometry_msgs/Twist');
    expect(conn.getAdvertisedTopics()).toEqual(['/cmd_vel']);

    // Duplicate advertise should be idempotent
    conn.advertise('/cmd_vel', 'geometry_msgs/Twist');
    expect(conn.getAdvertisedTopics()).toEqual(['/cmd_vel']);

    conn.unadvertise('/cmd_vel');
    expect(conn.getAdvertisedTopics()).toEqual([]);
  });

  it('rejects connect on invalid URL', async () => {
    conn = new RosbridgeConnection('arm-1', {
      url: 'ws://127.0.0.1:1', // Nothing listening
      topics: [],
      services: [],
    });

    await expect(conn.connect()).rejects.toThrow();
    expect(conn.getState()).toBe('disconnected');
  });

  it('attempts reconnection with backoff on unexpected disconnect', async () => {
    conn = new RosbridgeConnection('arm-1', createConfig(port), {
      maxReconnectAttempts: 2,
      maxReconnectDelay: 500,
    });

    await conn.connect();
    expect(conn.getState()).toBe('connected');

    const reconnectingSpy = vi.fn();
    conn.on('reconnecting', reconnectingSpy);

    // Force-close all server clients to trigger disconnect
    for (const client of wss.clients) {
      client.close();
    }

    // Wait for reconnecting event
    await new Promise<void>((resolve) => {
      conn.on('reconnecting', () => resolve());
    });

    expect(conn.getState()).toBe('reconnecting');
    expect(reconnectingSpy).toHaveBeenCalled();
  });

  it('returns false when sending while disconnected', () => {
    conn = new RosbridgeConnection('arm-1', createConfig(port));
    expect(conn.send({ op: 'subscribe', topic: '/test', type: 'std_msgs/String' })).toBe(false);
  });

  it('exposes robotName and url', () => {
    conn = new RosbridgeConnection('arm-1', createConfig(port));
    expect(conn.robotName).toBe('arm-1');
    expect(conn.getUrl()).toBe(`ws://127.0.0.1:${port}`);
  });

  it('calls callService correctly', async () => {
    const serverReceived: string[] = [];
    wss.on('connection', (ws) => {
      ws.on('message', (data) => serverReceived.push(data.toString()));
    });

    conn = new RosbridgeConnection('arm-1', createConfig(port));
    await conn.connect();

    conn.callService('/set_mode', { mode: 1 }, 'req-1');

    // Give time for message to arrive
    await new Promise((r) => setTimeout(r, 50));

    const sent = JSON.parse(serverReceived[0]);
    expect(sent.op).toBe('call_service');
    expect(sent.service).toBe('/set_mode');
    expect(sent.args).toEqual({ mode: 1 });
    expect(sent.id).toBe('req-1');
  });

  it('replays subscriptions and advertises after reconnect', async () => {
    const serverMessages: string[][] = [];
    let connectionCount = 0;

    wss.on('connection', (ws) => {
      const msgs: string[] = [];
      serverMessages.push(msgs);
      connectionCount++;
      ws.on('message', (data) => msgs.push(data.toString()));
    });

    conn = new RosbridgeConnection('arm-1', createConfig(port), {
      maxReconnectAttempts: 5,
      maxReconnectDelay: 200,
    });

    await conn.connect();
    conn.subscribeTopic('/joint_states', 'sensor_msgs/JointState');
    conn.advertise('/cmd_vel', 'geometry_msgs/Twist');

    // Wait for messages to arrive on server
    await new Promise((r) => setTimeout(r, 50));

    // Force disconnect all server clients (simulating drop)
    for (const client of wss.clients) {
      client.close();
    }

    // Wait for reconnect
    await new Promise<void>((resolve) => {
      conn.on('connected', () => {
        if (connectionCount >= 2) resolve();
      });
    });

    // Wait for replayed messages
    await new Promise((r) => setTimeout(r, 100));

    // Second connection should have received replayed subscribe + advertise
    const reconnectMsgs = serverMessages[1];
    expect(reconnectMsgs.length).toBeGreaterThanOrEqual(2);

    const ops = reconnectMsgs.map((m) => JSON.parse(m));
    expect(ops.some((o: Record<string, unknown>) => o.op === 'subscribe' && o.topic === '/joint_states')).toBe(true);
    expect(ops.some((o: Record<string, unknown>) => o.op === 'advertise' && o.topic === '/cmd_vel')).toBe(true);
  });
});
