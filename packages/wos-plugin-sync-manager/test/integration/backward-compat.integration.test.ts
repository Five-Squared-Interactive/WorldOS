// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SessionRouter } from '../../src/session-router.js';

const mockService = {
  createSession: vi.fn(async () => ({
    sessionId: 'gen-session-1',
    tag: 'world.5.10',
    createdAt: Date.now(),
  })),
  destroySession: vi.fn(async () => ({ success: true })),
  listSessions: vi.fn(async () => [
    { sessionId: 'sess-1', tag: 'world.5.10', clientCount: 2 },
  ]),
  getSessionInfo: vi.fn(async () => ({
    sessionId: 'sess-1',
    tag: 'world.5.10',
    clients: [],
    entityCount: 0,
  })),
};

function createMockSyncBridge() {
  return { service: mockService, isRunning: true };
}

function createMockMqttClient() {
  const handlers = new Map<string, Function>();
  return {
    subscribeWithHandler: vi.fn(async (topic: string, handler: Function) => {
      handlers.set(topic, handler);
    }),
    unsubscribe: vi.fn(async () => {}),
    publishRaw: vi.fn(),
    _handlers: handlers,
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function callHandler(mqtt: any, topic: string, payload: unknown) {
  const handler = mqtt._handlers.get(topic);
  if (!handler) throw new Error(`No handler for topic: ${topic}`);
  return handler({ topic, payload, timestamp: Date.now() });
}

describe('backward-compat integration', () => {
  let router: SessionRouter;
  let mqtt: ReturnType<typeof createMockMqttClient>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const bridge = createMockSyncBridge();
    mqtt = createMockMqttClient();
    logger = createMockLogger();
    router = new SessionRouter(bridge as any, mqtt as any, logger as any);
    await router.subscribe();
  });

  describe('legacy wos/sync/createsession', () => {
    it('should create session via legacy topic with { id, tag } payload', async () => {
      await callHandler(mqtt, 'wos/sync/createsession', {
        id: 'legacy-client-1',
        tag: 'world.5.10',
      });

      expect(mockService.createSession).toHaveBeenCalledWith(
        'world.5.10',
        expect.objectContaining({ clientId: 'legacy-client-1' }),
      );

      // Should respond on the legacy response topic
      expect(mqtt.publishRaw).toHaveBeenCalledWith(
        'wos/sync/createsession/response',
        expect.objectContaining({
          success: true,
          sessionId: 'gen-session-1',
        }),
      );
    });

    it('should log deprecation warning for legacy createsession', async () => {
      await callHandler(mqtt, 'wos/sync/createsession', {
        id: 'legacy-client-1',
        tag: 'world.5.10',
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('deprecated'),
      );
    });
  });

  describe('legacy wos/sync/deletesession', () => {
    it('should destroy session via legacy topic with { id } payload', async () => {
      await callHandler(mqtt, 'wos/sync/deletesession', {
        id: 'sess-1',
      });

      expect(mockService.destroySession).toHaveBeenCalledWith('sess-1');

      expect(mqtt.publishRaw).toHaveBeenCalledWith(
        'wos/sync/deletesession/response',
        expect.objectContaining({
          success: true,
        }),
      );
    });

    it('should log deprecation warning for legacy deletesession', async () => {
      await callHandler(mqtt, 'wos/sync/deletesession', {
        id: 'sess-1',
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('deprecated'),
      );
    });
  });

  describe('legacy wos/sync/getsessions', () => {
    it('should list sessions via legacy topic', async () => {
      await callHandler(mqtt, 'wos/sync/getsessions', {});

      expect(mockService.listSessions).toHaveBeenCalled();

      expect(mqtt.publishRaw).toHaveBeenCalledWith(
        'wos/sync/getsessions/response',
        expect.objectContaining({
          sessions: expect.any(Array),
        }),
      );
    });

    it('should log deprecation warning for legacy getsessions', async () => {
      await callHandler(mqtt, 'wos/sync/getsessions', {});

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('deprecated'),
      );
    });
  });

  describe('legacy wos/sync/usertoken', () => {
    it('should store token via legacy topic with { userid, token }', async () => {
      await callHandler(mqtt, 'wos/sync/usertoken', {
        userid: 'user-1',
        token: 'jwt-legacy-token',
      });

      expect(router.getUserToken('user-1')).toBe('jwt-legacy-token');
    });

    it('should log deprecation warning for legacy usertoken', async () => {
      await callHandler(mqtt, 'wos/sync/usertoken', {
        userid: 'user-1',
        token: 'jwt-legacy-token',
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('deprecated'),
      );
    });
  });

  describe('legacy wos/sync/openworld', () => {
    it('should open world via legacy topic', async () => {
      const hook = { openWorld: vi.fn(), closeWorld: vi.fn() };
      router.setRegionStoreHook(hook);

      await callHandler(mqtt, 'wos/sync/openworld', {
        worldId: 'my-world',
        worldDbPath: '/data/world.db',
      });

      expect(router.currentWorldId).toBe('my-world');
      expect(hook.openWorld).toHaveBeenCalledWith('/data/world.db');
    });

    it('should respond on legacy response topic', async () => {
      await callHandler(mqtt, 'wos/sync/openworld', {
        worldId: 'my-world',
      });

      expect(mqtt.publishRaw).toHaveBeenCalledWith(
        'wos/sync/openworld/response',
        expect.objectContaining({ success: true, worldId: 'my-world' }),
      );
    });

    it('should log deprecation warning for legacy openworld', async () => {
      await callHandler(mqtt, 'wos/sync/openworld', {
        worldId: 'my-world',
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('deprecated'),
      );
    });
  });

  describe('legacy wos/sync/closeworld', () => {
    it('should close world via legacy topic', async () => {
      const hook = { openWorld: vi.fn(), closeWorld: vi.fn() };
      router.setRegionStoreHook(hook);

      // Open first
      await callHandler(mqtt, 'wos/sync/openworld', {
        worldId: 'my-world',
      });

      await callHandler(mqtt, 'wos/sync/closeworld', {});

      expect(router.currentWorldId).toBeNull();
      expect(hook.closeWorld).toHaveBeenCalled();
    });

    it('should respond on legacy response topic', async () => {
      await callHandler(mqtt, 'wos/sync/closeworld', {});

      expect(mqtt.publishRaw).toHaveBeenCalledWith(
        'wos/sync/closeworld/response',
        expect.objectContaining({ success: true }),
      );
    });

    it('should log deprecation warning for legacy closeworld', async () => {
      await callHandler(mqtt, 'wos/sync/closeworld', {});

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('deprecated'),
      );
    });
  });

  describe('error handling for legacy handlers', () => {
    it('should publish error on legacy createsession when bridge is not running', async () => {
      (router as any)._bridge.service = null;

      await callHandler(mqtt, 'wos/sync/createsession', {
        id: 'legacy-client-1',
        tag: 'world.5.10',
      });

      expect(mqtt.publishRaw).toHaveBeenCalledWith(
        'wos/sync/createsession/response',
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('not running'),
        }),
      );
    });

    it('should publish error on legacy deletesession when destroy fails', async () => {
      mockService.destroySession.mockRejectedValueOnce(new Error('Session not found'));

      await callHandler(mqtt, 'wos/sync/deletesession', {
        id: 'nonexistent',
      });

      expect(mqtt.publishRaw).toHaveBeenCalledWith(
        'wos/sync/deletesession/response',
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Session not found'),
        }),
      );
    });
  });

  describe('permission pre-check on legacy createsession', () => {
    it('should deny legacy createsession when permission checker returns false', async () => {
      router.setPermissionChecker(async () => false);

      await callHandler(mqtt, 'wos/sync/createsession', {
        id: 'legacy-client-1',
        tag: 'world.5.10',
        clientToken: 'some-token',
      });

      expect(mockService.createSession).not.toHaveBeenCalled();
      expect(mqtt.publishRaw).toHaveBeenCalledWith(
        'wos/sync/createsession/response',
        expect.objectContaining({
          success: false,
          error: 'Permission denied',
        }),
      );
    });
  });

  describe('new topics still work alongside legacy', () => {
    it('should handle new wos/sync-manager/session/create without deprecation warning', async () => {
      await callHandler(mqtt, 'wos/sync-manager/session/create', {
        correlationId: 'new-1',
        tag: 'world.5.10',
        clientId: 'client-1',
      });

      expect(mockService.createSession).toHaveBeenCalled();
      // No deprecation warning for new topics
      const warnCalls = logger.warn.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('deprecated'),
      );
      expect(warnCalls).toHaveLength(0);
    });
  });
});
