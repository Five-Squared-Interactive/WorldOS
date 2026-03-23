// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import type Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';

/**
 * Payload stored in access tokens (JWT)
 */
export interface AccessTokenPayload {
  userId: string;
  role: string;
  sessionId: string;
  iat?: number;
  exp?: number;
}

/**
 * Refresh token record stored in DB
 */
export interface RefreshTokenRecord {
  token: string;
  userId: string;
  sessionId: string;
  expiresAt: string;
  createdAt: string;
}

/**
 * Result of a token refresh operation
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * JWT + refresh token management.
 * Access tokens are short-lived signed JWTs.
 * Refresh tokens are 32-byte random hex strings stored in SQLite.
 */
export class TokenManager {
  private db: Database.Database;
  private secret: string;
  private accessTtl: number;
  private refreshTtl: number;

  constructor(db: Database.Database, secret: string, accessTtl = 900, refreshTtl = 604800) {
    this.db = db;
    this.secret = secret;
    this.accessTtl = accessTtl;
    this.refreshTtl = refreshTtl;
  }

  /**
   * Issue a short-lived JWT access token.
   */
  issueAccessToken(userId: string, role: string, sessionId: string): string {
    return jwt.sign(
      { userId, role, sessionId },
      this.secret,
      { expiresIn: this.accessTtl }
    );
  }

  /**
   * Verify and decode an access token. Returns null if invalid or expired.
   */
  verifyAccessToken(token: string): AccessTokenPayload | null {
    try {
      const decoded = jwt.verify(token, this.secret) as AccessTokenPayload;
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Issue a refresh token (random 32-byte hex string) and store in DB.
   */
  issueRefreshToken(userId: string, sessionId: string): string {
    const token = randomBytes(32).toString('hex');
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + this.refreshTtl * 1000).toISOString();

    this.db
      .prepare(
        `INSERT INTO refresh_tokens (token, userId, sessionId, expiresAt, createdAt)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(token, userId, sessionId, expiresAt, now);

    return token;
  }

  /**
   * Validate a refresh token. Returns the record if valid and not expired, null otherwise.
   */
  validateRefreshToken(token: string): RefreshTokenRecord | null {
    const row = this.db
      .prepare('SELECT * FROM refresh_tokens WHERE token = ?')
      .get(token) as RefreshTokenRecord | undefined;

    if (!row) return null;

    // Check expiration
    if (new Date(row.expiresAt).getTime() <= Date.now()) {
      return null;
    }

    return row;
  }

  /**
   * Exchange a refresh token for a new access + refresh token pair.
   * Atomically invalidates the old refresh token and creates a new one.
   * Returns null if the refresh token is invalid or expired.
   */
  refreshTokens(refreshToken: string, role: string): TokenPair | null {
    const existing = this.validateRefreshToken(refreshToken);
    if (!existing) return null;

    // Atomic: delete old, create new in a transaction
    const result = this.db.transaction(() => {
      this.db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refreshToken);
      const newRefresh = this.issueRefreshToken(existing.userId, existing.sessionId);
      const newAccess = this.issueAccessToken(existing.userId, role, existing.sessionId);
      return { accessToken: newAccess, refreshToken: newRefresh };
    })();

    return result;
  }

  /**
   * Revoke a specific refresh token. Returns true if deleted, false if not found.
   */
  revokeRefreshToken(token: string): boolean {
    const result = this.db
      .prepare('DELETE FROM refresh_tokens WHERE token = ?')
      .run(token);
    return result.changes > 0;
  }

  /**
   * Revoke all refresh tokens for a user. Returns the number revoked.
   */
  revokeAllUserTokens(userId: string): number {
    const result = this.db
      .prepare('DELETE FROM refresh_tokens WHERE userId = ?')
      .run(userId);
    return result.changes;
  }

  /**
   * Remove all expired refresh tokens from the database. Returns the count removed.
   */
  cleanupExpiredTokens(): number {
    const now = new Date().toISOString();
    const result = this.db
      .prepare('DELETE FROM refresh_tokens WHERE expiresAt <= ?')
      .run(now);
    return result.changes;
  }
}
