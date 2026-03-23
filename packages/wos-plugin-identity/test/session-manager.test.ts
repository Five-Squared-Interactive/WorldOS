// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../src/session-manager.js';
import Database from 'better-sqlite3';

describe('SessionManager', () => {
  let db: Database.Database;
  let sessionManager: SessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

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

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastActivity TEXT NOT NULL,
        endedAt TEXT,
        ipAddress TEXT,
        userAgent TEXT,
        FOREIGN KEY (userId) REFERENCES users(id)
      );
    `);

    // Insert test users
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO users (id, username, email, displayName, passwordHash, role, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('user-1', 'alice', 'alice@example.com', 'Alice', '$2b$10$hash', 'user', now, now);

    db.prepare(
      `INSERT INTO users (id, username, email, displayName, passwordHash, role, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('user-2', 'bob', 'bob@example.com', 'Bob', '$2b$10$hash', 'admin', now, now);

    sessionManager = new SessionManager(db);
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  describe('createSession', () => {
    it('should create a session and return it', () => {
      const session = sessionManager.createSession('user-1');
      expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(session.userId).toBe('user-1');
      expect(session.createdAt).toBeDefined();
      expect(session.lastActivity).toBeDefined();
      expect(session.endedAt).toBeNull();
    });

    it('should store optional metadata (ipAddress, userAgent)', () => {
      const session = sessionManager.createSession('user-1', {
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      });
      expect(session.ipAddress).toBe('192.168.1.1');
      expect(session.userAgent).toBe('Mozilla/5.0');
    });

    it('should allow multiple sessions per user', () => {
      const s1 = sessionManager.createSession('user-1');
      const s2 = sessionManager.createSession('user-1');
      expect(s1.id).not.toBe(s2.id);
    });
  });

  describe('getSession', () => {
    it('should return session by ID', () => {
      const created = sessionManager.createSession('user-1');
      const session = sessionManager.getSession(created.id);
      expect(session).not.toBeNull();
      expect(session!.userId).toBe('user-1');
    });

    it('should return null for non-existent session', () => {
      const session = sessionManager.getSession('nonexistent');
      expect(session).toBeNull();
    });
  });

  describe('getUserSessions', () => {
    it('should return active sessions for a user', () => {
      sessionManager.createSession('user-1');
      sessionManager.createSession('user-1');
      sessionManager.createSession('user-2');

      const sessions = sessionManager.getUserSessions('user-1');
      expect(sessions).toHaveLength(2);
      sessions.forEach((s) => expect(s.userId).toBe('user-1'));
    });

    it('should exclude ended sessions', () => {
      const s1 = sessionManager.createSession('user-1');
      sessionManager.createSession('user-1');

      sessionManager.endSession(s1.id);

      const sessions = sessionManager.getUserSessions('user-1');
      expect(sessions).toHaveLength(1);
    });

    it('should return empty array for user with no sessions', () => {
      const sessions = sessionManager.getUserSessions('user-1');
      expect(sessions).toHaveLength(0);
    });
  });

  describe('updateActivity', () => {
    it('should update lastActivity timestamp', () => {
      const session = sessionManager.createSession('user-1');
      const originalActivity = session.lastActivity;

      // Advance time
      vi.advanceTimersByTime(60_000); // 1 minute

      const updated = sessionManager.updateActivity(session.id);
      expect(updated).toBe(true);

      const fetched = sessionManager.getSession(session.id);
      expect(fetched!.lastActivity).not.toBe(originalActivity);
    });

    it('should return false for non-existent session', () => {
      const result = sessionManager.updateActivity('nonexistent');
      expect(result).toBe(false);
    });

    it('should not update ended sessions', () => {
      const session = sessionManager.createSession('user-1');
      sessionManager.endSession(session.id);

      const result = sessionManager.updateActivity(session.id);
      expect(result).toBe(false);
    });
  });

  describe('endSession', () => {
    it('should set endedAt on the session', () => {
      const session = sessionManager.createSession('user-1');
      const result = sessionManager.endSession(session.id);
      expect(result).toBe(true);

      const fetched = sessionManager.getSession(session.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.endedAt).not.toBeNull();
    });

    it('should return false for non-existent session', () => {
      const result = sessionManager.endSession('nonexistent');
      expect(result).toBe(false);
    });

    it('should return false for already-ended session', () => {
      const session = sessionManager.createSession('user-1');
      sessionManager.endSession(session.id);
      const result = sessionManager.endSession(session.id);
      expect(result).toBe(false);
    });
  });

  describe('endAllUserSessions', () => {
    it('should end all active sessions for a user', () => {
      sessionManager.createSession('user-1');
      sessionManager.createSession('user-1');
      sessionManager.createSession('user-2');

      const count = sessionManager.endAllUserSessions('user-1');
      expect(count).toBe(2);

      const remaining = sessionManager.getUserSessions('user-1');
      expect(remaining).toHaveLength(0);

      // user-2 unaffected
      const user2Sessions = sessionManager.getUserSessions('user-2');
      expect(user2Sessions).toHaveLength(1);
    });

    it('should return 0 when user has no active sessions', () => {
      const count = sessionManager.endAllUserSessions('user-1');
      expect(count).toBe(0);
    });
  });

  describe('getActiveSessionCount', () => {
    it('should return the total number of active sessions', () => {
      sessionManager.createSession('user-1');
      sessionManager.createSession('user-1');
      sessionManager.createSession('user-2');

      expect(sessionManager.getActiveSessionCount()).toBe(3);
    });

    it('should exclude ended sessions from count', () => {
      const s1 = sessionManager.createSession('user-1');
      sessionManager.createSession('user-2');

      sessionManager.endSession(s1.id);

      expect(sessionManager.getActiveSessionCount()).toBe(1);
    });

    it('should return 0 when no sessions exist', () => {
      expect(sessionManager.getActiveSessionCount()).toBe(0);
    });
  });
});
