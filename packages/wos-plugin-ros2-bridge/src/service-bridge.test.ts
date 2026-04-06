// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServiceBridge } from './service-bridge.js';

function createMockConnection() {
  const listeners = new Map<string, Function[]>();
  return {
    robotName: 'arm-1',
    callService: vi.fn(),
    on: vi.fn((event: string, handler: Function) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    }),
    off: vi.fn((event: string, handler: Function) => {
      const list = listeners.get(event);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      }
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const h of listeners.get(event) ?? []) h(...args);
    },
  };
}

function createMockMqtt() {
  const handlers = new Map<string, Function>();
  return {
    respond: vi.fn().mockResolvedValue(undefined),
    respondError: vi.fn().mockResolvedValue(undefined),
    subscribeWithHandler: vi.fn(async (topic: string, handler: Function) => {
      handlers.set(topic, handler);
    }),
    _triggerHandler: (topic: string, payload: unknown) => {
      const handler = handlers.get(topic);
      if (handler) handler({ topic, payload, timestamp: Date.now() });
    },
  };
}

const mockLogger = { info: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe('ServiceBridge', () => {
  let conn: ReturnType<typeof createMockConnection>;
  let mqtt: ReturnType<typeof createMockMqtt>;
  let bridge: ServiceBridge;
  let stopped: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    conn = createMockConnection();
    mqtt = createMockMqtt();
    stopped = false;

    bridge = new ServiceBridge(
      'arm-1',
      conn as any,
      mqtt as any,
      () => stopped,
      mockLogger,
      5000, // 5s timeout for tests
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes to service call topic on start', async () => {
    await bridge.start();

    expect(mqtt.subscribeWithHandler).toHaveBeenCalledWith(
      'wos/ros2/arm-1/service/call',
      expect.any(Function),
    );
  });

  it('forwards service call to rosbridge and responds on success', async () => {
    await bridge.start();

    // Simulate MQTT service call (flat payload)
    mqtt._triggerHandler('wos/ros2/arm-1/service/call', {
      service: '/set_mode',
      args: { mode: 1 },
      correlationId: 'corr-123',
      responseTopic: 'wos/plugin/test/response/corr-123',
    });

    expect(conn.callService).toHaveBeenCalledWith('/set_mode', { mode: 1 }, expect.any(String));

    // Get the call ID used
    const callId = conn.callService.mock.calls[0][2];

    // Simulate rosbridge service response
    conn.emit('message', {
      op: 'service_response',
      service: '/set_mode',
      values: { success: true },
      result: true,
      id: callId,
    });

    expect(mqtt.respond).toHaveBeenCalledWith(
      'wos/plugin/test/response/corr-123',
      'corr-123',
      { success: true },
    );
    expect(bridge.getSuccessCount()).toBe(1);
  });

  it('responds with error when rosbridge returns result: false', async () => {
    await bridge.start();

    mqtt._triggerHandler('wos/ros2/arm-1/service/call', {
      service: '/set_mode',
      args: { mode: 99 },
      correlationId: 'corr-456',
      responseTopic: 'wos/plugin/test/response/corr-456',
    });

    const callId = conn.callService.mock.calls[0][2];

    conn.emit('message', {
      op: 'service_response',
      service: '/set_mode',
      result: false,
      id: callId,
    });

    expect(mqtt.respondError).toHaveBeenCalledWith(
      'wos/plugin/test/response/corr-456',
      'corr-456',
      'ROS_SERVICE_ERROR',
      expect.stringContaining('/set_mode'),
    );
    expect(bridge.getErrorCount()).toBe(1);
  });

  it('times out when rosbridge does not respond', async () => {
    await bridge.start();

    mqtt._triggerHandler('wos/ros2/arm-1/service/call', {
      service: '/slow_service',
      args: {},
      correlationId: 'corr-789',
      responseTopic: 'wos/plugin/test/response/corr-789',
    });

    expect(bridge.getPendingCount()).toBe(1);

    // Advance past timeout
    vi.advanceTimersByTime(6000);

    expect(mqtt.respondError).toHaveBeenCalledWith(
      'wos/plugin/test/response/corr-789',
      'corr-789',
      'SERVICE_TIMEOUT',
      expect.stringContaining('timed out'),
    );
    expect(bridge.getPendingCount()).toBe(0);
    expect(bridge.getErrorCount()).toBe(1);
  });

  it('handles multiple concurrent calls with different correlationIds', async () => {
    await bridge.start();

    mqtt._triggerHandler('wos/ros2/arm-1/service/call', {
      service: '/svc_a',
      args: { a: 1 },
      correlationId: 'a-1',
      responseTopic: 'resp/a-1',
    });

    mqtt._triggerHandler('wos/ros2/arm-1/service/call', {
      service: '/svc_b',
      args: { b: 2 },
      correlationId: 'b-1',
      responseTopic: 'resp/b-1',
    });

    expect(bridge.getPendingCount()).toBe(2);

    const callIdA = conn.callService.mock.calls[0][2];
    const callIdB = conn.callService.mock.calls[1][2];

    // Respond to B first
    conn.emit('message', { op: 'service_response', result: true, values: { b: 'done' }, id: callIdB });
    expect(mqtt.respond).toHaveBeenCalledWith('resp/b-1', 'b-1', { b: 'done' });

    // Then A
    conn.emit('message', { op: 'service_response', result: true, values: { a: 'done' }, id: callIdA });
    expect(mqtt.respond).toHaveBeenCalledWith('resp/a-1', 'a-1', { a: 'done' });

    expect(bridge.getSuccessCount()).toBe(2);
    expect(bridge.getPendingCount()).toBe(0);
  });

  it('ignores requests when stopped', async () => {
    await bridge.start();
    stopped = true;

    mqtt._triggerHandler('wos/ros2/arm-1/service/call', {
      service: '/svc',
      args: {},
      correlationId: 'c-1',
      responseTopic: 'resp/c-1',
    });

    expect(conn.callService).not.toHaveBeenCalled();
  });

  it('rejects invalid requests missing required fields', async () => {
    await bridge.start();

    mqtt._triggerHandler('wos/ros2/arm-1/service/call', {
      // Missing service, correlationId, responseTopic
      args: {},
    });

    expect(conn.callService).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('cleans up pending calls on stop', async () => {
    await bridge.start();

    mqtt._triggerHandler('wos/ros2/arm-1/service/call', {
      service: '/svc',
      args: {},
      correlationId: 'c-1',
      responseTopic: 'resp/c-1',
    });

    expect(bridge.getPendingCount()).toBe(1);

    await bridge.stop();
    expect(bridge.getPendingCount()).toBe(0);
  });
});
