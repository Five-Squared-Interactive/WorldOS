/**
 * Authentication Module
 *
 * Story 7.2: Authentication System
 *
 * Local authentication with sessions.
 */

import * as crypto from 'crypto';
import bcrypt from 'bcrypt';

/**
 * Session data
 */
export interface Session {
  token: string;
  username: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Stored credentials
 */
interface Credentials {
  username: string;
  password: string; // bcrypt hash
}

/**
 * Minimal MQTT client interface for identity plugin delegation
 */
export interface MqttClientLike {
  publish(topic: string, payload: unknown): void;
  subscribe(topic: string, handler: (topic: string, message: unknown) => void): Promise<void>;
}

/**
 * Auth manager options
 */
export interface AuthManagerOptions {
  sessionDurationMs?: number; // default 24 hours
  saltRounds?: number; // bcrypt salt rounds
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string, saltRounds = 10): Promise<string> {
  return bcrypt.hash(password, saltRounds);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a secure session token
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Manages authentication and sessions
 */
export class AuthManager {
  private credentials: Credentials | null = null;
  private sessions: Map<string, Session> = new Map();
  private sessionDurationMs: number;
  private saltRounds: number;
  private mqttClient: MqttClientLike | null = null;

  constructor(options: AuthManagerOptions = {}) {
    this.sessionDurationMs = options.sessionDurationMs ?? 24 * 60 * 60 * 1000; // 24 hours
    this.saltRounds = options.saltRounds ?? 10;
  }

  /**
   * Set MQTT client for delegating credential validation to the identity plugin.
   * When set, validateCredentials will attempt MQTT-based auth first (2s timeout),
   * falling back to local bcrypt check on failure/timeout.
   */
  setMqttClient(client: MqttClientLike): void {
    this.mqttClient = client;
  }

  /**
   * Check if MQTT client is configured for identity plugin delegation.
   */
  hasMqttClient(): boolean {
    return this.mqttClient !== null;
  }

  /**
   * Set credentials (hashes the password)
   */
  async setCredentials(username: string, password: string): Promise<void> {
    const hashedPassword = await hashPassword(password, this.saltRounds);
    this.credentials = {
      username,
      password: hashedPassword,
    };
  }

  /**
   * Load credentials from config (password already hashed)
   */
  loadFromConfig(config: { username: string; password: string }): void {
    this.credentials = {
      username: config.username,
      password: config.password,
    };
  }

  /**
   * Validate credentials.
   * When MQTT client is set, delegates to identity plugin with 2s timeout.
   * Falls back to local bcrypt check on failure/timeout.
   */
  async validateCredentials(username: string, password: string): Promise<boolean> {
    // Try MQTT delegation first if available
    if (this.mqttClient) {
      try {
        const result = await this.validateViaMqtt(username, password);
        if (result !== null) return result;
      } catch {
        // Fall through to local auth
      }
    }

    // Local auth fallback
    if (!this.credentials) {
      return false;
    }

    if (this.credentials.username !== username) {
      return false;
    }

    return verifyPassword(password, this.credentials.password);
  }

  /**
   * Attempt to validate credentials via the identity plugin over MQTT.
   * Returns true/false on success, null on timeout/error.
   */
  private validateViaMqtt(username: string, password: string): Promise<boolean | null> {
    return new Promise((resolve) => {
      const correlationId = crypto.randomBytes(16).toString('hex');
      const responseTopic = 'wos/identity/auth/login/response';
      let settled = false;

      // 2 second timeout
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, 2000);

      // Subscribe to response
      this.mqttClient!.subscribe(responseTopic, (_topic: string, msg: unknown) => {
        const response = msg as { correlationId?: string; error?: string; accessToken?: string };
        if (response.correlationId !== correlationId) return;
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(!response.error && !!response.accessToken);
      }).then(() => {
        // Publish login request
        this.mqttClient!.publish('wos/identity/auth/login', {
          correlationId,
          username,
          password,
        });
      }).catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(null);
        }
      });
    });
  }

  /**
   * Login and create session
   */
  async login(username: string, password: string): Promise<Session | null> {
    const valid = await this.validateCredentials(username, password);
    if (!valid) {
      return null;
    }

    const token = generateSessionToken();
    const now = Date.now();

    const session: Session = {
      token,
      username,
      createdAt: now,
      expiresAt: now + this.sessionDurationMs,
    };

    this.sessions.set(token, session);

    return session;
  }

  /**
   * Logout and invalidate session
   */
  logout(token: string): void {
    this.sessions.delete(token);
  }

  /**
   * Validate a session token
   */
  validateSession(token: string): boolean {
    const session = this.sessions.get(token);
    if (!session) {
      return false;
    }

    // Check expiry
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return false;
    }

    return true;
  }

  /**
   * Get session data
   */
  getSession(token: string): Session | null {
    if (!this.validateSession(token)) {
      return null;
    }
    return this.sessions.get(token) ?? null;
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [token, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(token);
      }
    }
  }

  /**
   * Check if credentials are configured
   */
  hasCredentials(): boolean {
    return this.credentials !== null;
  }
}
