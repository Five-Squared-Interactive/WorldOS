// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

/**
 * Session record
 */
export interface Session {
  id: string;
  userId: string;
  createdAt: string;
  lastActivity: string;
  endedAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Optional metadata when creating a session
 */
export interface SessionMetadata {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * SQLite-backed session manager.
 * Sessions have an endedAt field — null means active.
 */
export class SessionManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Create a new session for a user.
   */
  createSession(userId: string, metadata?: SessionMetadata): Session {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO sessions (id, userId, createdAt, lastActivity, endedAt, ipAddress, userAgent)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(
        id,
        userId,
        now,
        now,
        metadata?.ipAddress ?? null,
        metadata?.userAgent ?? null
      );

    return {
      id,
      userId,
      createdAt: now,
      lastActivity: now,
      endedAt: null,
      ipAddress: metadata?.ipAddress ?? null,
      userAgent: metadata?.userAgent ?? null,
    };
  }

  /**
   * Get a session by ID (returns both active and ended sessions).
   */
  getSession(sessionId: string): Session | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(sessionId) as Session | undefined;
    return row ?? null;
  }

  /**
   * Get all active (non-ended) sessions for a user.
   */
  getUserSessions(userId: string): Session[] {
    return this.db
      .prepare('SELECT * FROM sessions WHERE userId = ? AND endedAt IS NULL ORDER BY createdAt ASC')
      .all(userId) as Session[];
  }

  /**
   * Update the lastActivity timestamp on an active session.
   * Returns false if session doesn't exist or is already ended.
   */
  updateActivity(sessionId: string): boolean {
    const now = new Date().toISOString();
    const result = this.db
      .prepare('UPDATE sessions SET lastActivity = ? WHERE id = ? AND endedAt IS NULL')
      .run(now, sessionId);
    return result.changes > 0;
  }

  /**
   * End a session by setting endedAt. Returns false if not found or already ended.
   */
  endSession(sessionId: string): boolean {
    const now = new Date().toISOString();
    const result = this.db
      .prepare('UPDATE sessions SET endedAt = ? WHERE id = ? AND endedAt IS NULL')
      .run(now, sessionId);
    return result.changes > 0;
  }

  /**
   * End all active sessions for a user. Returns the count ended.
   */
  endAllUserSessions(userId: string): number {
    const now = new Date().toISOString();
    const result = this.db
      .prepare('UPDATE sessions SET endedAt = ? WHERE userId = ? AND endedAt IS NULL')
      .run(now, userId);
    return result.changes;
  }

  /**
   * Get the total number of active sessions across all users.
   */
  getActiveSessionCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM sessions WHERE endedAt IS NULL')
      .get() as { count: number };
    return row.count;
  }
}
