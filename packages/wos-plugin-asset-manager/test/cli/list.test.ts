// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { formatOutput, formatJson, type ListResult } from '../../src/cli/list.js';

const sampleResult: ListResult = {
  assets: [
    { id: 'a1', name: 'texture.png', type: 'texture', size: 1024, createdAt: '2026-03-21T00:00:00Z' },
    { id: 'a2', name: 'model.glb', type: 'model', size: 2048, createdAt: '2026-03-21T01:00:00Z' },
  ],
};

describe('CLI list', () => {
  it('formatOutput shows asset table', () => {
    const output = formatOutput(sampleResult);
    expect(output).toContain('texture.png');
    expect(output).toContain('model.glb');
    expect(output).toContain('texture');
    expect(output).toContain('model');
  });

  it('formatOutput shows empty state message', () => {
    const output = formatOutput({ assets: [] });
    expect(output).toContain('No assets');
  });

  it('formatJson returns valid JSON', () => {
    const json = formatJson(sampleResult);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.assets).toHaveLength(2);
  });
});
