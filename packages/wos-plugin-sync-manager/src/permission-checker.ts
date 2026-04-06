// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import type { Logger } from '@worldos/plugin-sdk';
import type { AuthOperation } from './auth-bridge.js';
import { parseRegionFromTag } from './types.js';

export interface RegionStoreInterface {
  checkRegionReadPermission(x: number, y: number, userId: string): boolean;
  checkRegionWritePermission(x: number, y: number, userId: string): boolean;
  checkEntityWritePermission(x: number, y: number, entityId: string, userId: string): boolean;
}

export interface SessionRouterInterface {
  getRegionCoords(sessionId: string): { x: number; y: number } | null | undefined;
}

interface CachedPermission {
  allowed: boolean;
  expiresAt: number;
}

const MAX_PERMISSION_CACHE = 10000;
const READ_OPS = new Set(['session.join', 'session.heartbeat']);
const REGION_WRITE_ENTITY_OPS = new Set(['entity.create']);

export class PermissionChecker {
  private _regionStore: RegionStoreInterface;
  private _sessionRouter: SessionRouterInterface;
  private _logger: Logger;
  private _cacheTtlMs: number;
  private _permissionCache = new Map<string, CachedPermission>();

  constructor(
    regionStore: RegionStoreInterface,
    sessionRouter: SessionRouterInterface,
    logger: Logger,
    cacheTtlMs = 30000,
  ) {
    this._regionStore = regionStore;
    this._sessionRouter = sessionRouter;
    this._logger = logger;
    this._cacheTtlMs = cacheTtlMs;
  }

  checkSessionPermission(operation: AuthOperation, userId: string, sessionId: string): boolean {
    // session.exit is always allowed
    if (operation.type === 'session.exit') {
      return true;
    }

    const coords = this._sessionRouter.getRegionCoords(sessionId);
    if (!coords) {
      return false;
    }

    const { x, y } = coords;

    if (READ_OPS.has(operation.type)) {
      const cacheKey = `${userId}:${x}.${y}:read`;
      return this._cachedCheck(cacheKey, () =>
        this._regionStore.checkRegionReadPermission(x, y, userId),
      );
    }

    if (operation.type === 'session.destroy') {
      const cacheKey = `${userId}:${x}.${y}:write`;
      return this._cachedCheck(cacheKey, () =>
        this._regionStore.checkRegionWritePermission(x, y, userId),
      );
    }

    // Fail closed for unrecognized session operations (F8)
    return false;
  }

  checkRegionWriteFromTag(tag: string, userId: string): boolean {
    const coords = parseRegionFromTag(tag);
    if (!coords) {
      return false;
    }

    const cacheKey = `${userId}:${coords.x}.${coords.y}:write`;
    return this._cachedCheck(cacheKey, () =>
      this._regionStore.checkRegionWritePermission(coords.x, coords.y, userId),
    );
  }

  checkEntityPermission(operation: AuthOperation, userId: string, sessionId: string, entityId?: string): boolean {
    const coords = this._sessionRouter.getRegionCoords(sessionId);
    if (!coords) {
      return false;
    }

    const { x, y } = coords;

    if (REGION_WRITE_ENTITY_OPS.has(operation.type)) {
      const cacheKey = `${userId}:${x}.${y}:write`;
      return this._cachedCheck(cacheKey, () =>
        this._regionStore.checkRegionWritePermission(x, y, userId),
      );
    }

    // entity.delete, entity.update.* → entity WRITE
    if (entityId) {
      const cacheKey = `${userId}:${x}.${y}:${entityId}:write`;
      return this._cachedCheck(cacheKey, () =>
        this._regionStore.checkEntityWritePermission(x, y, entityId, userId),
      );
    }

    return false;
  }

  invalidateCache(): void {
    this._permissionCache.clear();
  }

  invalidateForUser(userId: string): void {
    const prefix = `${userId}:`;
    for (const key of this._permissionCache.keys()) {
      if (key.startsWith(prefix)) {
        this._permissionCache.delete(key);
      }
    }
  }

  private _cachedCheck(cacheKey: string, check: () => boolean): boolean {
    const cached = this._permissionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.allowed;
    }

    const allowed = check();

    // Evict expired entries if at capacity (F13)
    if (this._permissionCache.size >= MAX_PERMISSION_CACHE) {
      const now = Date.now();
      for (const [key, entry] of this._permissionCache) {
        if (entry.expiresAt <= now) {
          this._permissionCache.delete(key);
        }
      }
      if (this._permissionCache.size >= MAX_PERMISSION_CACHE) {
        const firstKey = this._permissionCache.keys().next().value;
        if (firstKey !== undefined) {
          this._permissionCache.delete(firstKey);
        }
      }
    }

    this._permissionCache.set(cacheKey, {
      allowed,
      expiresAt: Date.now() + this._cacheTtlMs,
    });

    return allowed;
  }
}
