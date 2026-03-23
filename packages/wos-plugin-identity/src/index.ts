// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { WOSPlugin, PluginContext, HealthCheckResult } from '@worldos/plugin-sdk';
import { UserStore } from './user-store.js';
import { TokenManager } from './token-manager.js';
import { SessionManager } from './session-manager.js';
import { hasPermission, canAccessResource, type Role, type Action } from './permissions.js';
import { collectHealthStatus } from './health.js';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Default config values
 */
const DEFAULTS = {
  access_token_ttl: 900,
  refresh_token_ttl: 604800,
  allow_registration: false,
  bcrypt_salt_rounds: 10,
};

/**
 * Rate limiter entry
 */
interface RateLimitEntry {
  count: number;
  lastAttempt: number;
}

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_COOLDOWN_MS = 30_000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 min

/**
 * Identity Plugin — user auth, JWT tokens, RBAC permissions.
 */
export class IdentityPlugin extends WOSPlugin {
  private db: Database.Database | null = null;
  private userStore: UserStore | null = null;
  private tokenManager: TokenManager | null = null;
  private sessionManager: SessionManager | null = null;
  private rateLimiter = new Map<string, RateLimitEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private _ctx: PluginContext | null = null;
  private _identityConfig: Record<string, unknown> = {};

  constructor() {
    super();
  }

  async onStart(context: PluginContext): Promise<void> {
    this._ctx = context;
    this._identityConfig = { ...DEFAULTS, ...context.config };

    // 1. Resolve JWT secret
    const jwtSecret = this.resolveJwtSecret(context);

    // 2. Open SQLite DB
    const serverDir = (context as any).serverDir;
    let dbPath = ':memory:';
    if (serverDir) {
      try {
        const dataDir = path.join(serverDir, 'data');
        fs.mkdirSync(dataDir, { recursive: true });
        dbPath = path.join(dataDir, 'identity.db');
      } catch {
        // Fall back to in-memory if directory creation fails
        dbPath = ':memory:';
      }
    }

    // 3. Instantiate services (UserStore creates tables)
    this.userStore = new UserStore(dbPath);
    const sharedDb = this.userStore.getDatabase();
    this.tokenManager = new TokenManager(
      sharedDb,
      jwtSecret,
      this._identityConfig.access_token_ttl as number,
      this._identityConfig.refresh_token_ttl as number,
    );
    this.sessionManager = new SessionManager(sharedDb);

    // 4. Rate limiter already initialized

    // 5. Subscribe to MQTT topics
    await context.mqtt.subscribeWithHandler('wos/identity/auth/login', (msg) => this.handleLogin(msg.payload));
    await context.mqtt.subscribeWithHandler('wos/identity/auth/register', (msg) => this.handleRegister(msg.payload));
    await context.mqtt.subscribeWithHandler('wos/identity/auth/refresh', (msg) => this.handleRefresh(msg.payload));
    await context.mqtt.subscribeWithHandler('wos/identity/auth/logout', (msg) => this.handleLogout(msg.payload));
    await context.mqtt.subscribeWithHandler('wos/identity/token/validate', (msg) => this.handleTokenValidate(msg.payload));
    await context.mqtt.subscribeWithHandler('wos/identity/permission/check', (msg) => this.handlePermissionCheck(msg.payload));

    // Admin panel queries
    await context.mqtt.subscribeWithHandler('wos/identity/admin/stats', (msg) => this.handleAdminStats(msg.payload));
    await context.mqtt.subscribeWithHandler('wos/identity/admin/users', (msg) => this.handleAdminUsers(msg.payload));

    // 7. Seed admin user if configured and no admins exist
    await this.seedAdminUser();

    // 8. Start cleanup timer
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);

    context.logger.info('Identity plugin started');
  }

  async onStop(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.userStore) {
      this.userStore.close();
      this.userStore = null;
    }
    this.tokenManager = null;
    this.sessionManager = null;
    this.rateLimiter.clear();
    this._ctx = null;
  }

  async onHealthCheck(): Promise<HealthCheckResult> {
    if (!this.userStore || !this.sessionManager) {
      return { status: 'unhealthy', details: { error: 'Services not initialized' } };
    }
    const health = collectHealthStatus(this.userStore, this.sessionManager);
    return {
      status: health.status,
      details: health.details,
    };
  }

  /** Expose UserStore for testing and CLI */
  getUserStore(): UserStore {
    if (!this.userStore) throw new Error('Plugin not started');
    return this.userStore;
  }

  /** Expose TokenManager for testing */
  getTokenManager(): TokenManager {
    if (!this.tokenManager) throw new Error('Plugin not started');
    return this.tokenManager;
  }

  /** Expose SessionManager for testing */
  getSessionManager(): SessionManager {
    if (!this.sessionManager) throw new Error('Plugin not started');
    return this.sessionManager;
  }

  // ── Private handlers ──

  private async handleLogin(msg: unknown): Promise<void> {
    const { correlationId, username, password } = msg as {
      correlationId: string;
      username: string;
      password: string;
    };

    try {
      // Rate limit check
      if (this.isRateLimited(username)) {
        this.respond('wos/identity/auth/login/response', {
          correlationId,
          error: 'Too many failed attempts. Please try again later.',
        });
        return;
      }

      // Find user
      const user = this.userStore!.getUserByUsername(username);
      if (!user) {
        this.recordFailedLogin(username);
        this.respond('wos/identity/auth/login/response', {
          correlationId,
          error: 'Invalid username or password',
        });
        return;
      }

      // Verify password (async)
      const hash = this.userStore!.getPasswordHash(user.id);
      if (!hash) {
        this.recordFailedLogin(username);
        this.respond('wos/identity/auth/login/response', {
          correlationId,
          error: 'Invalid username or password',
        });
        return;
      }

      const valid = await bcrypt.compare(password, hash);
      if (!valid) {
        this.recordFailedLogin(username);
        this.respond('wos/identity/auth/login/response', {
          correlationId,
          error: 'Invalid username or password',
        });
        return;
      }

      // Success — reset rate limiter
      this.rateLimiter.delete(username);

      // Create session
      const session = this.sessionManager!.createSession(user.id);

      // Issue tokens
      const accessToken = this.tokenManager!.issueAccessToken(user.id, user.role, session.id);
      const refreshToken = this.tokenManager!.issueRefreshToken(user.id, session.id);

      this.respond('wos/identity/auth/login/response', {
        correlationId,
        accessToken,
        refreshToken,
        sessionId: session.id,
        user,
      });
    } catch (error) {
      this._ctx?.logger.error('Login error', { error });
      this.respond('wos/identity/auth/login/response', {
        correlationId,
        error: 'Internal error',
      });
    }
  }

  private async handleRegister(msg: unknown): Promise<void> {
    const { correlationId, username, email, password, displayName } = msg as {
      correlationId: string;
      username: string;
      email: string;
      password: string;
      displayName: string;
    };

    try {
      if (!this._identityConfig.allow_registration) {
        this.respond('wos/identity/auth/register/response', {
          correlationId,
          error: 'Registration is not allowed',
        });
        return;
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, this._identityConfig.bcrypt_salt_rounds as number);

      // Create user
      const user = this.userStore!.createUser({
        username,
        email,
        passwordHash,
        displayName: displayName || username,
        role: 'user',
      });

      // Create session and issue tokens
      const session = this.sessionManager!.createSession(user.id);
      const accessToken = this.tokenManager!.issueAccessToken(user.id, user.role, session.id);
      const refreshToken = this.tokenManager!.issueRefreshToken(user.id, session.id);

      // Publish user created event
      this.respond('wos/identity/user/created', {
        userId: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      });

      this.respond('wos/identity/auth/register/response', {
        correlationId,
        user,
        accessToken,
        refreshToken,
        sessionId: session.id,
      });
    } catch (error: any) {
      this._ctx?.logger.error('Registration error', { error });
      this.respond('wos/identity/auth/register/response', {
        correlationId,
        error: error.message || 'Registration failed',
      });
    }
  }

  private async handleRefresh(msg: unknown): Promise<void> {
    const { correlationId, refreshToken } = msg as {
      correlationId: string;
      refreshToken: string;
    };

    try {
      // Validate refresh token to get userId for role lookup
      const tokenData = this.tokenManager!.validateRefreshToken(refreshToken);
      if (!tokenData) {
        this.respond('wos/identity/auth/refresh/response', {
          correlationId,
          error: 'Invalid or expired refresh token',
        });
        return;
      }

      // Look up user's current role
      const user = this.userStore!.getUserById(tokenData.userId);
      if (!user) {
        this.respond('wos/identity/auth/refresh/response', {
          correlationId,
          error: 'User not found',
        });
        return;
      }

      const result = this.tokenManager!.refreshTokens(refreshToken, user.role);
      if (!result) {
        this.respond('wos/identity/auth/refresh/response', {
          correlationId,
          error: 'Invalid or expired refresh token',
        });
        return;
      }

      this.respond('wos/identity/auth/refresh/response', {
        correlationId,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
    } catch (error) {
      this._ctx?.logger.error('Refresh error', { error });
      this.respond('wos/identity/auth/refresh/response', {
        correlationId,
        error: 'Internal error',
      });
    }
  }

  private async handleLogout(msg: unknown): Promise<void> {
    const { correlationId, sessionId, refreshToken } = msg as {
      correlationId: string;
      sessionId?: string;
      refreshToken?: string;
    };

    try {
      if (sessionId) {
        this.sessionManager!.endSession(sessionId);
      }
      if (refreshToken) {
        this.tokenManager!.revokeRefreshToken(refreshToken);
      }

      this.respond('wos/identity/auth/logout/response', {
        correlationId,
        success: true,
      });
    } catch (error) {
      this._ctx?.logger.error('Logout error', { error });
      this.respond('wos/identity/auth/logout/response', {
        correlationId,
        error: 'Internal error',
      });
    }
  }

  private async handleTokenValidate(msg: unknown): Promise<void> {
    const { correlationId, token } = msg as {
      correlationId: string;
      token: string;
    };

    const payload = this.tokenManager!.verifyAccessToken(token);
    this.respond('wos/identity/token/validate/response', {
      correlationId,
      valid: payload !== null,
      payload: payload || undefined,
    });
  }

  private async handlePermissionCheck(msg: unknown): Promise<void> {
    const { correlationId, role, action, resourceOwnerId, requestingUserId } = msg as {
      correlationId: string;
      role: string;
      action: string;
      resourceOwnerId?: string;
      requestingUserId?: string;
    };

    let allowed: boolean;
    if (resourceOwnerId && requestingUserId) {
      allowed = canAccessResource(role as Role, resourceOwnerId, requestingUserId, action as Action);
    } else {
      allowed = hasPermission(role as Role, action as Action);
    }

    this.respond('wos/identity/permission/check/response', {
      correlationId,
      allowed,
    });
  }

  // ── Admin handlers ──

  private handleAdminStats(msg: unknown): void {
    const { correlationId } = msg as { correlationId: string };
    const users = this.userStore!.listUsers();
    const activeSessions = this.sessionManager!.getActiveSessionCount();
    const byRole: Record<string, number> = {};
    for (const u of users) {
      byRole[u.role] = (byRole[u.role] || 0) + 1;
    }
    this.respond('wos/identity/admin/stats/response', {
      correlationId,
      totalUsers: users.length,
      activeSessions,
      byRole,
    });
  }

  private handleAdminUsers(msg: unknown): void {
    const { correlationId } = msg as { correlationId: string };
    const users = this.userStore!.listUsers();
    this.respond('wos/identity/admin/users/response', {
      correlationId,
      users: users.map(u => ({
        id: u.id,
        username: u.username,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        createdAt: u.createdAt,
      })),
    });
  }

  // ── Helpers ──

  private respond(topic: string, payload: unknown): void {
    this._ctx?.mqtt.publishRaw(topic, payload);
  }

  private resolveJwtSecret(context: PluginContext): string {
    // 1. Config
    const configSecret = (context.config as any)?.jwt_secret;
    if (configSecret && typeof configSecret === 'string') {
      return configSecret;
    }

    // 2. File on disk
    const serverDir = (context as any).serverDir;
    if (serverDir) {
      const secretPath = path.join(serverDir, 'data', 'identity-jwt-secret.key');
      try {
        if (fs.existsSync(secretPath)) {
          return fs.readFileSync(secretPath, 'utf-8').trim();
        }
      } catch { /* fall through */ }

      // 3. Generate and write
      const secret = randomBytes(32).toString('hex');
      try {
        fs.mkdirSync(path.join(serverDir, 'data'), { recursive: true });
        fs.writeFileSync(secretPath, secret, 'utf-8');
      } catch {
        context.logger.warn('Could not write JWT secret to disk');
      }
      return secret;
    }

    // 4. Fallback: generate ephemeral
    context.logger.warn('No JWT secret configured — generating ephemeral secret');
    return randomBytes(32).toString('hex');
  }

  private isRateLimited(username: string): boolean {
    const entry = this.rateLimiter.get(username);
    if (!entry) return false;
    if (entry.count < RATE_LIMIT_MAX) return false;
    // Check cooldown
    if (Date.now() - entry.lastAttempt > RATE_LIMIT_COOLDOWN_MS) {
      this.rateLimiter.delete(username);
      return false;
    }
    return true;
  }

  private recordFailedLogin(username: string): void {
    const entry = this.rateLimiter.get(username) || { count: 0, lastAttempt: 0 };
    entry.count++;
    entry.lastAttempt = Date.now();
    this.rateLimiter.set(username, entry);
  }

  private async seedAdminUser(): Promise<void> {
    if (!this.userStore) return;
    if (this.userStore.hasAdminUsers()) return;

    const username = this._identityConfig.admin_username as string;
    const email = this._identityConfig.admin_email as string;
    const password = this._identityConfig.admin_password as string;

    if (!username || !email || !password) return;

    try {
      const passwordHash = await bcrypt.hash(password, this._identityConfig.bcrypt_salt_rounds as number);
      this.userStore.createUser({
        username,
        email,
        passwordHash,
        displayName: username,
        role: 'admin',
      });
      this._ctx?.logger.info(`Seeded admin user: ${username}`);
    } catch (error) {
      this._ctx?.logger.error('Failed to seed admin user', { error });
    }
  }

  private cleanup(): void {
    // Cleanup expired tokens
    this.tokenManager?.cleanupExpiredTokens();

    // Cleanup stale rate limiter entries
    const now = Date.now();
    for (const [username, entry] of this.rateLimiter.entries()) {
      if (now - entry.lastAttempt > RATE_LIMIT_COOLDOWN_MS) {
        this.rateLimiter.delete(username);
      }
    }
  }
}

// Export singleton plugin instance
export const plugin = new IdentityPlugin();

// Re-export types and modules
export * from './user-store.js';
export * from './token-manager.js';
export * from './session-manager.js';
export * from './permissions.js';
export * from './health.js';

// Auto-start when spawned as a child process by wos-server
if (process.env.WOS_PLUGIN_NAME) {
  // Bridge WOS_MQTT_HOST/PORT to WOS_MQTT_URL for the SDK client
  if (!process.env.WOS_MQTT_URL && process.env.WOS_MQTT_HOST) {
    process.env.WOS_MQTT_URL = `mqtt://${process.env.WOS_MQTT_HOST}:${process.env.WOS_MQTT_PORT || '1883'}`;
  }

  const handleHealthCheck = (data: Buffer) => {
    for (const line of data.toString().split('\n')) {
      try {
        const msg = JSON.parse(line.trim());
        if (msg.type === 'health_check') {
          Promise.resolve(plugin.onHealthCheck()).then((health: any) => {
            process.stdout.write(JSON.stringify({
              type: 'health_response',
              correlationId: msg.correlationId,
              status: health?.status === 'ok' ? 'healthy' : (health?.status ?? 'healthy'),
              timestamp: new Date().toISOString(),
              details: health?.details,
            }) + '\n');
          }).catch(() => {});
        }
      } catch { /* not JSON */ }
    }
  };

  plugin.start().then(() => {
    process.stdin.on('data', handleHealthCheck);
  }).catch((err: Error) => {
    console.error(`[identity] Failed to start: ${err.message}`);
    process.exit(1);
  });

  const shutdown = () => {
    plugin.stop().then(() => process.exit(0)).catch(() => process.exit(1));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
