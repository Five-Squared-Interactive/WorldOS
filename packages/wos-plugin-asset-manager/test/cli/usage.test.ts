// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { formatOutput, formatJson, type UsageResult } from '../../src/cli/usage.js';

const sampleResult: UsageResult = {
  usedBytes: 10240,
  totalBytes: 1048576,
  assetCount: 5,
};

describe('CLI usage', () => {
  it('formatOutput shows storage stats', () => {
    const output = formatOutput(sampleResult);
    expect(output).toContain('10240');
    expect(output).toContain('5');
  });

  it('formatOutput shows zero state', () => {
    const output = formatOutput({ usedBytes: 0, totalBytes: 0, assetCount: 0 });
    expect(output).toContain('0');
  });

  it('formatJson returns valid JSON', () => {
    const json = formatJson(sampleResult);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.assetCount).toBe(5);
  });
});
