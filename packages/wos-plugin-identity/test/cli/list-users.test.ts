// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { formatOutput, formatJson, type ListUsersResult } from '../../src/cli/list-users.js';

const mockEmpty: ListUsersResult = { users: [], count: 0 };

const mockUsers: ListUsersResult = {
  users: [
    { id: '1', username: 'admin1', email: 'admin@example.com', displayName: 'Admin', role: 'admin', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: '2', username: 'alice', email: 'alice@example.com', displayName: 'Alice', role: 'user', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  ],
  count: 2,
};

describe('list-users CLI', () => {
  describe('formatOutput', () => {
    it('should show message for empty list', () => {
      const output = formatOutput(mockEmpty);
      expect(output).toContain('No users');
    });

    it('should list users with role', () => {
      const output = formatOutput(mockUsers);
      expect(output).toContain('admin1');
      expect(output).toContain('alice');
      expect(output).toContain('admin');
      expect(output).toContain('user');
    });

    it('should show total count', () => {
      const output = formatOutput(mockUsers);
      expect(output).toContain('2');
    });
  });

  describe('formatJson', () => {
    it('should return valid JSON', () => {
      const json = formatJson(mockUsers);
      const parsed = JSON.parse(json);
      expect(parsed.users).toHaveLength(2);
      expect(parsed.count).toBe(2);
    });
  });
});
