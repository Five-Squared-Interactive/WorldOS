// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { formatOutput, formatJson, type HistoryResult } from '../../src/cli/history.js';

describe('CLI: history', () => {
  const result: HistoryResult = {
    conversationId: 'ch-1',
    messages: [
      { id: 'msg-1', senderId: 'user-1', content: 'Hello world', createdAt: '2026-03-21T00:00:00Z' },
      { id: 'msg-2', senderId: 'user-2', content: 'Hi there', createdAt: '2026-03-21T00:01:00Z' },
    ],
  };

  it('formatOutput shows message list', () => {
    const output = formatOutput(result);
    expect(output).toContain('Hello world');
    expect(output).toContain('Hi there');
    expect(output).toContain('user-1');
  });

  it('formatOutput shows empty state message', () => {
    const output = formatOutput({ conversationId: 'ch-1', messages: [] });
    expect(output).toContain('No messages found');
  });

  it('formatJson returns valid JSON', () => {
    const json = formatJson(result);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.messages).toHaveLength(2);
  });
});
