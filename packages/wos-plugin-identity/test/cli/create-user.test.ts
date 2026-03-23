// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { formatOutput, formatJson, type CreateUserResult } from '../../src/cli/create-user.js';

const mockResult: CreateUserResult = {
  user: {
    id: 'abc-123',
    username: 'alice',
    email: 'alice@example.com',
    displayName: 'Alice',
    role: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
};

const mockError: CreateUserResult = {
  error: 'Username "alice" already exists',
};

describe('create-user CLI', () => {
  describe('formatOutput', () => {
    it('should format successful creation', () => {
      const output = formatOutput(mockResult);
      expect(output).toContain('alice');
      expect(output).toContain('alice@example.com');
      expect(output).toContain('user');
    });

    it('should format error', () => {
      const output = formatOutput(mockError);
      expect(output).toContain('Error');
      expect(output).toContain('already exists');
    });
  });

  describe('formatJson', () => {
    it('should return valid JSON with user data', () => {
      const json = formatJson(mockResult);
      const parsed = JSON.parse(json);
      expect(parsed.user.username).toBe('alice');
      expect(parsed.user.id).toBe('abc-123');
    });

    it('should return valid JSON with error', () => {
      const json = formatJson(mockError);
      const parsed = JSON.parse(json);
      expect(parsed.error).toContain('already exists');
    });
  });
});
