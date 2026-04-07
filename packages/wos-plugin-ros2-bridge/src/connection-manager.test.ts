// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { ConnectionManager } from './connection-manager.js';
import type { ROS2BridgeConfig } from './types/rosbridge.js';

const mockLogger = { info: vi.fn(), error: vi.fn(), debug: vi.fn() };

function createMockMqtt() {
  return {
    publishRaw: vi.fn().mockResolvedValue(undefined),
    subscribeWithHandler: vi.fn().mockResolvedValue(undefined),
    respond: vi.fn().mockResolvedValue(undefined),
    respondError: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ConnectionManager', () => {
  let servers: WebSocketServer[] = [];

  function startMockServer(): Promise<{ wss: WebSocketServer; port: number }> {
    return new Promise((resolve) => {
      const wss = new WebSocketServer({ port: 0 }, () => {
        const addr = wss.address();
        const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
        servers.push(wss);
        resolve({ wss, port });
      });
    });
  }

  afterEach(() => {
    for (const s of servers) s.close();
    servers = [];
  });

  it('starts and stops multiple robots', async () => {
    const { port: port1 } = await startMockServer();
    const { port: port2 } = await startMockServer();

    const config: ROS2BridgeConfig = {
      connections: {
        'arm-1': { url: `ws://127.0.0.1:${port1}`, topics: [], services: [] },
        'arm-2': { url: `ws://127.0.0.1:${port2}`, topics: [], services: [] },
      },
    };

    const mqtt = createMockMqtt();
    const manager = new ConnectionManager(config, mqtt as any, () => false, mockLogger);

    await manager.startAll();

    expect(manager.getConnectedCount()).toBe(2);
    expect(manager.getTotalCount()).toBe(2);

    const statuses = manager.getStatus();
    expect(statuses).toHaveLength(2);
    expect(statuses[0].state).toBe('connected');
    expect(statuses[1].state).toBe('connected');

    await manager.stopAll();
    expect(manager.getTotalCount()).toBe(0);
  });

  it('handles individual robot connection failure without blocking others', async () => {
    const { port: goodPort } = await startMockServer();

    const config: ROS2BridgeConfig = {
      connections: {
        'arm-good': { url: `ws://127.0.0.1:${goodPort}`, topics: [], services: [] },
        'arm-bad': { url: `ws://127.0.0.1:1`, topics: [], services: [] }, // Will fail
      },
    };

    const mqtt = createMockMqtt();
    const manager = new ConnectionManager(config, mqtt as any, () => false, mockLogger);

    await manager.startAll();

    // arm-good should be connected, arm-bad should have logged error
    expect(manager.getConnectedCount()).toBe(1);
    expect(mockLogger.error).toHaveBeenCalled();

    await manager.stopAll();
  });

  it('returns status per robot', async () => {
    const { port } = await startMockServer();

    const config: ROS2BridgeConfig = {
      connections: {
        'test-bot': {
          url: `ws://127.0.0.1:${port}`,
          topics: [{ name: '/odom', type: 'nav_msgs/Odometry' }],
          services: ['/reset'],
        },
      },
    };

    const mqtt = createMockMqtt();
    const manager = new ConnectionManager(config, mqtt as any, () => false, mockLogger);

    await manager.startAll();

    const status = manager.getRobotStatus('test-bot');
    expect(status).toBeDefined();
    expect(status!.robotName).toBe('test-bot');
    expect(status!.state).toBe('connected');
    expect(status!.url).toContain(String(port));
    expect(status!.connectedSince).toBeTypeOf('number');

    await manager.stopAll();
  });

  it('returns undefined for unknown robot', async () => {
    const config: ROS2BridgeConfig = { connections: {} };
    const mqtt = createMockMqtt();
    const manager = new ConnectionManager(config, mqtt as any, () => false, mockLogger);

    await manager.startAll();
    expect(manager.getRobotStatus('nonexistent')).toBeUndefined();

    await manager.stopAll();
  });
});
