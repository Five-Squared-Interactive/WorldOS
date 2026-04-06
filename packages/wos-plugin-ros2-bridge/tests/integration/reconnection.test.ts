// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { MockRosbridgeServer } from './mock-rosbridge-server.js';
import { RosbridgeConnection } from '../../src/rosbridge-connection.js';

describe('Integration: Reconnection', () => {
  let server: MockRosbridgeServer;
  let conn: RosbridgeConnection;

  afterEach(async () => {
    conn?.disconnect();
    await server?.stop();
  });

  it('reconnects after server disconnect and replays subscriptions', async () => {
    server = new MockRosbridgeServer();
    await server.start();

    conn = new RosbridgeConnection(
      'recon-bot',
      { url: server.url, topics: [], services: [] },
      { maxReconnectAttempts: 5, maxReconnectDelay: 200 },
    );

    await conn.connect();
    expect(conn.getState()).toBe('connected');

    // Subscribe to a topic
    conn.subscribeTopic('/odom', 'nav_msgs/Odometry');
    conn.advertise('/cmd_vel', 'geometry_msgs/Twist');

    // Disconnect all clients (simulate server failure)
    server.disconnectAll();

    // Wait for reconnecting state
    await new Promise<void>((resolve) => {
      conn.on('reconnecting', () => resolve());
    });

    expect(conn.getState()).toBe('reconnecting');

    // Wait for reconnection to succeed (server is still up, just dropped clients)
    await new Promise<void>((resolve) => {
      conn.on('connected', () => resolve());
    });

    expect(conn.getState()).toBe('connected');

    // Tracked subscriptions should still be present
    expect(conn.getSubscribedTopics()).toContain('/odom');
    expect(conn.getAdvertisedTopics()).toContain('/cmd_vel');
  }, 10000);

  it('gives up after max reconnection attempts', async () => {
    server = new MockRosbridgeServer();
    await server.start();
    const serverPort = server.port;

    conn = new RosbridgeConnection(
      'fail-bot',
      { url: `ws://127.0.0.1:${serverPort}`, topics: [], services: [] },
      { maxReconnectAttempts: 2, maxReconnectDelay: 100 },
    );

    // Suppress error events during reconnection
    conn.on('error', () => {});

    await conn.connect();

    // Force-close clients then stop server
    server.disconnectAll();
    await server.stop();

    // Wait for disconnected state (after max attempts exhausted)
    await new Promise<void>((resolve) => {
      const checkDisconnected = () => {
        if (conn.getState() === 'disconnected') {
          resolve();
        }
      };
      conn.on('disconnected', checkDisconnected);
      // Also check periodically in case event was missed
      const interval = setInterval(() => {
        if (conn.getState() === 'disconnected') {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });

    expect(conn.getState()).toBe('disconnected');
  }, 15000);
});
