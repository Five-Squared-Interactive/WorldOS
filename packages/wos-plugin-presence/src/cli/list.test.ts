/**
 * Presence List Command Tests
 *
 * Story 11.2: Presence CLI Commands
 *
 * Tests for the list command.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ListOptions,
  ListResult,
  formatUser,
  formatListOutput,
  formatListJson,
  executeList,
} from './list.js';
import { UserPresence } from '../presence-tracker.js';

describe('List Command', () => {
  const mockUsers: UserPresence[] = [
    {
      userId: 'user-1',
      sessionId: 'session-1',
      displayName: 'Alice',
      worldId: 'world-1',
      status: 'online',
      joinedAt: new Date('2026-02-21T12:00:00Z'),
      lastActivity: new Date(),
    },
    {
      userId: 'user-2',
      sessionId: 'session-2',
      displayName: 'Bob',
      worldId: 'world-2',
      status: 'online',
      joinedAt: new Date('2026-02-21T13:00:00Z'),
      lastActivity: new Date(),
    },
    {
      userId: 'user-3',
      sessionId: 'session-3',
      worldId: 'world-1',
      status: 'away',
      joinedAt: new Date('2026-02-21T11:00:00Z'),
      lastActivity: new Date(),
    },
  ];

  describe('formatUser', () => {
    it('should format user with display name', () => {
      const user = mockUsers[0];
      const formatted = formatUser(user);

      expect(formatted).toContain('Alice');
      expect(formatted).toContain('session-1');
    });

    it('should use userId when no display name', () => {
      const user = mockUsers[2];
      const formatted = formatUser(user);

      expect(formatted).toContain('user-3');
    });

    it('should include world id', () => {
      const user = mockUsers[0];
      const formatted = formatUser(user);

      expect(formatted).toContain('world-1');
    });

    it('should show away status', () => {
      const user = mockUsers[2];
      const formatted = formatUser(user);

      expect(formatted).toContain('[away]');
    });

    it('should not show online status explicitly', () => {
      const user = mockUsers[0];
      const formatted = formatUser(user);

      expect(formatted).not.toContain('[online]');
    });
  });

  describe('formatListOutput', () => {
    it('should show no users message when empty', () => {
      const result: ListResult = { users: [], count: 0 };
      const output = formatListOutput(result);

      expect(output).toBe('No users online');
    });

    it('should show no users in world message', () => {
      const result: ListResult = { users: [], count: 0, worldId: 'world-1' };
      const output = formatListOutput(result);

      expect(output).toContain('No users online in world world-1');
    });

    it('should list users', () => {
      const result: ListResult = { users: mockUsers, count: mockUsers.length };
      const output = formatListOutput(result);

      expect(output).toContain('Online users:');
      expect(output).toContain('Alice');
      expect(output).toContain('Bob');
      expect(output).toContain('Total: 3 users');
    });

    it('should show singular user count', () => {
      const result: ListResult = { users: [mockUsers[0]], count: 1 };
      const output = formatListOutput(result);

      expect(output).toContain('Total: 1 user');
    });

    it('should show world-specific header', () => {
      const result: ListResult = {
        users: [mockUsers[0]],
        count: 1,
        worldId: 'world-1',
      };
      const output = formatListOutput(result);

      expect(output).toContain('Users in world world-1:');
    });
  });

  describe('formatListJson', () => {
    it('should output valid JSON', () => {
      const result: ListResult = { users: mockUsers, count: mockUsers.length };
      const json = formatListJson(result);

      const parsed = JSON.parse(json);
      expect(parsed.count).toBe(3);
      expect(parsed.users).toHaveLength(3);
    });

    it('should include user fields', () => {
      const result: ListResult = { users: [mockUsers[0]], count: 1 };
      const json = formatListJson(result);

      const parsed = JSON.parse(json);
      const user = parsed.users[0];

      expect(user.userId).toBe('user-1');
      expect(user.sessionId).toBe('session-1');
      expect(user.displayName).toBe('Alice');
      expect(user.worldId).toBe('world-1');
      expect(user.status).toBe('online');
      expect(user.joinedAt).toBeDefined();
    });

    it('should include worldId filter', () => {
      const result: ListResult = {
        users: [mockUsers[0]],
        count: 1,
        worldId: 'world-1',
      };
      const json = formatListJson(result);

      const parsed = JSON.parse(json);
      expect(parsed.worldId).toBe('world-1');
    });
  });

  describe('executeList', () => {
    it('should list all users', () => {
      const output = executeList(mockUsers, {});

      expect(output).toContain('Online users:');
      expect(output).toContain('Alice');
      expect(output).toContain('Bob');
    });

    it('should filter by world', () => {
      const output = executeList(mockUsers, { worldId: 'world-1' });

      expect(output).toContain('Alice');
      expect(output).not.toContain('Bob'); // Bob is in world-2
    });

    it('should output JSON when requested', () => {
      const output = executeList(mockUsers, { json: true });

      const parsed = JSON.parse(output);
      expect(parsed.count).toBe(3);
    });

    it('should filter and output JSON', () => {
      const output = executeList(mockUsers, { worldId: 'world-1', json: true });

      const parsed = JSON.parse(output);
      expect(parsed.count).toBe(2); // user-1 and user-3 are in world-1
      expect(parsed.worldId).toBe('world-1');
    });
  });
});
