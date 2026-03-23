// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TokenManager } from '../src/token-manager.js';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

const TEST_SECRET = 'test-jwt-secret-256-bits-long-key!';
const ACCESS_TTL = 900; // 15 min
const REFRESH_TTL = 604800; // 7 days

describe('TokenManager', () => {
  let db: Database.Database;
  let tokenManager: TokenManager;

  beforeEach(() => {
    vi.useFakeTimers();
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create the users table (TokenManager depends on it via FK)
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        displayName TEXT NOT NULL,
        avatarUrl TEXT,
        passwordHash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'user', 'guest')),
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        deletedAt TEXT
      );
    `);

    // Create the refresh_tokens table
    db.exec(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        token TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        expiresAt TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id)
      );
    `);

    // Insert a test user for FK constraints
    db.prepare(
      `INSERT INTO users (id, username, email, displayName, passwordHash, role, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('user-1', 'alice', 'alice@example.com', 'Alice', '$2b$10$hash', 'user', new Date().toISOString(), new Date().toISOString());

    db.prepare(
      `INSERT INTO users (id, username, email, displayName, passwordHash, role, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('user-2', 'bob', 'bob@example.com', 'Bob', '$2b$10$hash', 'admin', new Date().toISOString(), new Date().toISOString());

    tokenManager = new TokenManager(db, TEST_SECRET, ACCESS_TTL, REFRESH_TTL);
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  describe('issueAccessToken', () => {
    it('should return a valid JWT string', () => {
      const token = tokenManager.issueAccessToken('user-1', 'user', 'session-1');
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should contain userId, role, and sessionId in payload', () => {
      const token = tokenManager.issueAccessToken('user-1', 'user', 'session-1');
      const decoded = jwt.verify(token, TEST_SECRET) as Record<string, unknown>;
      expect(decoded.userId).toBe('user-1');
      expect(decoded.role).toBe('user');
      expect(decoded.sessionId).toBe('session-1');
    });

    it('should set correct expiration', () => {
      const now = new Date('2026-01-01T00:00:00Z');
      vi.setSystemTime(now);

      const token = tokenManager.issueAccessToken('user-1', 'user', 'session-1');
      const decoded = jwt.verify(token, TEST_SECRET) as Record<string, unknown>;
      // exp should be now + ACCESS_TTL (900s)
      expect(decoded.exp).toBe(Math.floor(now.getTime() / 1000) + ACCESS_TTL);
    });
  });

  describe('verifyAccessToken', () => {
    it('should verify a valid access token', () => {
      const token = tokenManager.issueAccessToken('user-1', 'user', 'session-1');
      const payload = tokenManager.verifyAccessToken(token);
      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe('user-1');
      expect(payload!.role).toBe('user');
      expect(payload!.sessionId).toBe('session-1');
    });

    it('should reject an expired access token', () => {
      const token = tokenManager.issueAccessToken('user-1', 'user', 'session-1');
      // Advance past TTL
      vi.advanceTimersByTime((ACCESS_TTL + 1) * 1000);
      const payload = tokenManager.verifyAccessToken(token);
      expect(payload).toBeNull();
    });

    it('should reject a tampered access token', () => {
      const token = tokenManager.issueAccessToken('user-1', 'user', 'session-1');
      // Tamper with the payload
      const parts = token.split('.');
      parts[1] = Buffer.from(JSON.stringify({ userId: 'hacker', role: 'admin' })).toString('base64url');
      const tampered = parts.join('.');
      const payload = tokenManager.verifyAccessToken(tampered);
      expect(payload).toBeNull();
    });

    it('should reject a token signed with a different secret', () => {
      const badToken = jwt.sign({ userId: 'user-1', role: 'user', sessionId: 's1' }, 'wrong-secret', { expiresIn: ACCESS_TTL });
      const payload = tokenManager.verifyAccessToken(badToken);
      expect(payload).toBeNull();
    });
  });

  describe('issueRefreshToken', () => {
    it('should return a hex string token', () => {
      const token = tokenManager.issueRefreshToken('user-1', 'session-1');
      expect(typeof token).toBe('string');
      expect(token).toMatch(/^[0-9a-f]{64}$/); // 32 bytes = 64 hex chars
    });

    it('should store the token in the database', () => {
      const token = tokenManager.issueRefreshToken('user-1', 'session-1');
      const row = db.prepare('SELECT * FROM refresh_tokens WHERE token = ?').get(token) as Record<string, unknown> | undefined;
      expect(row).toBeDefined();
      expect(row!.userId).toBe('user-1');
      expect(row!.sessionId).toBe('session-1');
      expect(row!.expiresAt).toBeDefined();
      expect(row!.createdAt).toBeDefined();
    });

    it('should set correct expiration in DB', () => {
      const now = new Date('2026-01-01T00:00:00Z');
      vi.setSystemTime(now);

      const token = tokenManager.issueRefreshToken('user-1', 'session-1');
      const row = db.prepare('SELECT expiresAt FROM refresh_tokens WHERE token = ?').get(token) as { expiresAt: string };
      const expectedExpiry = new Date(now.getTime() + REFRESH_TTL * 1000).toISOString();
      expect(row.expiresAt).toBe(expectedExpiry);
    });
  });

  describe('validateRefreshToken', () => {
    it('should return token data for a valid refresh token', () => {
      const token = tokenManager.issueRefreshToken('user-1', 'session-1');
      const result = tokenManager.validateRefreshToken(token);
      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-1');
      expect(result!.sessionId).toBe('session-1');
    });

    it('should return null for non-existent token', () => {
      const result = tokenManager.validateRefreshToken('nonexistent-token');
      expect(result).toBeNull();
    });

    it('should return null for expired refresh token', () => {
      const token = tokenManager.issueRefreshToken('user-1', 'session-1');
      // Advance past refresh TTL
      vi.advanceTimersByTime((REFRESH_TTL + 1) * 1000);
      const result = tokenManager.validateRefreshToken(token);
      expect(result).toBeNull();
    });
  });

  describe('refreshTokens', () => {
    it('should return new access + refresh token pair', () => {
      const oldRefresh = tokenManager.issueRefreshToken('user-1', 'session-1');
      const result = tokenManager.refreshTokens(oldRefresh, 'user');
      expect(result).not.toBeNull();
      expect(result!.accessToken).toBeDefined();
      expect(result!.refreshToken).toBeDefined();
      expect(result!.refreshToken).not.toBe(oldRefresh);
    });

    it('should invalidate the old refresh token', () => {
      const oldRefresh = tokenManager.issueRefreshToken('user-1', 'session-1');
      tokenManager.refreshTokens(oldRefresh, 'user');
      // Old token should no longer be valid
      const result = tokenManager.validateRefreshToken(oldRefresh);
      expect(result).toBeNull();
    });

    it('should produce a valid new access token', () => {
      const oldRefresh = tokenManager.issueRefreshToken('user-1', 'session-1');
      const result = tokenManager.refreshTokens(oldRefresh, 'user')!;
      const payload = tokenManager.verifyAccessToken(result.accessToken);
      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe('user-1');
      expect(payload!.role).toBe('user');
      expect(payload!.sessionId).toBe('session-1');
    });

    it('should return null for invalid refresh token', () => {
      const result = tokenManager.refreshTokens('nonexistent', 'user');
      expect(result).toBeNull();
    });

    it('should return null for expired refresh token', () => {
      const oldRefresh = tokenManager.issueRefreshToken('user-1', 'session-1');
      vi.advanceTimersByTime((REFRESH_TTL + 1) * 1000);
      const result = tokenManager.refreshTokens(oldRefresh, 'user');
      expect(result).toBeNull();
    });
  });

  describe('revokeRefreshToken', () => {
    it('should remove the token from the database', () => {
      const token = tokenManager.issueRefreshToken('user-1', 'session-1');
      const result = tokenManager.revokeRefreshToken(token);
      expect(result).toBe(true);
      expect(tokenManager.validateRefreshToken(token)).toBeNull();
    });

    it('should return false for non-existent token', () => {
      const result = tokenManager.revokeRefreshToken('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('revokeAllUserTokens', () => {
    it('should remove all tokens for a user', () => {
      const t1 = tokenManager.issueRefreshToken('user-1', 'session-1');
      const t2 = tokenManager.issueRefreshToken('user-1', 'session-2');
      const t3 = tokenManager.issueRefreshToken('user-2', 'session-3');

      const count = tokenManager.revokeAllUserTokens('user-1');
      expect(count).toBe(2);
      expect(tokenManager.validateRefreshToken(t1)).toBeNull();
      expect(tokenManager.validateRefreshToken(t2)).toBeNull();
      // user-2's token should be unaffected
      expect(tokenManager.validateRefreshToken(t3)).not.toBeNull();
    });

    it('should return 0 when user has no tokens', () => {
      const count = tokenManager.revokeAllUserTokens('user-1');
      expect(count).toBe(0);
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should remove expired tokens from the database', () => {
      tokenManager.issueRefreshToken('user-1', 'session-1');
      tokenManager.issueRefreshToken('user-1', 'session-2');

      // Advance past refresh TTL so both are expired
      vi.advanceTimersByTime((REFRESH_TTL + 1) * 1000);

      // Issue a fresh one that should NOT be cleaned up
      const fresh = tokenManager.issueRefreshToken('user-2', 'session-3');

      const count = tokenManager.cleanupExpiredTokens();
      expect(count).toBe(2);

      // Fresh token should still be valid
      expect(tokenManager.validateRefreshToken(fresh)).not.toBeNull();
    });

    it('should return 0 when no tokens are expired', () => {
      tokenManager.issueRefreshToken('user-1', 'session-1');
      const count = tokenManager.cleanupExpiredTokens();
      expect(count).toBe(0);
    });
  });
});
