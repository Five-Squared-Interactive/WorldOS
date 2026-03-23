// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { formatOutput, formatJson, type ChannelsResult } from '../../src/cli/channels.js';

describe('CLI: channels', () => {
  const result: ChannelsResult = {
    channels: [
      { id: 'ch-1', name: 'general', worldId: 'world-1', createdBy: 'user-1', createdAt: '2026-03-21T00:00:00Z' },
      { id: 'ch-2', name: 'random', worldId: 'world-1', createdBy: 'user-2', createdAt: '2026-03-21T01:00:00Z' },
    ],
  };

  it('formatOutput shows channel table', () => {
    const output = formatOutput(result);
    expect(output).toContain('general');
    expect(output).toContain('random');
    expect(output).toContain('user-1');
  });

  it('formatOutput shows empty state message', () => {
    const output = formatOutput({ channels: [] });
    expect(output).toContain('No channels found');
  });

  it('formatJson returns valid JSON', () => {
    const json = formatJson(result);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.channels).toHaveLength(2);
  });
});
