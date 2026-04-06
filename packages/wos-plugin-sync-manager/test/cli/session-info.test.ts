// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';

import { formatOutput, formatJson } from '../../src/cli/session-info.js';
import type { SessionInfoResult } from '../../src/cli/session-info.js';

describe('session-info CLI', () => {
  const mockResult: SessionInfoResult = {
    sessionId: 'sess-1',
    tag: 'world.5.10',
    clients: ['client-1', 'client-2', 'client-3'],
    entityCount: 12,
    regionCoords: { x: 5, y: 10 },
  };

  describe('formatOutput', () => {
    it('should display session details', () => {
      const output = formatOutput(mockResult);
      expect(output).toContain('sess-1');
      expect(output).toContain('world.5.10');
      expect(output).toContain('client-1');
      expect(output).toContain('Region: (5, 10)');
      expect(output).toContain('Entities: 12');
    });

    it('should handle session with no clients', () => {
      const result: SessionInfoResult = {
        sessionId: 'sess-empty',
        tag: 'world.0.0',
        clients: [],
        entityCount: 0,
      };
      const output = formatOutput(result);
      expect(output).toContain('sess-empty');
      expect(output).toContain('No clients');
    });
  });

  describe('formatJson', () => {
    it('should return valid JSON with session data', () => {
      const json = formatJson(mockResult);
      const parsed = JSON.parse(json);
      expect(parsed.sessionId).toBe('sess-1');
      expect(parsed.clients).toHaveLength(3);
    });
  });

  describe('error handling', () => {
    it('should format error when session not found', () => {
      const result: SessionInfoResult = { error: 'Session not found' };
      const output = formatOutput(result);
      expect(output).toContain('Error');
      expect(output).toContain('Session not found');
    });
  });
});
