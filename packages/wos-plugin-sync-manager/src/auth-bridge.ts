// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import type { PluginMqttClient, Logger } from '@worldos/plugin-sdk';

export interface TokenValidationResult {
  valid: boolean;
  userId: string;
  role: string;
}

interface CachedToken {
  userId: string;
  role: string;
  expiresAt: number;
}

interface PendingRequest {
  resolve: (result: TokenValidationResult) => void;
  timeout: ReturnType<typeof setTimeout>;
  token: string;
}

export interface AuthOperation {
  type: string;
  sessionId?: string;
  entityId?: string;
  entityType?: string;
  payload?: Record<string, unknown>;
}

export interface AuthContext {
  clientId: string;
  clientToken?: string;
  clientTag?: string;
  sessionRole?: 'owner' | 'member';
  entityOwner?: string;
}

export type AuthMiddleware = (
  operation: AuthOperation,
  context: AuthContext,
) => Promise<boolean>;

export interface PermissionCheckerInterface {
  checkSessionPermission(operation: AuthOperation, userId: string, sessionId: string): boolean;
  checkEntityPermission(operation: AuthOperation, userId: string, sessionId: string, entityId?: string): boolean;
}

function invalidResult(): TokenValidationResult {
  return { valid: false, userId: '', role: '' };
}
const VALIDATE_TIMEOUT_MS = 2000;

const SESSION_OPS = new Set(['session.join', 'session.destroy', 'session.heartbeat']);
const ENTITY_OPS_PREFIX = 'entity.';

export class AuthBridge {
  private _mqtt: PluginMqttClient;
  private _logger: Logger;
  private _tokenCacheTtlMs: number;
  private _maxCacheSize: number;
  private _tokenCache = new Map<string, CachedToken>();
  private _pendingRequests = new Map<string, PendingRequest>();
  private _userTokenMap = new Map<string, string>();
  private _correlationCounter = 0;

  constructor(mqtt: PluginMqttClient, logger: Logger, tokenCacheTtlMs = 300000, maxCacheSize = 10000) {
    this._mqtt = mqtt;
    this._logger = logger;
    this._tokenCacheTtlMs = tokenCacheTtlMs;
    this._maxCacheSize = maxCacheSize;
  }

  async initialize(): Promise<void> {
    await this._mqtt.subscribeWithHandler(
      'wos/identity/token/validate/response',
      (msg: any) => this._handleValidateResponse(msg.payload),
    );
    this._logger.info('AuthBridge initialized');
  }

  async validateToken(token: string): Promise<TokenValidationResult> {
    // Check cache first
    const cached = this._tokenCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return { valid: true, userId: cached.userId, role: cached.role };
    }

    // Remove expired entry
    if (cached) {
      this._tokenCache.delete(token);
    }

    // Send validation request to identity plugin
    const correlationId = `sync-auth-${++this._correlationCounter}-${Date.now()}`;

    return new Promise<TokenValidationResult>((resolve) => {
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(correlationId);
        this._logger.warn(`Token validation timed out (correlationId=${correlationId})`);
        resolve(invalidResult());
      }, VALIDATE_TIMEOUT_MS);

      this._pendingRequests.set(correlationId, { resolve, timeout, token });

      this._mqtt.publishRaw('wos/identity/token/validate', {
        correlationId,
        token,
      });
    });
  }

  setUserToken(clientId: string, token: string): void {
    this._userTokenMap.set(clientId, token);
  }

  getUserToken(clientId: string): string | undefined {
    return this._userTokenMap.get(clientId);
  }

  resolveToken(context: { clientId: string; clientToken?: string }): string | undefined {
    if (context.clientToken) {
      return context.clientToken;
    }
    const mapped = this._userTokenMap.get(context.clientId);
    return mapped || undefined;
  }

  invalidateToken(token: string): void {
    this._tokenCache.delete(token);
  }

  clearCache(): void {
    this._tokenCache.clear();
    this._userTokenMap.clear();
  }

  createAuthMiddleware(permissionChecker: PermissionCheckerInterface): AuthMiddleware {
    return async (operation: AuthOperation, context: AuthContext): Promise<boolean> => {
      try {
        // session.create is pre-checked by SessionRouter
        if (operation.type === 'session.create') {
          return true;
        }

        // session.exit is always allowed
        if (operation.type === 'session.exit') {
          return true;
        }

        // Resolve token
        const token = this.resolveToken(context);
        if (!token) {
          return false;
        }

        // Validate token
        const validation = await this.validateToken(token);
        if (!validation.valid) {
          return false;
        }

        const { userId } = validation;
        const { sessionId, entityId } = operation;

        // Session operations require sessionId
        if (SESSION_OPS.has(operation.type)) {
          if (!sessionId) {
            return false;
          }
          return permissionChecker.checkSessionPermission(operation, userId, sessionId);
        }

        // Entity operations
        if (operation.type.startsWith(ENTITY_OPS_PREFIX)) {
          if (!sessionId) {
            return false;
          }
          return permissionChecker.checkEntityPermission(operation, userId, sessionId, entityId);
        }

        // Unmapped operations (environment.*, custom.message) — allow by default
        return true;
      } catch (err: any) {
        this._logger.error(`Auth middleware error: ${err.message}`);
        return false;
      }
    };
  }

  async cleanup(): Promise<void> {
    // Reject all pending requests
    for (const [id, pending] of this._pendingRequests) {
      clearTimeout(pending.timeout);
      pending.resolve(invalidResult());
    }
    this._pendingRequests.clear();

    // Clear caches
    this._tokenCache.clear();
    this._userTokenMap.clear();

    try {
      await this._mqtt.unsubscribe('wos/identity/token/validate/response');
    } catch {
      // May already be unsubscribed
    }

    this._logger.info('AuthBridge cleaned up');
  }

  private _handleValidateResponse(payload: any): void {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    const { correlationId, valid, payload: tokenPayload } = payload;

    const pending = this._pendingRequests.get(correlationId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this._pendingRequests.delete(correlationId);

    if (!valid || !tokenPayload) {
      pending.resolve(invalidResult());
      return;
    }

    const { userId, role } = tokenPayload;
    const result: TokenValidationResult = { valid: true, userId, role };

    // Evict expired entries if cache is at capacity
    if (this._tokenCache.size >= this._maxCacheSize) {
      const now = Date.now();
      for (const [key, entry] of this._tokenCache) {
        if (entry.expiresAt <= now) {
          this._tokenCache.delete(key);
        }
      }
      // If still at capacity after expiry sweep, evict oldest entry
      if (this._tokenCache.size >= this._maxCacheSize) {
        const firstKey = this._tokenCache.keys().next().value;
        if (firstKey !== undefined) {
          this._tokenCache.delete(firstKey);
        }
      }
    }

    // Cache the successful result keyed by the original token
    this._tokenCache.set(pending.token, {
      userId,
      role,
      expiresAt: Date.now() + this._tokenCacheTtlMs,
    });

    pending.resolve(result);
  }
}
