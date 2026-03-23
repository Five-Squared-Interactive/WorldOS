// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { formatOutput, formatJson } from '../../src/cli/info.js';

describe('CLI: info', () => {
  const worldInfo = {
    name: 'My World',
    type: 'space' as const,
    owner: 'user-1',
    entityCount: 42,
    templateCount: 5,
    initialized: true,
  };

  it('should format human-readable output', () => {
    const output = formatOutput(worldInfo);
    expect(output).toContain('My World');
    expect(output).toContain('space');
    expect(output).toContain('user-1');
    expect(output).toContain('42');
    expect(output).toContain('5');
  });

  it('should format JSON output', () => {
    const json = formatJson(worldInfo);
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe('My World');
    expect(parsed.type).toBe('space');
    expect(parsed.entityCount).toBe(42);
  });

  it('should handle uninitialized world', () => {
    const output = formatOutput({ ...worldInfo, initialized: false, name: undefined as any });
    expect(output).toContain('not initialized');
  });
});
