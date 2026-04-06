// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AuthBridge } from '../src/auth-bridge.js';

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

function simulateIdentityResponse(mqtt: any, response: Record<string, unknown>) {
  const handler = mqtt._handlers.get('wos/identity/token/validate/response');
  if (!handler) throw new Error('No handler for identity response topic');
  handler({ topic: 'wos/identity/token/validate/response', payload: response, timestamp: Date.now() });
}

// Mock permission checker for auth middleware tests
function createMockPermissionChecker() {
  return {
    checkSessionPermission: vi.fn(() => true),
    checkEntityPermission: vi.fn(() => true),
  };
}

describe('AuthBridge', () => {
  let authBridge: AuthBridge;
  let mqtt: ReturnType<typeof createMockMqttClient>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mqtt = createMockMqttClient();
    logger = createMockLogger();
    authBridge = new AuthBridge(mqtt as any, logger as any, 300000);
    await authBridge.initialize();
  });

  afterEach(async () => {
    await authBridge.cleanup();
  });

  describe('initialize', () => {
    it('should subscribe to identity token validate response topic', () => {
      expect(mqtt.subscribeWithHandler).toHaveBeenCalledWith(
        'wos/identity/token/validate/response',
        expect.any(Function),
      );
    });
  });

  describe('validateToken', () => {
    it('should publish validation request to identity plugin with correlationId', async () => {
      const validatePromise = authBridge.validateToken('jwt-abc');

      // Simulate identity response
      const publishCall = mqtt.publishRaw.mock.calls[0];
      expect(publishCall[0]).toBe('wos/identity/token/validate');
      const correlationId = publishCall[1].correlationId;
      expect(publishCall[1].token).toBe('jwt-abc');

      simulateIdentityResponse(mqtt, {
        correlationId,
        valid: true,
        payload: { userId: 'user-1', role: 'player', sessionId: 'sess-1', iat: 1000, exp: 9999 },
      });

      const result = await validatePromise;
      expect(result.valid).toBe(true);
      expect(result.userId).toBe('user-1');
      expect(result.role).toBe('player');
    });

    it('should extract userId and role from response.payload (nested)', async () => {
      const validatePromise = authBridge.validateToken('jwt-nested');

      const correlationId = mqtt.publishRaw.mock.calls[0][1].correlationId;
      simulateIdentityResponse(mqtt, {
        correlationId,
        valid: true,
        payload: { userId: 'deep-user', role: 'admin', sessionId: 's1', iat: 0, exp: 0 },
      });

      const result = await validatePromise;
      expect(result.userId).toBe('deep-user');
      expect(result.role).toBe('admin');
    });

    it('should cache valid token results', async () => {
      const validatePromise = authBridge.validateToken('jwt-cache');

      const correlationId = mqtt.publishRaw.mock.calls[0][1].correlationId;
      simulateIdentityResponse(mqtt, {
        correlationId,
        valid: true,
        payload: { userId: 'user-cache', role: 'player', sessionId: 's1' },
      });

      await validatePromise;

      // Second call should use cache — no new MQTT publish
      const result2 = await authBridge.validateToken('jwt-cache');
      expect(result2.valid).toBe(true);
      expect(result2.userId).toBe('user-cache');
      expect(mqtt.publishRaw).toHaveBeenCalledTimes(1); // Only the first call
    });

    it('should make new MQTT request when cache entry expired (F8: fake timers)', async () => {
      vi.useFakeTimers();

      // Use short TTL
      const shortTtlBridge = new AuthBridge(mqtt as any, logger as any, 50);
      await shortTtlBridge.initialize();

      const p1 = shortTtlBridge.validateToken('jwt-expire');
      const cid1 = mqtt.publishRaw.mock.calls[0][1].correlationId;
      simulateIdentityResponse(mqtt, {
        correlationId: cid1,
        valid: true,
        payload: { userId: 'user-exp', role: 'player', sessionId: 's1' },
      });
      await p1;

      // Advance past TTL
      vi.advanceTimersByTime(60);

      const p2 = shortTtlBridge.validateToken('jwt-expire');
      const cid2 = mqtt.publishRaw.mock.calls[1][1].correlationId;
      simulateIdentityResponse(mqtt, {
        correlationId: cid2,
        valid: true,
        payload: { userId: 'user-exp', role: 'admin', sessionId: 's1' },
      });
      const result = await p2;

      expect(mqtt.publishRaw).toHaveBeenCalledTimes(2);
      expect(result.role).toBe('admin'); // Updated from second call

      await shortTtlBridge.cleanup();
      vi.useRealTimers();
    });

    it('should return valid false for invalid token response', async () => {
      const validatePromise = authBridge.validateToken('jwt-bad');

      const correlationId = mqtt.publishRaw.mock.calls[0][1].correlationId;
      simulateIdentityResponse(mqtt, {
        correlationId,
        valid: false,
      });

      const result = await validatePromise;
      expect(result.valid).toBe(false);
      expect(result.userId).toBe('');
      expect(result.role).toBe('');
    });

    it('should timeout after 2 seconds and return valid false', async () => {
      vi.useFakeTimers();

      const validatePromise = authBridge.validateToken('jwt-timeout');

      // Advance past 2s timeout
      vi.advanceTimersByTime(2100);

      const result = await validatePromise;
      expect(result.valid).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('invalidateToken', () => {
    it('should remove token from cache', async () => {
      // Cache a token first
      const p = authBridge.validateToken('jwt-inv');
      const cid = mqtt.publishRaw.mock.calls[0][1].correlationId;
      simulateIdentityResponse(mqtt, {
        correlationId: cid,
        valid: true,
        payload: { userId: 'u1', role: 'player', sessionId: 's1' },
      });
      await p;

      authBridge.invalidateToken('jwt-inv');

      // Next call should go to MQTT again
      const p2 = authBridge.validateToken('jwt-inv');
      const cid2 = mqtt.publishRaw.mock.calls[1][1].correlationId;
      simulateIdentityResponse(mqtt, {
        correlationId: cid2,
        valid: true,
        payload: { userId: 'u1', role: 'admin', sessionId: 's1' },
      });
      const result = await p2;

      expect(mqtt.publishRaw).toHaveBeenCalledTimes(2);
      expect(result.role).toBe('admin');
    });
  });

  describe('userTokenMap', () => {
    it('should store token retrievable by clientId', () => {
      authBridge.setUserToken('client-1', 'jwt-stored');
      expect(authBridge.getUserToken('client-1')).toBe('jwt-stored');
    });

    it('should return undefined for unknown clientId', () => {
      expect(authBridge.getUserToken('unknown')).toBeUndefined();
    });
  });

  describe('resolveToken', () => {
    it('should prefer context.clientToken when present', () => {
      authBridge.setUserToken('client-1', 'map-token');
      const token = authBridge.resolveToken({ clientId: 'client-1', clientToken: 'direct-token' });
      expect(token).toBe('direct-token');
    });

    it('should fall back to userTokenMap lookup by clientId', () => {
      authBridge.setUserToken('client-2', 'map-token-2');
      const token = authBridge.resolveToken({ clientId: 'client-2' });
      expect(token).toBe('map-token-2');
    });

    it('should return undefined when neither source has a token', () => {
      const token = authBridge.resolveToken({ clientId: 'no-token-client' });
      expect(token).toBeUndefined();
    });

    it('should treat empty string clientToken as no token (F6)', () => {
      authBridge.setUserToken('c-empty', 'map-token');
      const token = authBridge.resolveToken({ clientId: 'c-empty', clientToken: '' });
      // Empty string should fall through to map lookup
      expect(token).toBe('map-token');
    });

    it('should return undefined when userTokenMap has empty string (F6)', () => {
      authBridge.setUserToken('c-empty2', '');
      const token = authBridge.resolveToken({ clientId: 'c-empty2' });
      expect(token).toBeUndefined();
    });
  });

  describe('createAuthMiddleware', () => {
    it('should return true for session.create (pre-checked by SessionRouter)', async () => {
      const checker = createMockPermissionChecker();
      const middleware = authBridge.createAuthMiddleware(checker as any);

      const result = await middleware(
        { type: 'session.create' },
        { clientId: 'c1' },
      );
      expect(result).toBe(true);
    });

    it('should return true for session.exit (always allowed)', async () => {
      const checker = createMockPermissionChecker();
      const middleware = authBridge.createAuthMiddleware(checker as any);

      const result = await middleware(
        { type: 'session.exit', sessionId: 'sess-1' },
        { clientId: 'c1' },
      );
      expect(result).toBe(true);
    });

    it('should return true for unmapped operations (environment.*, custom.message)', async () => {
      const checker = createMockPermissionChecker();
      const middleware = authBridge.createAuthMiddleware(checker as any);

      // Need a valid token for these to pass the token resolution step
      authBridge.setUserToken('c1', 'jwt-env');
      const p = authBridge.validateToken('jwt-env');
      const cid = mqtt.publishRaw.mock.calls[0][1].correlationId;
      simulateIdentityResponse(mqtt, {
        correlationId: cid,
        valid: true,
        payload: { userId: 'u1', role: 'player', sessionId: 's1' },
      });
      await p;

      const result = await middleware(
        { type: 'environment.sky' as any, sessionId: 'sess-1' },
        { clientId: 'c1' },
      );
      expect(result).toBe(true);
    });

    it('should return false when no token resolvable', async () => {
      const checker = createMockPermissionChecker();
      const middleware = authBridge.createAuthMiddleware(checker as any);

      const result = await middleware(
        { type: 'session.join', sessionId: 'sess-1' },
        { clientId: 'no-token-client' },
      );
      expect(result).toBe(false);
    });

    it('should return false when token is invalid', async () => {
      const checker = createMockPermissionChecker();
      const middleware = authBridge.createAuthMiddleware(checker as any);

      authBridge.setUserToken('c-bad', 'jwt-invalid');

      const validatePromise = middleware(
        { type: 'session.join', sessionId: 'sess-1' },
        { clientId: 'c-bad' },
      );

      // Identity says invalid
      const cid = mqtt.publishRaw.mock.calls[0][1].correlationId;
      simulateIdentityResponse(mqtt, { correlationId: cid, valid: false });

      const result = await validatePromise;
      expect(result).toBe(false);
    });

    it('should delegate session operations to permissionChecker.checkSessionPermission', async () => {
      const checker = createMockPermissionChecker();
      const middleware = authBridge.createAuthMiddleware(checker as any);

      authBridge.setUserToken('c1', 'jwt-session');
      const p = authBridge.validateToken('jwt-session');
      const cid = mqtt.publishRaw.mock.calls[0][1].correlationId;
      simulateIdentityResponse(mqtt, {
        correlationId: cid,
        valid: true,
        payload: { userId: 'user-sess', role: 'player', sessionId: 's1' },
      });
      await p;

      const operation = { type: 'session.join' as const, sessionId: 'sess-1' };
      await middleware(operation, { clientId: 'c1' });

      expect(checker.checkSessionPermission).toHaveBeenCalledWith(operation, 'user-sess', 'sess-1');
    });

    it('should delegate entity operations to permissionChecker.checkEntityPermission', async () => {
      const checker = createMockPermissionChecker();
      const middleware = authBridge.createAuthMiddleware(checker as any);

      authBridge.setUserToken('c1', 'jwt-entity');
      const p = authBridge.validateToken('jwt-entity');
      const cid = mqtt.publishRaw.mock.calls[0][1].correlationId;
      simulateIdentityResponse(mqtt, {
        correlationId: cid,
        valid: true,
        payload: { userId: 'user-ent', role: 'player', sessionId: 's1' },
      });
      await p;

      const operation = { type: 'entity.create' as const, sessionId: 'sess-1', entityId: 'ent-1' };
      await middleware(operation, { clientId: 'c1' });

      expect(checker.checkEntityPermission).toHaveBeenCalledWith(operation, 'user-ent', 'sess-1', 'ent-1');
    });

    it('should fail closed on any error', async () => {
      const checker = createMockPermissionChecker();
      checker.checkSessionPermission.mockImplementation(() => { throw new Error('DB error'); });
      const middleware = authBridge.createAuthMiddleware(checker as any);

      authBridge.setUserToken('c1', 'jwt-err');
      const p = authBridge.validateToken('jwt-err');
      const cid = mqtt.publishRaw.mock.calls[0][1].correlationId;
      simulateIdentityResponse(mqtt, {
        correlationId: cid,
        valid: true,
        payload: { userId: 'u-err', role: 'player', sessionId: 's1' },
      });
      await p;

      const result = await middleware(
        { type: 'session.join', sessionId: 'sess-1' },
        { clientId: 'c1' },
      );
      expect(result).toBe(false);
    });

    it('should handle operation.sessionId being undefined gracefully', async () => {
      const checker = createMockPermissionChecker();
      const middleware = authBridge.createAuthMiddleware(checker as any);

      authBridge.setUserToken('c1', 'jwt-nosess');
      const p = authBridge.validateToken('jwt-nosess');
      const cid = mqtt.publishRaw.mock.calls[0][1].correlationId;
      simulateIdentityResponse(mqtt, {
        correlationId: cid,
        valid: true,
        payload: { userId: 'u1', role: 'player', sessionId: 's1' },
      });
      await p;

      // session.join with no sessionId — should fail gracefully
      const result = await middleware(
        { type: 'session.join' },
        { clientId: 'c1' },
      );
      expect(result).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should reject all pending requests', async () => {
      vi.useFakeTimers();

      const validatePromise = authBridge.validateToken('jwt-cleanup');
      await authBridge.cleanup();

      const result = await validatePromise;
      expect(result.valid).toBe(false);

      vi.useRealTimers();
    });

    it('should clear token cache and userTokenMap', async () => {
      // Cache a token
      authBridge.setUserToken('c1', 'jwt-clear');
      const p = authBridge.validateToken('jwt-clear');
      const cid = mqtt.publishRaw.mock.calls[0][1].correlationId;
      simulateIdentityResponse(mqtt, {
        correlationId: cid,
        valid: true,
        payload: { userId: 'u1', role: 'player', sessionId: 's1' },
      });
      await p;

      await authBridge.cleanup();

      expect(authBridge.getUserToken('c1')).toBeUndefined();

      // Re-initialize for afterEach cleanup
      authBridge = new AuthBridge(mqtt as any, logger as any, 300000);
      await authBridge.initialize();
    });

    it('should call unsubscribe on MQTT topic (F7)', async () => {
      await authBridge.cleanup();

      expect(mqtt.unsubscribe).toHaveBeenCalledWith('wos/identity/token/validate/response');

      // Re-initialize for afterEach cleanup
      authBridge = new AuthBridge(mqtt as any, logger as any, 300000);
      await authBridge.initialize();
    });
  });

  describe('invalid result immutability (F1)', () => {
    it('should return independent invalid result objects that cannot pollute each other', async () => {
      // Get two invalid results
      vi.useFakeTimers();

      const p1 = authBridge.validateToken('jwt-timeout-1');
      vi.advanceTimersByTime(2100);
      const result1 = await p1;

      const p2 = authBridge.validateToken('jwt-timeout-2');
      vi.advanceTimersByTime(2100);
      const result2 = await p2;

      // Mutate result1 — should not affect result2
      (result1 as any).userId = 'hacked';
      expect(result2.userId).toBe('');

      vi.useRealTimers();
    });
  });

  describe('malformed payload handling (F2)', () => {
    it('should not crash on null payload from identity', async () => {
      const p = authBridge.validateToken('jwt-null-payload');
      const cid = mqtt.publishRaw.mock.calls[0][1].correlationId;
      simulateIdentityResponse(mqtt, {
        correlationId: cid,
        valid: true,
        payload: null,
      });
      const result = await p;
      expect(result.valid).toBe(false);
    });

    it('should not crash on missing correlationId', () => {
      // Should silently ignore — no pending request match
      expect(() => {
        simulateIdentityResponse(mqtt, { valid: true, payload: { userId: 'u', role: 'r' } });
      }).not.toThrow();
    });

    it('should not crash when payload fields are missing', async () => {
      const p = authBridge.validateToken('jwt-partial');
      const cid = mqtt.publishRaw.mock.calls[0][1].correlationId;
      simulateIdentityResponse(mqtt, {
        correlationId: cid,
        valid: true,
        payload: {},  // no userId or role
      });
      const result = await p;
      // Should still resolve (with undefined userId/role cached)
      expect(result.valid).toBe(true);
    });
  });

  describe('cache eviction (F3)', () => {
    it('should bound cache size via maxCacheSize constructor param', async () => {
      // Create bridge with max cache of 3
      const smallBridge = new AuthBridge(mqtt as any, logger as any, 300000, 3);
      await smallBridge.initialize();

      // Fill cache with 4 unique tokens (exceeds max of 3)
      for (let i = 0; i < 4; i++) {
        const callIdx = mqtt.publishRaw.mock.calls.length;
        const p = smallBridge.validateToken(`jwt-bound-${i}`);
        const cid = mqtt.publishRaw.mock.calls[callIdx][1].correlationId;
        simulateIdentityResponse(mqtt, {
          correlationId: cid,
          valid: true,
          payload: { userId: `u${i}`, role: 'player', sessionId: 's1' },
        });
        await p;
      }

      // The cache size should not exceed maxCacheSize
      // Verify: the earliest token should have been evicted
      const callsBefore = mqtt.publishRaw.mock.calls.length;
      const p = smallBridge.validateToken('jwt-bound-0');
      // If jwt-bound-0 was evicted, a new MQTT call is needed
      expect(mqtt.publishRaw.mock.calls.length).toBe(callsBefore + 1);

      const cid = mqtt.publishRaw.mock.calls[callsBefore][1].correlationId;
      simulateIdentityResponse(mqtt, {
        correlationId: cid,
        valid: true,
        payload: { userId: 'u0', role: 'player', sessionId: 's1' },
      });
      await p;

      await smallBridge.cleanup();
    });
  });
});
