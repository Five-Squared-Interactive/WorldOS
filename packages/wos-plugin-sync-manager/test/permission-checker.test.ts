// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PermissionChecker } from '../src/permission-checker.js';

function createMockRegionStore() {
  return {
    checkRegionReadPermission: vi.fn(() => true),
    checkRegionWritePermission: vi.fn(() => true),
    checkEntityWritePermission: vi.fn(() => true),
    isOpen: true,
  };
}

function createMockSessionRouter() {
  const regionMap = new Map<string, { x: number; y: number }>();
  return {
    getRegionCoords: vi.fn((sessionId: string) => regionMap.get(sessionId) ?? null),
    sessionRegionMap: regionMap,
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

describe('PermissionChecker', () => {
  let checker: PermissionChecker;
  let regionStore: ReturnType<typeof createMockRegionStore>;
  let sessionRouter: ReturnType<typeof createMockSessionRouter>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.clearAllMocks();
    regionStore = createMockRegionStore();
    sessionRouter = createMockSessionRouter();
    logger = createMockLogger();
    checker = new PermissionChecker(regionStore as any, sessionRouter as any, logger as any, 30000);

    // Default: sess-1 maps to region (5, 10)
    sessionRouter.sessionRegionMap.set('sess-1', { x: 5, y: 10 });
  });

  describe('checkSessionPermission', () => {
    it('should check region READ for session.join', () => {
      const result = checker.checkSessionPermission(
        { type: 'session.join', sessionId: 'sess-1' },
        'user-1',
        'sess-1',
      );

      expect(regionStore.checkRegionReadPermission).toHaveBeenCalledWith(5, 10, 'user-1');
      expect(result).toBe(true);
    });

    it('should check region READ for session.heartbeat', () => {
      checker.checkSessionPermission(
        { type: 'session.heartbeat', sessionId: 'sess-1' },
        'user-1',
        'sess-1',
      );

      expect(regionStore.checkRegionReadPermission).toHaveBeenCalledWith(5, 10, 'user-1');
    });

    it('should check region WRITE for session.destroy', () => {
      checker.checkSessionPermission(
        { type: 'session.destroy', sessionId: 'sess-1' },
        'user-1',
        'sess-1',
      );

      expect(regionStore.checkRegionWritePermission).toHaveBeenCalledWith(5, 10, 'user-1');
    });

    it('should always return true for session.exit', () => {
      regionStore.checkRegionReadPermission.mockReturnValue(false);
      regionStore.checkRegionWritePermission.mockReturnValue(false);

      const result = checker.checkSessionPermission(
        { type: 'session.exit', sessionId: 'sess-1' },
        'user-1',
        'sess-1',
      );

      expect(result).toBe(true);
      expect(regionStore.checkRegionReadPermission).not.toHaveBeenCalled();
      expect(regionStore.checkRegionWritePermission).not.toHaveBeenCalled();
    });

    it('should return false for unknown session (no region mapping)', () => {
      const result = checker.checkSessionPermission(
        { type: 'session.join', sessionId: 'unknown-sess' },
        'user-1',
        'unknown-sess',
      );

      expect(result).toBe(false);
    });

    it('should return false when region store denies permission', () => {
      regionStore.checkRegionReadPermission.mockReturnValue(false);

      const result = checker.checkSessionPermission(
        { type: 'session.join', sessionId: 'sess-1' },
        'user-1',
        'sess-1',
      );

      expect(result).toBe(false);
    });
  });

  describe('checkRegionWriteFromTag', () => {
    it('should parse tag and check write permission', () => {
      const result = checker.checkRegionWriteFromTag('world.5.10', 'user-1');

      expect(regionStore.checkRegionWritePermission).toHaveBeenCalledWith(5, 10, 'user-1');
      expect(result).toBe(true);
    });

    it('should return false for unparseable tag', () => {
      const result = checker.checkRegionWriteFromTag('invalid-tag', 'user-1');

      expect(result).toBe(false);
      expect(regionStore.checkRegionWritePermission).not.toHaveBeenCalled();
    });

    it('should return false when store denies write', () => {
      regionStore.checkRegionWritePermission.mockReturnValue(false);

      const result = checker.checkRegionWriteFromTag('world.5.10', 'user-1');

      expect(result).toBe(false);
    });
  });

  describe('checkEntityPermission', () => {
    it('should check region WRITE for entity.create', () => {
      checker.checkEntityPermission(
        { type: 'entity.create', sessionId: 'sess-1', entityId: 'ent-1' },
        'user-1',
        'sess-1',
        'ent-1',
      );

      expect(regionStore.checkRegionWritePermission).toHaveBeenCalledWith(5, 10, 'user-1');
    });

    it('should check entity WRITE for entity.delete', () => {
      checker.checkEntityPermission(
        { type: 'entity.delete', sessionId: 'sess-1', entityId: 'ent-1' },
        'user-1',
        'sess-1',
        'ent-1',
      );

      expect(regionStore.checkEntityWritePermission).toHaveBeenCalledWith(5, 10, 'ent-1', 'user-1');
    });

    it('should check entity WRITE for entity.update.*', () => {
      checker.checkEntityPermission(
        { type: 'entity.update.position', sessionId: 'sess-1', entityId: 'ent-1' },
        'user-1',
        'sess-1',
        'ent-1',
      );

      expect(regionStore.checkEntityWritePermission).toHaveBeenCalledWith(5, 10, 'ent-1', 'user-1');
    });

    it('should return false for unknown session (no region mapping)', () => {
      const result = checker.checkEntityPermission(
        { type: 'entity.create', sessionId: 'unknown-sess', entityId: 'ent-1' },
        'user-1',
        'unknown-sess',
        'ent-1',
      );

      expect(result).toBe(false);
    });
  });

  describe('permission cache', () => {
    it('should return cached result without DB query on cache hit', () => {
      // First call — queries DB
      checker.checkSessionPermission(
        { type: 'session.join', sessionId: 'sess-1' },
        'user-1',
        'sess-1',
      );
      expect(regionStore.checkRegionReadPermission).toHaveBeenCalledTimes(1);

      // Second call — should use cache
      checker.checkSessionPermission(
        { type: 'session.join', sessionId: 'sess-1' },
        'user-1',
        'sess-1',
      );
      expect(regionStore.checkRegionReadPermission).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should query DB again after cache expires', () => {
      vi.useFakeTimers();

      checker.checkSessionPermission(
        { type: 'session.join', sessionId: 'sess-1' },
        'user-1',
        'sess-1',
      );
      expect(regionStore.checkRegionReadPermission).toHaveBeenCalledTimes(1);

      // Advance past TTL
      vi.advanceTimersByTime(31000);

      checker.checkSessionPermission(
        { type: 'session.join', sessionId: 'sess-1' },
        'user-1',
        'sess-1',
      );
      expect(regionStore.checkRegionReadPermission).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should clear all entries on invalidateCache()', () => {
      checker.checkSessionPermission(
        { type: 'session.join', sessionId: 'sess-1' },
        'user-1',
        'sess-1',
      );

      checker.invalidateCache();

      checker.checkSessionPermission(
        { type: 'session.join', sessionId: 'sess-1' },
        'user-1',
        'sess-1',
      );
      expect(regionStore.checkRegionReadPermission).toHaveBeenCalledTimes(2);
    });

    it('should remove only user entries on invalidateForUser()', () => {
      // Cache for user-1
      checker.checkSessionPermission(
        { type: 'session.join', sessionId: 'sess-1' },
        'user-1',
        'sess-1',
      );
      // Cache for user-2
      checker.checkSessionPermission(
        { type: 'session.join', sessionId: 'sess-1' },
        'user-2',
        'sess-1',
      );

      checker.invalidateForUser('user-1');

      // user-1 should need a new query
      checker.checkSessionPermission(
        { type: 'session.join', sessionId: 'sess-1' },
        'user-1',
        'sess-1',
      );
      expect(regionStore.checkRegionReadPermission).toHaveBeenCalledTimes(3); // 1 + 1 + 1 (after invalidate)

      // user-2 should still be cached
      checker.checkSessionPermission(
        { type: 'session.join', sessionId: 'sess-1' },
        'user-2',
        'sess-1',
      );
      expect(regionStore.checkRegionReadPermission).toHaveBeenCalledTimes(3); // Still 3
    });
  });

  describe('synchronous behavior', () => {
    it('should return boolean synchronously (no promise)', () => {
      const result = checker.checkSessionPermission(
        { type: 'session.join', sessionId: 'sess-1' },
        'user-1',
        'sess-1',
      );

      // Should be a plain boolean, not a Promise
      expect(typeof result).toBe('boolean');
    });
  });
});
