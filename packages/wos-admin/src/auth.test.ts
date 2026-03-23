/**
 * Authentication Tests
 *
 * Story 7.2: Authentication System
 *
 * Login/logout with local credentials.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AuthManager,
  hashPassword,
  verifyPassword,
  generateSessionToken,
  type MqttClientLike,
} from './auth.js';

describe('Authentication', () => {
  describe('password hashing', () => {
    it('should hash password', async () => {
      const hash = await hashPassword('mypassword');

      expect(hash).toBeDefined();
      expect(hash).not.toBe('mypassword');
      expect(hash.startsWith('$2')).toBe(true); // bcrypt prefix
    });

    it('should verify correct password', async () => {
      const hash = await hashPassword('mypassword');
      const valid = await verifyPassword('mypassword', hash);

      expect(valid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const hash = await hashPassword('mypassword');
      const valid = await verifyPassword('wrongpassword', hash);

      expect(valid).toBe(false);
    });
  });

  describe('session tokens', () => {
    it('should generate unique tokens', () => {
      const token1 = generateSessionToken();
      const token2 = generateSessionToken();

      expect(token1).not.toBe(token2);
    });

    it('should generate tokens of sufficient length', () => {
      const token = generateSessionToken();

      expect(token.length).toBeGreaterThanOrEqual(32);
    });
  });

  describe('AuthManager', () => {
    let authManager: AuthManager;

    beforeEach(() => {
      authManager = new AuthManager();
    });

    describe('setCredentials', () => {
      it('should store hashed credentials', async () => {
        await authManager.setCredentials('admin', 'password123');

        const valid = await authManager.validateCredentials('admin', 'password123');
        expect(valid).toBe(true);
      });

      it('should not store plain text password', async () => {
        await authManager.setCredentials('admin', 'password123');

        // Access internal state for testing
        const stored = (authManager as any).credentials;
        expect(stored?.password).not.toBe('password123');
      });
    });

    describe('validateCredentials', () => {
      beforeEach(async () => {
        await authManager.setCredentials('admin', 'secret123');
      });

      it('should return true for valid credentials', async () => {
        const valid = await authManager.validateCredentials('admin', 'secret123');
        expect(valid).toBe(true);
      });

      it('should return false for wrong password', async () => {
        const valid = await authManager.validateCredentials('admin', 'wrongpass');
        expect(valid).toBe(false);
      });

      it('should return false for wrong username', async () => {
        const valid = await authManager.validateCredentials('wronguser', 'secret123');
        expect(valid).toBe(false);
      });

      it('should return false when no credentials set', async () => {
        const emptyManager = new AuthManager();
        const valid = await emptyManager.validateCredentials('admin', 'password');
        expect(valid).toBe(false);
      });
    });

    describe('sessions', () => {
      beforeEach(async () => {
        await authManager.setCredentials('admin', 'password');
      });

      it('should create session on successful login', async () => {
        const session = await authManager.login('admin', 'password');

        expect(session).toBeDefined();
        expect(session?.token).toBeDefined();
        expect(session?.username).toBe('admin');
      });

      it('should return null on failed login', async () => {
        const session = await authManager.login('admin', 'wrongpassword');

        expect(session).toBeNull();
      });

      it('should validate active session', async () => {
        const session = await authManager.login('admin', 'password');

        const valid = authManager.validateSession(session!.token);
        expect(valid).toBe(true);
      });

      it('should reject invalid session token', () => {
        const valid = authManager.validateSession('invalid-token');
        expect(valid).toBe(false);
      });

      it('should invalidate session on logout', async () => {
        const session = await authManager.login('admin', 'password');

        authManager.logout(session!.token);

        const valid = authManager.validateSession(session!.token);
        expect(valid).toBe(false);
      });

      it('should get session data', async () => {
        const session = await authManager.login('admin', 'password');

        const sessionData = authManager.getSession(session!.token);
        expect(sessionData?.username).toBe('admin');
      });
    });

    describe('session expiry', () => {
      beforeEach(async () => {
        await authManager.setCredentials('admin', 'password');
      });

      it('should include expiry time in session', async () => {
        const session = await authManager.login('admin', 'password');

        expect(session?.expiresAt).toBeDefined();
        expect(session!.expiresAt).toBeGreaterThan(Date.now());
      });

      it('should respect custom session duration', async () => {
        const shortManager = new AuthManager({ sessionDurationMs: 1000 });
        await shortManager.setCredentials('admin', 'password');

        const session = await shortManager.login('admin', 'password');
        const expectedExpiry = Date.now() + 1000;

        expect(session!.expiresAt).toBeLessThanOrEqual(expectedExpiry + 100);
        expect(session!.expiresAt).toBeGreaterThanOrEqual(expectedExpiry - 100);
      });
    });

    describe('loadFromConfig', () => {
      it('should load pre-hashed password', async () => {
        const hash = await hashPassword('mypassword');

        authManager.loadFromConfig({
          username: 'admin',
          password: hash,
        });

        const valid = await authManager.validateCredentials('admin', 'mypassword');
        expect(valid).toBe(true);
      });
    });

    describe('MQTT delegation', () => {
      it('should report hasMqttClient false by default', () => {
        expect(authManager.hasMqttClient()).toBe(false);
      });

      it('should report hasMqttClient true after setMqttClient', () => {
        const mockMqtt: MqttClientLike = {
          publish: vi.fn(),
          subscribe: vi.fn().mockResolvedValue(undefined),
        };
        authManager.setMqttClient(mockMqtt);
        expect(authManager.hasMqttClient()).toBe(true);
      });

      it('should delegate to MQTT when client is set and succeed', async () => {
        await authManager.setCredentials('admin', 'password');

        let subscribeHandler: Function | null = null;
        const mockMqtt: MqttClientLike = {
          publish: vi.fn((topic: string, payload: any) => {
            // Simulate immediate identity plugin response
            if (subscribeHandler) {
              subscribeHandler('wos/identity/auth/login/response', {
                correlationId: payload.correlationId,
                accessToken: 'some-jwt',
              });
            }
          }),
          subscribe: vi.fn(async (topic: string, handler: Function) => {
            subscribeHandler = handler;
          }),
        };
        authManager.setMqttClient(mockMqtt);

        // Even wrong local password should succeed if MQTT says yes
        const valid = await authManager.validateCredentials('admin', 'wrong-local-password');
        expect(valid).toBe(true);
      });

      it('should fall back to local auth when MQTT times out', async () => {
        vi.useFakeTimers();
        await authManager.setCredentials('admin', 'password');

        const mockMqtt: MqttClientLike = {
          publish: vi.fn(), // never responds
          subscribe: vi.fn().mockResolvedValue(undefined),
        };
        authManager.setMqttClient(mockMqtt);

        const promise = authManager.validateCredentials('admin', 'password');
        vi.advanceTimersByTime(2100); // past 2s timeout
        const valid = await promise;
        // Falls back to local — correct password
        expect(valid).toBe(true);

        vi.useRealTimers();
      });

      it('should fall back to local auth when MQTT subscribe fails', async () => {
        await authManager.setCredentials('admin', 'password');

        const mockMqtt: MqttClientLike = {
          publish: vi.fn(),
          subscribe: vi.fn().mockRejectedValue(new Error('not connected')),
        };
        authManager.setMqttClient(mockMqtt);

        const valid = await authManager.validateCredentials('admin', 'password');
        expect(valid).toBe(true);
      });
    });
  });
});
