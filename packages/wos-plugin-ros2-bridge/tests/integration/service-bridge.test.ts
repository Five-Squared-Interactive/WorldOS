// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockRosbridgeServer } from './mock-rosbridge-server.js';
import { RosbridgeConnection } from '../../src/rosbridge-connection.js';
import { ServiceBridge } from '../../src/service-bridge.js';

function createMockMqtt() {
  const handlers = new Map<string, Function>();
  return {
    respond: vi.fn().mockResolvedValue(undefined),
    respondError: vi.fn().mockResolvedValue(undefined),
    subscribeWithHandler: vi.fn(async (topic: string, handler: Function) => {
      handlers.set(topic, handler);
    }),
    _trigger: (topic: string, payload: unknown) => {
      const handler = handlers.get(topic);
      if (handler) handler({ topic, payload, timestamp: Date.now() });
    },
  };
}

const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe('Integration: ServiceBridge', () => {
  let server: MockRosbridgeServer;
  let conn: RosbridgeConnection;
  let mqtt: ReturnType<typeof createMockMqtt>;
  let bridge: ServiceBridge;

  beforeEach(async () => {
    server = new MockRosbridgeServer();
    await server.start();

    // Register a service handler on mock server
    server.onService('/set_mode', (args) => ({
      result: true,
      values: { success: true, mode: (args as any)?.mode ?? 0 },
    }));

    conn = new RosbridgeConnection('test-bot', {
      url: server.url,
      topics: [],
      services: ['/set_mode'],
    });

    mqtt = createMockMqtt();

    bridge = new ServiceBridge(
      'test-bot',
      conn,
      mqtt as any,
      () => false,
      logger,
      5000,
    );

    await conn.connect();
    await bridge.start();
  });

  afterEach(async () => {
    await bridge.stop();
    conn.disconnect();
    await server.stop();
  });

  it('completes service call round-trip', async () => {
    // Trigger a service call via MQTT (flat payload as SDK sends it)
    mqtt._trigger('wos/ros2/test-bot/service/call', {
      service: '/set_mode',
      args: { mode: 2 },
      correlationId: 'test-corr-1',
      responseTopic: 'wos/plugin/test/response/test-corr-1',
    });

    // Wait for round-trip
    await new Promise((r) => setTimeout(r, 200));

    expect(mqtt.respond).toHaveBeenCalledWith(
      'wos/plugin/test/response/test-corr-1',
      'test-corr-1',
      expect.objectContaining({ success: true, mode: 2 }),
    );
    expect(bridge.getSuccessCount()).toBe(1);
  });

  it('handles service error from rosbridge', async () => {
    server.onService('/fail_service', () => ({ result: false }));

    mqtt._trigger('wos/ros2/test-bot/service/call', {
      service: '/fail_service',
      args: {},
      correlationId: 'test-corr-2',
      responseTopic: 'wos/plugin/test/response/test-corr-2',
    });

    await new Promise((r) => setTimeout(r, 200));

    expect(mqtt.respondError).toHaveBeenCalledWith(
      'wos/plugin/test/response/test-corr-2',
      'test-corr-2',
      'ROS_SERVICE_ERROR',
      expect.any(String),
    );
    expect(bridge.getErrorCount()).toBe(1);
  });
});
