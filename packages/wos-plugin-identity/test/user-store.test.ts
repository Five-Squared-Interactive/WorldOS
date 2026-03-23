// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UserStore, validateUsername, validateEmail, validateDisplayName } from '../src/user-store.js';
import type { CreateUserInput } from '../src/user-store.js';

describe('UserStore', () => {
  let store: UserStore;

  beforeEach(() => {
    store = new UserStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  describe('initialization', () => {
    it('should create tables on init', () => {
      // Verify we can create a user (tables exist)
      const user = store.createUser({
        username: 'testuser',
        email: 'test@example.com',
        passwordHash: '$2b$10$hashedpassword',
        displayName: 'Test User',
        role: 'user',
      });
      expect(user).toBeDefined();
      expect(user.id).toBeDefined();
    });
  });

  describe('createUser', () => {
    it('should create a user with all fields', () => {
      const user = store.createUser({
        username: 'alice',
        email: 'alice@example.com',
        passwordHash: '$2b$10$hashedpassword',
        displayName: 'Alice',
        role: 'user',
      });

      expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(user.username).toBe('alice');
      expect(user.email).toBe('alice@example.com');
      expect(user.displayName).toBe('Alice');
      expect(user.role).toBe('user');
      expect(user.createdAt).toBeDefined();
      expect(user.updatedAt).toBeDefined();
      // passwordHash should NOT be in the returned User type
      expect((user as Record<string, unknown>).passwordHash).toBeUndefined();
    });

    it('should create a user with optional avatarUrl', () => {
      const user = store.createUser({
        username: 'bob',
        email: 'bob@example.com',
        passwordHash: '$2b$10$hashedpassword',
        displayName: 'Bob',
        role: 'user',
        avatarUrl: 'https://example.com/avatar.png',
      });

      expect(user.avatarUrl).toBe('https://example.com/avatar.png');
    });

    it('should throw on duplicate username', () => {
      store.createUser({
        username: 'alice',
        email: 'alice@example.com',
        passwordHash: '$2b$10$hash1',
        displayName: 'Alice',
        role: 'user',
      });

      expect(() =>
        store.createUser({
          username: 'alice',
          email: 'different@example.com',
          passwordHash: '$2b$10$hash2',
          displayName: 'Alice 2',
          role: 'user',
        })
      ).toThrow(/username/i);
    });

    it('should throw on duplicate email', () => {
      store.createUser({
        username: 'alice',
        email: 'alice@example.com',
        passwordHash: '$2b$10$hash1',
        displayName: 'Alice',
        role: 'user',
      });

      expect(() =>
        store.createUser({
          username: 'bob',
          email: 'alice@example.com',
          passwordHash: '$2b$10$hash2',
          displayName: 'Bob',
          role: 'user',
        })
      ).toThrow(/email/i);
    });
  });

  describe('getUserById', () => {
    it('should return user by ID', () => {
      const created = store.createUser({
        username: 'alice',
        email: 'alice@example.com',
        passwordHash: '$2b$10$hash',
        displayName: 'Alice',
        role: 'user',
      });

      const user = store.getUserById(created.id);
      expect(user).not.toBeNull();
      expect(user!.username).toBe('alice');
      expect(user!.email).toBe('alice@example.com');
    });

    it('should return null for non-existent ID', () => {
      const user = store.getUserById('non-existent-id');
      expect(user).toBeNull();
    });

    it('should not return soft-deleted users', () => {
      const created = store.createUser({
        username: 'alice',
        email: 'alice@example.com',
        passwordHash: '$2b$10$hash',
        displayName: 'Alice',
        role: 'user',
      });

      store.deleteUser(created.id);
      const user = store.getUserById(created.id);
      expect(user).toBeNull();
    });
  });

  describe('getUserByUsername', () => {
    it('should return user by username', () => {
      store.createUser({
        username: 'alice',
        email: 'alice@example.com',
        passwordHash: '$2b$10$hash',
        displayName: 'Alice',
        role: 'user',
      });

      const user = store.getUserByUsername('alice');
      expect(user).not.toBeNull();
      expect(user!.email).toBe('alice@example.com');
    });

    it('should return null for non-existent username', () => {
      const user = store.getUserByUsername('nobody');
      expect(user).toBeNull();
    });
  });

  describe('getUserByEmail', () => {
    it('should return user by email', () => {
      store.createUser({
        username: 'alice',
        email: 'alice@example.com',
        passwordHash: '$2b$10$hash',
        displayName: 'Alice',
        role: 'user',
      });

      const user = store.getUserByEmail('alice@example.com');
      expect(user).not.toBeNull();
      expect(user!.username).toBe('alice');
    });
  });

  describe('getPasswordHash', () => {
    it('should return password hash for existing user', () => {
      const created = store.createUser({
        username: 'alice',
        email: 'alice@example.com',
        passwordHash: '$2b$10$testhash',
        displayName: 'Alice',
        role: 'user',
      });

      const hash = store.getPasswordHash(created.id);
      expect(hash).toBe('$2b$10$testhash');
    });

    it('should return null for non-existent user', () => {
      const hash = store.getPasswordHash('non-existent');
      expect(hash).toBeNull();
    });
  });

  describe('updateUser', () => {
    it('should update displayName', () => {
      const created = store.createUser({
        username: 'alice',
        email: 'alice@example.com',
        passwordHash: '$2b$10$hash',
        displayName: 'Alice',
        role: 'user',
      });

      const updated = store.updateUser(created.id, { displayName: 'Alice Updated' });
      expect(updated).not.toBeNull();
      expect(updated!.displayName).toBe('Alice Updated');
      // updatedAt should be set (may be same ms as created in fast tests)
      expect(updated!.updatedAt).toBeDefined();
    });

    it('should update avatarUrl', () => {
      const created = store.createUser({
        username: 'alice',
        email: 'alice@example.com',
        passwordHash: '$2b$10$hash',
        displayName: 'Alice',
        role: 'user',
      });

      const updated = store.updateUser(created.id, { avatarUrl: 'https://new-avatar.png' });
      expect(updated!.avatarUrl).toBe('https://new-avatar.png');
    });

    it('should update role', () => {
      const created = store.createUser({
        username: 'alice',
        email: 'alice@example.com',
        passwordHash: '$2b$10$hash',
        displayName: 'Alice',
        role: 'user',
      });

      const updated = store.updateUser(created.id, { role: 'admin' });
      expect(updated!.role).toBe('admin');
    });

    it('should return null for non-existent user', () => {
      const updated = store.updateUser('non-existent', { displayName: 'Nobody' });
      expect(updated).toBeNull();
    });
  });

  describe('updatePassword', () => {
    it('should update password hash', () => {
      const created = store.createUser({
        username: 'alice',
        email: 'alice@example.com',
        passwordHash: '$2b$10$oldhash',
        displayName: 'Alice',
        role: 'user',
      });

      store.updatePassword(created.id, '$2b$10$newhash');
      const hash = store.getPasswordHash(created.id);
      expect(hash).toBe('$2b$10$newhash');
    });
  });

  describe('deleteUser (soft delete)', () => {
    it('should soft-delete user by setting deletedAt', () => {
      const created = store.createUser({
        username: 'alice',
        email: 'alice@example.com',
        passwordHash: '$2b$10$hash',
        displayName: 'Alice',
        role: 'user',
      });

      const result = store.deleteUser(created.id);
      expect(result).toBe(true);

      // User should not be found via normal queries
      expect(store.getUserById(created.id)).toBeNull();
      expect(store.getUserByUsername('alice')).toBeNull();
    });

    it('should return false for non-existent user', () => {
      const result = store.deleteUser('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('listUsers', () => {
    beforeEach(() => {
      store.createUser({
        username: 'admin1',
        email: 'admin1@example.com',
        passwordHash: '$2b$10$hash',
        displayName: 'Admin',
        role: 'admin',
      });
      store.createUser({
        username: 'user1',
        email: 'user1@example.com',
        passwordHash: '$2b$10$hash',
        displayName: 'User 1',
        role: 'user',
      });
      store.createUser({
        username: 'user2',
        email: 'user2@example.com',
        passwordHash: '$2b$10$hash',
        displayName: 'User 2',
        role: 'user',
      });
    });

    it('should list all users', () => {
      const users = store.listUsers();
      expect(users).toHaveLength(3);
    });

    it('should filter by role', () => {
      const admins = store.listUsers({ role: 'admin' });
      expect(admins).toHaveLength(1);
      expect(admins[0].username).toBe('admin1');

      const users = store.listUsers({ role: 'user' });
      expect(users).toHaveLength(2);
    });

    it('should exclude soft-deleted users', () => {
      const allBefore = store.listUsers();
      store.deleteUser(allBefore[1].id);
      const allAfter = store.listUsers();
      expect(allAfter).toHaveLength(2);
    });
  });

  describe('hasAdminUsers', () => {
    it('should return false when no admin users exist', () => {
      expect(store.hasAdminUsers()).toBe(false);
    });

    it('should return true when admin user exists', () => {
      store.createUser({
        username: 'admin1',
        email: 'admin@example.com',
        passwordHash: '$2b$10$hash',
        displayName: 'Admin',
        role: 'admin',
      });
      expect(store.hasAdminUsers()).toBe(true);
    });
  });
});

describe('Input Validation', () => {
  describe('validateUsername', () => {
    it('should accept valid usernames', () => {
      expect(validateUsername('alice')).toBeNull();
      expect(validateUsername('bob_123')).toBeNull();
      expect(validateUsername('user-name')).toBeNull();
      expect(validateUsername('abc')).toBeNull(); // min 3 chars
      expect(validateUsername('a'.repeat(32))).toBeNull(); // max 32 chars
    });

    it('should reject too short', () => {
      expect(validateUsername('ab')).toMatch(/3.*32/);
    });

    it('should reject too long', () => {
      expect(validateUsername('a'.repeat(33))).toMatch(/3.*32/);
    });

    it('should reject invalid characters', () => {
      expect(validateUsername('alice!')).toMatch(/alphanumeric/i);
      expect(validateUsername('alice bob')).toMatch(/alphanumeric/i);
      expect(validateUsername('alice@bob')).toMatch(/alphanumeric/i);
    });
  });

  describe('validateEmail', () => {
    it('should accept valid emails', () => {
      expect(validateEmail('alice@example.com')).toBeNull();
      expect(validateEmail('user+tag@example.co.uk')).toBeNull();
    });

    it('should reject invalid emails', () => {
      expect(validateEmail('notanemail')).toMatch(/email/i);
      expect(validateEmail('@example.com')).toMatch(/email/i);
      expect(validateEmail('user@')).toMatch(/email/i);
    });
  });

  describe('validateDisplayName', () => {
    it('should accept valid display names', () => {
      expect(validateDisplayName('A')).toBeNull();
      expect(validateDisplayName('a'.repeat(100))).toBeNull();
    });

    it('should reject empty', () => {
      expect(validateDisplayName('')).toMatch(/1.*100/);
    });

    it('should reject too long', () => {
      expect(validateDisplayName('a'.repeat(101))).toMatch(/1.*100/);
    });
  });
});
