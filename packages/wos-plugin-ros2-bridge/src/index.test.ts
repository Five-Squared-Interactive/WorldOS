// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ROS2BridgePlugin } from './index.js';

// Mock fs to provide config file
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({
    connections: {
      'test-robot': {
        url: 'ws://localhost:9090',
        topics: [{ name: '/odom', type: 'nav_msgs/Odometry' }],
        services: ['/reset'],
      },
    },
    reconnect: { maxAttempts: 3, maxDelayMs: 5000 },
  })),
}));

// Mock ConnectionManager to avoid real WebSocket connections
vi.mock('./connection-manager.js', () => ({
  ConnectionManager: vi.fn().mockImplementation(() => ({
    startAll: vi.fn().mockResolvedValue(undefined),
    stopAll: vi.fn().mockResolvedValue(undefined),
    getConnectedCount: vi.fn().mockReturnValue(1),
    getTotalCount: vi.fn().mockReturnValue(1),
    getStatus: vi.fn().mockReturnValue([
      {
        robotName: 'test-robot',
        url: 'ws://localhost:9090',
        state: 'connected',
        latencyMs: 5,
        topics: [{ name: '/odom', direction: 'ros-to-mqtt', messageCount: 10, lastMessageAt: Date.now() }],
        serviceCallCount: 2,
        serviceErrorCount: 0,
        connectedSince: Date.now(),
      },
    ]),
  })),
}));

function createMockContext(overrides: Record<string, unknown> = {}) {
  return {
    logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
    config: { configFile: 'ros2-bridge.json' },
    mqtt: {
      publishRaw: vi.fn().mockResolvedValue(undefined),
      subscribeWithHandler: vi.fn().mockResolvedValue(undefined),
      respond: vi.fn().mockResolvedValue(undefined),
      respondError: vi.fn().mockResolvedValue(undefined),
    },
    manifest: { name: 'ros2-bridge', displayName: 'ros2-bridge', version: '1.0.0', runtime: 'node', entrypoint: './dist/index.js' },
    pluginDir: '/tmp/test-plugin',
    ...overrides,
  };
}

describe('ROS2BridgePlugin', () => {
  let plugin: ROS2BridgePlugin;

  beforeEach(() => {
    plugin = new ROS2BridgePlugin();
  });

  it('initializes connection manager on start', async () => {
    const ctx = createMockContext();
    await plugin.onStart(ctx as any);

    expect(plugin.getConnectionManager()).toBeDefined();
    expect(ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining('started'));
  });

  it('stops connection manager on stop', async () => {
    const ctx = createMockContext();
    await plugin.onStart(ctx as any);

    const manager = plugin.getConnectionManager()!;
    await plugin.onStop();

    expect(manager.stopAll).toHaveBeenCalled();
    expect(plugin.getConnectionManager()).toBeNull();
  });

  it('returns health check status', async () => {
    const ctx = createMockContext();
    await plugin.onStart(ctx as any);

    const health = await plugin.onHealthCheck();
    expect(health.status).toBe('ok');
    expect(health.details).toBeDefined();
    expect((health.details as any).connectedRobots).toBe(1);
  });

  it('returns unhealthy when not started', async () => {
    const health = await plugin.onHealthCheck();
    expect(health.status).toBe('unhealthy');
    expect(health.error).toBe('Plugin not started');
  });

  it('falls back when pluginDir is undefined', async () => {
    const ctx = createMockContext({ pluginDir: undefined });
    await plugin.onStart(ctx as any);

    expect(ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining('WOS_PLUGIN_DIR not set'));
  });
});
