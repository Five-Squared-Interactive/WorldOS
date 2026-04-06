// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockService } = vi.hoisted(() => {
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
  return { mockService };
});

import { SessionRouter } from '../src/session-router.js';

function createMockSyncBridge() {
  return {
    service: mockService,
    isRunning: true,
  };
}

function createMockMqttClient() {
  const handlers = new Map<string, Function>();
  return {
    subscribeWithHandler: vi.fn(async (topic: string, handler: Function) => {
      handlers.set(topic, handler);
    }),
    unsubscribe: vi.fn(async (topic: string) => {
      handlers.delete(topic);
    }),
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
  if (!handler) throw new Error(`No handler for topic: ${topic}. Registered: ${[...mqtt._handlers.keys()].join(', ')}`);
  return handler({ topic, payload, timestamp: Date.now() });
}

describe('SessionRouter', () => {
  let router: SessionRouter;
  let bridge: ReturnType<typeof createMockSyncBridge>;
  let mqtt: ReturnType<typeof createMockMqttClient>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    vi.clearAllMocks();
    bridge = createMockSyncBridge();
    mqtt = createMockMqttClient();
    logger = createMockLogger();
    router = new SessionRouter(bridge as any, mqtt as any, logger as any);
    await router.subscribe();
  });

  describe('subscribe', () => {
    it('should subscribe to all WOS sync-manager topics', () => {
      const topics = mqtt.subscribeWithHandler.mock.calls.map((c: any[]) => c[0]);
      expect(topics).toContain('wos/sync-manager/session/create');
      expect(topics).toContain('wos/sync-manager/session/destroy');
      expect(topics).toContain('wos/sync-manager/session/list');
      expect(topics).toContain('wos/sync-manager/session/get');
      expect(topics).toContain('wos/sync-manager/world/open');
      expect(topics).toContain('wos/sync-manager/world/close');
      expect(topics).toContain('wos/sync-manager/user/token');
    });
  });

  describe('stop', () => {
    it('should unsubscribe from all WOS topics', async () => {
      await router.stop();

      expect(mqtt.unsubscribe).toHaveBeenCalledWith('wos/sync-manager/session/create');
      expect(mqtt.unsubscribe).toHaveBeenCalledWith('wos/sync-manager/session/destroy');
      expect(mqtt.unsubscribe).toHaveBeenCalledWith('wos/sync-manager/user/token');
    });

    it('should clear session and token maps', async () => {
      // Add some state first
      await callHandler(mqtt, 'wos/sync-manager/session/create', {
        correlationId: 'c-1',
        tag: 'world.5.10',
        clientId: 'client-1',
      });
      await callHandler(mqtt, 'wos/sync-manager/user/token', {
        userId: 'user-1',
        token: 'jwt-token',
      });

      await router.stop();

      expect(router.sessionRegionMap.size).toBe(0);
      expect(router.userTokenMap.size).toBe(0);
      expect(router.currentWorldId).toBeNull();
    });
  });

  describe('session/create', () => {
    it('should call createSession and publish response with correlationId', async () => {
      await callHandler(mqtt, 'wos/sync-manager/session/create', {
        correlationId: 'abc-123',
        tag: 'world.5.10',
        clientId: 'client-1',
      });

      expect(mockService.createSession).toHaveBeenCalledWith(
        'world.5.10',
        expect.objectContaining({ clientId: 'client-1' }),
      );

      expect(mqtt.publishRaw).toHaveBeenCalledWith(
        'wos/sync-manager/session/create/response',
        expect.objectContaining({
          correlationId: 'abc-123',
          success: true,
          sessionId: 'gen-session-1',
        }),
      );
    });

    it('should store session region mapping', async () => {
      await callHandler(mqtt, 'wos/sync-manager/session/create', {
        correlationId: 'abc-123',
        tag: 'world.5.10',
        clientId: 'client-1',
      });

      expect(router.getRegionCoords('gen-session-1')).toEqual({ x: 5, y: 10 });
    });

    it('should pass clientToken when provided', async () => {
      await callHandler(mqtt, 'wos/sync-manager/session/create', {
        correlationId: 'abc-123',
        tag: 'world.5.10',
        clientId: 'client-1',
        clientToken: 'jwt-token',
      });

      expect(mockService.createSession).toHaveBeenCalledWith(
        'world.5.10',
        expect.objectContaining({ clientId: 'client-1', clientToken: 'jwt-token' }),
      );
    });
  });

  describe('session/destroy', () => {
    it('should call destroySession and publish response', async () => {
      await callHandler(mqtt, 'wos/sync-manager/session/destroy', {
        correlationId: 'def-456',
        sessionId: 'sess-1',
      });

      expect(mockService.destroySession).toHaveBeenCalledWith('sess-1');

      expect(mqtt.publishRaw).toHaveBeenCalledWith(
        'wos/sync-manager/session/destroy/response',
        expect.objectContaining({
          correlationId: 'def-456',
          success: true,
        }),
      );
    });
  });

  describe('session/list', () => {
    it('should call listSessions and publish response', async () => {
      await callHandler(mqtt, 'wos/sync-manager/session/list', {
        correlationId: 'ghi-789',
      });

      expect(mockService.listSessions).toHaveBeenCalled();

      expect(mqtt.publishRaw).toHaveBeenCalledWith(
        'wos/sync-manager/session/list/response',
        expect.objectContaining({
          correlationId: 'ghi-789',
          sessions: expect.any(Array),
        }),
      );
    });
  });

  describe('session/get', () => {
    it('should call getSessionInfo and publish response', async () => {
      await callHandler(mqtt, 'wos/sync-manager/session/get', {
        correlationId: 'get-1',
        sessionId: 'sess-1',
      });

      expect(mockService.getSessionInfo).toHaveBeenCalledWith('sess-1');

      expect(mqtt.publishRaw).toHaveBeenCalledWith(
        'wos/sync-manager/session/get/response',
        expect.objectContaining({
          correlationId: 'get-1',
          sessionId: 'sess-1',
        }),
      );
    });
  });

  describe('user/token', () => {
    it('should store token in userTokenMap', async () => {
      await callHandler(mqtt, 'wos/sync-manager/user/token', {
        userId: 'user-1',
        token: 'jwt-token-abc',
      });

      expect(router.getUserToken('user-1')).toBe('jwt-token-abc');
    });
  });

  describe('world/open', () => {
    it('should store world reference', async () => {
      await callHandler(mqtt, 'wos/sync-manager/world/open', {
        correlationId: 'w-1',
        worldId: 'my-world',
        worldDbPath: '/data/world.db',
      });

      expect(router.currentWorldId).toBe('my-world');
    });
  });

  describe('bridge not running', () => {
    it('should publish error when bridge service is null', async () => {
      bridge.service = null;

      await callHandler(mqtt, 'wos/sync-manager/session/create', {
        correlationId: 'null-1',
        tag: 'world.5.10',
        clientId: 'client-1',
      });

      expect(mqtt.publishRaw).toHaveBeenCalledWith(
        'wos/sync-manager/session/create/response',
        expect.objectContaining({
          correlationId: 'null-1',
          success: false,
          error: expect.stringContaining('not running'),
        }),
      );
    });
  });

  describe('permission pre-check', () => {
    it('should deny session create when permission checker returns false', async () => {
      router.setPermissionChecker(async () => false);

      await callHandler(mqtt, 'wos/sync-manager/session/create', {
        correlationId: 'perm-1',
        tag: 'world.5.10',
        clientId: 'client-1',
        clientToken: 'some-token',
      });

      expect(mockService.createSession).not.toHaveBeenCalled();
      expect(mqtt.publishRaw).toHaveBeenCalledWith(
        'wos/sync-manager/session/create/response',
        expect.objectContaining({
          correlationId: 'perm-1',
          success: false,
          error: 'Permission denied',
        }),
      );
    });

    it('should allow session create when permission checker returns true', async () => {
      router.setPermissionChecker(async () => true);

      await callHandler(mqtt, 'wos/sync-manager/session/create', {
        correlationId: 'perm-2',
        tag: 'world.5.10',
        clientId: 'client-1',
        clientToken: 'some-token',
      });

      expect(mockService.createSession).toHaveBeenCalled();
    });

    it('should skip permission check when no clientToken provided', async () => {
      router.setPermissionChecker(async () => false);

      await callHandler(mqtt, 'wos/sync-manager/session/create', {
        correlationId: 'perm-3',
        tag: 'world.5.10',
        clientId: 'client-1',
      });

      // Should proceed despite checker returning false — no token means no auth check
      expect(mockService.createSession).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should publish error response when WorldSync throws', async () => {
      mockService.createSession.mockRejectedValueOnce(new Error('Session limit exceeded'));

      await callHandler(mqtt, 'wos/sync-manager/session/create', {
        correlationId: 'err-1',
        tag: 'world.5.10',
        clientId: 'client-1',
      });

      expect(mqtt.publishRaw).toHaveBeenCalledWith(
        'wos/sync-manager/session/create/response',
        expect.objectContaining({
          correlationId: 'err-1',
          success: false,
          error: expect.stringContaining('Session limit exceeded'),
        }),
      );
    });
  });

  describe('session tag parsing', () => {
    it('should correctly extract region coords from tag', async () => {
      mockService.createSession.mockResolvedValueOnce({
        sessionId: 'coord-sess',
        tag: 'world.3.7',
        createdAt: Date.now(),
      });

      await callHandler(mqtt, 'wos/sync-manager/session/create', {
        correlationId: 'c-1',
        tag: 'world.3.7',
        clientId: 'client-1',
      });

      expect(router.getRegionCoords('coord-sess')).toEqual({ x: 3, y: 7 });
    });
  });

  describe('world/open calls regionStoreHook (F1)', () => {
    it('should call regionStoreHook.openWorld on world/open', async () => {
      const hook = { openWorld: vi.fn(), closeWorld: vi.fn() };
      router.setRegionStoreHook(hook);

      await callHandler(mqtt, 'wos/sync-manager/world/open', {
        correlationId: 'w-1',
        worldId: 'my-world',
        worldDbPath: '/data/world.db',
      });

      expect(hook.openWorld).toHaveBeenCalledWith('/data/world.db');
    });

    it('should call regionStoreHook.closeWorld on world/close', async () => {
      const hook = { openWorld: vi.fn(), closeWorld: vi.fn() };
      router.setRegionStoreHook(hook);

      await callHandler(mqtt, 'wos/sync-manager/world/close', {
        correlationId: 'w-2',
      });

      expect(hook.closeWorld).toHaveBeenCalled();
    });
  });

  describe('token change listener (F7)', () => {
    it('should call tokenChangeListener when user/token received', async () => {
      const listener = vi.fn();
      router.setTokenChangeListener(listener);

      await callHandler(mqtt, 'wos/sync-manager/user/token', {
        userId: 'user-1',
        token: 'jwt-token-abc',
      });

      expect(listener).toHaveBeenCalledWith('user-1', 'jwt-token-abc');
    });
  });

  describe('domain lifecycle events (Task 4.4)', () => {
    it('should publish session-created event after successful create', async () => {
      await callHandler(mqtt, 'wos/sync-manager/session/create', {
        correlationId: 'ev-1',
        tag: 'world.5.10',
        clientId: 'client-1',
      });

      expect(mqtt.publishRaw).toHaveBeenCalledWith(
        'wos/sync-manager/lifecycle/session-created',
        expect.objectContaining({
          sessionId: 'gen-session-1',
          tag: 'world.5.10',
          timestamp: expect.any(Number),
        }),
      );
    });

    it('should NOT publish session-created event on create failure', async () => {
      mockService.createSession.mockRejectedValueOnce(new Error('fail'));

      await callHandler(mqtt, 'wos/sync-manager/session/create', {
        correlationId: 'ev-2',
        tag: 'world.5.10',
        clientId: 'client-1',
      });

      const lifecycleCalls = mqtt.publishRaw.mock.calls.filter(
        (c: any[]) => c[0] === 'wos/sync-manager/lifecycle/session-created',
      );
      expect(lifecycleCalls).toHaveLength(0);
    });

    it('should publish session-destroyed event after successful destroy', async () => {
      await callHandler(mqtt, 'wos/sync-manager/session/destroy', {
        correlationId: 'ev-3',
        sessionId: 'sess-1',
      });

      expect(mqtt.publishRaw).toHaveBeenCalledWith(
        'wos/sync-manager/lifecycle/session-destroyed',
        expect.objectContaining({
          sessionId: 'sess-1',
          timestamp: expect.any(Number),
        }),
      );
    });

    it('should NOT publish session-destroyed event on destroy failure', async () => {
      mockService.destroySession.mockRejectedValueOnce(new Error('fail'));

      await callHandler(mqtt, 'wos/sync-manager/session/destroy', {
        correlationId: 'ev-4',
        sessionId: 'sess-1',
      });

      const lifecycleCalls = mqtt.publishRaw.mock.calls.filter(
        (c: any[]) => c[0] === 'wos/sync-manager/lifecycle/session-destroyed',
      );
      expect(lifecycleCalls).toHaveLength(0);
    });
  });
});
