// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { MockRosbridgeServer } from './mock-rosbridge-server.js';
import { ConnectionManager } from '../../src/connection-manager.js';
import type { ROS2BridgeConfig } from '../../src/types/rosbridge.js';

function createMockMqtt() {
  return {
    publishRaw: vi.fn().mockResolvedValue(undefined),
    subscribeWithHandler: vi.fn().mockResolvedValue(undefined),
    respond: vi.fn().mockResolvedValue(undefined),
    respondError: vi.fn().mockResolvedValue(undefined),
  };
}

const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe('Integration: Multi-Robot', () => {
  const servers: MockRosbridgeServer[] = [];
  let manager: ConnectionManager;

  afterEach(async () => {
    if (manager) await manager.stopAll();
    for (const s of servers) await s.stop();
    servers.length = 0;
  });

  it('connects to multiple robots independently', async () => {
    const server1 = new MockRosbridgeServer();
    const server2 = new MockRosbridgeServer();
    await server1.start();
    await server2.start();
    servers.push(server1, server2);

    const config: ROS2BridgeConfig = {
      connections: {
        'arm-1': { url: server1.url, topics: [], services: [] },
        'arm-2': { url: server2.url, topics: [], services: [] },
      },
    };

    const mqtt = createMockMqtt();
    manager = new ConnectionManager(config, mqtt as any, () => false, logger);

    await manager.startAll();

    expect(manager.getConnectedCount()).toBe(2);
    expect(manager.getTotalCount()).toBe(2);
  });

  it('one robot failure does not affect others', async () => {
    const server1 = new MockRosbridgeServer();
    await server1.start();
    servers.push(server1);

    const config: ROS2BridgeConfig = {
      connections: {
        'arm-good': { url: server1.url, topics: [], services: [] },
        'arm-bad': { url: 'ws://127.0.0.1:1', topics: [], services: [] },
      },
    };

    const mqtt = createMockMqtt();
    manager = new ConnectionManager(config, mqtt as any, () => false, logger);

    await manager.startAll();

    expect(manager.getConnectedCount()).toBe(1);

    const goodStatus = manager.getRobotStatus('arm-good');
    expect(goodStatus?.state).toBe('connected');
  });

  it('reports namespaced topics per robot', async () => {
    const server1 = new MockRosbridgeServer();
    await server1.start();
    servers.push(server1);

    const config: ROS2BridgeConfig = {
      connections: {
        'robot-a': {
          url: server1.url,
          topics: [{ name: '/scan', type: 'sensor_msgs/LaserScan' }],
          services: [],
        },
      },
    };

    const mqtt = createMockMqtt();
    manager = new ConnectionManager(config, mqtt as any, () => false, logger);

    await manager.startAll();

    // MQTT subscribe should have been called with namespaced topic
    expect(mqtt.subscribeWithHandler).toHaveBeenCalledWith(
      'wos/ros2/robot-a/publish/#',
      expect.any(Function),
    );
  });
});
