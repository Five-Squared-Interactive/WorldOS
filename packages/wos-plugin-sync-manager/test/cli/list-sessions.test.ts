// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';

import { formatOutput, formatJson } from '../../src/cli/list-sessions.js';
import type { ListSessionsResult } from '../../src/cli/list-sessions.js';

describe('list-sessions CLI', () => {
  const mockResult: ListSessionsResult = {
    sessions: [
      { sessionId: 'sess-1', tag: 'world.5.10', clientCount: 3, entityCount: 12, createdAt: 1711929600000 },
      { sessionId: 'sess-2', tag: 'world.3.7', clientCount: 1, entityCount: 0, createdAt: 1711933200000 },
    ],
  };

  describe('formatOutput', () => {
    it('should return formatted table with session data', () => {
      const output = formatOutput(mockResult);
      expect(output).toContain('sess-1');
      expect(output).toContain('world.5.10');
      expect(output).toContain('3');
      expect(output).toContain('12');
      expect(output).toContain('sess-2');
      expect(output).toContain('Total: 2');
    });

    it('should display message when no sessions exist', () => {
      const output = formatOutput({ sessions: [] });
      expect(output).toContain('No active sessions');
    });
  });

  describe('formatJson', () => {
    it('should return valid JSON with sessions array', () => {
      const json = formatJson(mockResult);
      const parsed = JSON.parse(json);
      expect(parsed.sessions).toHaveLength(2);
      expect(parsed.sessions[0].sessionId).toBe('sess-1');
    });
  });

  describe('error handling', () => {
    it('should format error result', () => {
      const result: ListSessionsResult = { sessions: [], error: 'Sync bridge not running' };
      const output = formatOutput(result);
      expect(output).toContain('Error');
      expect(output).toContain('Sync bridge not running');
    });
  });
});
