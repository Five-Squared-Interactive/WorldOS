// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

/**
 * Public user type (no passwordHash exposed)
 */
export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  role: 'admin' | 'user' | 'guest';
  createdAt: string;
  updatedAt: string;
}

/**
 * Internal user record (includes passwordHash)
 */
export interface UserRecord extends User {
  passwordHash: string;
  deletedAt: string | null;
}

/**
 * Input for creating a new user (takes pre-hashed password)
 */
export interface CreateUserInput {
  username: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: 'admin' | 'user' | 'guest';
  avatarUrl?: string;
}

/**
 * Fields that can be updated on a user
 */
export interface UpdateUserFields {
  displayName?: string;
  avatarUrl?: string;
  email?: string;
  role?: 'admin' | 'user' | 'guest';
}

/**
 * Filter options for listing users
 */
export interface ListUsersFilter {
  role?: 'admin' | 'user' | 'guest';
}

// ── Validation ──

export function validateUsername(username: string): string | null {
  if (username.length < 3 || username.length > 32) {
    return 'Username must be between 3 and 32 characters';
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return 'Username must contain only alphanumeric characters, underscores, and hyphens';
  }
  return null;
}

export function validateEmail(email: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Invalid email format';
  }
  return null;
}

export function validateDisplayName(displayName: string): string | null {
  if (displayName.length < 1 || displayName.length > 100) {
    return 'Display name must be between 1 and 100 characters';
  }
  return null;
}

export function validateAvatarUrl(avatarUrl: string): string | null {
  if (avatarUrl.length > 2048) {
    return 'Avatar URL must not exceed 2048 characters';
  }
  return null;
}

/**
 * SQLite-backed user store
 */
export class UserStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
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

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        token TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        expiresAt TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id)
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
  }

  createUser(input: CreateUserInput): User {
    const id = randomUUID();
    const now = new Date().toISOString();

    // Check for duplicates with clear error messages
    const existingUsername = this.db
      .prepare('SELECT id FROM users WHERE username = ? AND deletedAt IS NULL')
      .get(input.username);
    if (existingUsername) {
      throw new Error(`Username "${input.username}" already exists`);
    }

    const existingEmail = this.db
      .prepare('SELECT id FROM users WHERE email = ? AND deletedAt IS NULL')
      .get(input.email);
    if (existingEmail) {
      throw new Error(`Email "${input.email}" already exists`);
    }

    this.db
      .prepare(
        `INSERT INTO users (id, username, email, displayName, avatarUrl, passwordHash, role, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.username,
        input.email,
        input.displayName,
        input.avatarUrl ?? null,
        input.passwordHash,
        input.role,
        now,
        now
      );

    return this.toUser({
      id,
      username: input.username,
      email: input.email,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl ?? null,
      passwordHash: input.passwordHash,
      role: input.role,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  getUserById(id: string): User | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE id = ? AND deletedAt IS NULL')
      .get(id) as UserRecord | undefined;
    return row ? this.toUser(row) : null;
  }

  getUserByUsername(username: string): User | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE username = ? AND deletedAt IS NULL')
      .get(username) as UserRecord | undefined;
    return row ? this.toUser(row) : null;
  }

  getUserByEmail(email: string): User | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE email = ? AND deletedAt IS NULL')
      .get(email) as UserRecord | undefined;
    return row ? this.toUser(row) : null;
  }

  getPasswordHash(userId: string): string | null {
    const row = this.db
      .prepare('SELECT passwordHash FROM users WHERE id = ? AND deletedAt IS NULL')
      .get(userId) as { passwordHash: string } | undefined;
    return row ? row.passwordHash : null;
  }

  updateUser(id: string, fields: UpdateUserFields): User | null {
    const existing = this.db
      .prepare('SELECT * FROM users WHERE id = ? AND deletedAt IS NULL')
      .get(id) as UserRecord | undefined;
    if (!existing) return null;

    const now = new Date().toISOString();
    const updates: string[] = ['updatedAt = ?'];
    const values: unknown[] = [now];

    if (fields.displayName !== undefined) {
      updates.push('displayName = ?');
      values.push(fields.displayName);
    }
    if (fields.avatarUrl !== undefined) {
      updates.push('avatarUrl = ?');
      values.push(fields.avatarUrl);
    }
    if (fields.email !== undefined) {
      updates.push('email = ?');
      values.push(fields.email);
    }
    if (fields.role !== undefined) {
      updates.push('role = ?');
      values.push(fields.role);
    }

    values.push(id);
    this.db
      .prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getUserById(id);
  }

  updatePassword(id: string, newPasswordHash: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE users SET passwordHash = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL')
      .run(newPasswordHash, now, id);
  }

  deleteUser(id: string): boolean {
    const now = new Date().toISOString();
    const result = this.db
      .prepare('UPDATE users SET deletedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL')
      .run(now, now, id);
    return result.changes > 0;
  }

  listUsers(filter?: ListUsersFilter): User[] {
    let query = 'SELECT * FROM users WHERE deletedAt IS NULL';
    const params: unknown[] = [];

    if (filter?.role) {
      query += ' AND role = ?';
      params.push(filter.role);
    }

    query += ' ORDER BY createdAt ASC';

    const rows = this.db.prepare(query).all(...params) as UserRecord[];
    return rows.map((row) => this.toUser(row));
  }

  hasAdminUsers(): boolean {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND deletedAt IS NULL")
      .get() as { count: number };
    return row.count > 0;
  }

  /** Get the raw database instance (for sharing with TokenManager/SessionManager) */
  getDatabase(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }

  private toUser(row: UserRecord | Record<string, unknown>): User {
    return {
      id: row.id as string,
      username: row.username as string,
      email: row.email as string,
      displayName: row.displayName as string,
      avatarUrl: (row.avatarUrl as string) || undefined,
      role: row.role as 'admin' | 'user' | 'guest',
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  }
}
