// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { formatOutput, formatJson, type InfoResult } from '../../src/cli/info.js';

const sampleResult: InfoResult = {
  asset: {
    id: 'a1', name: 'texture.png', type: 'texture', size: 1024, url: 'assets/w1/a1.png',
    mimeType: 'image/png', createdAt: '2026-03-21T00:00:00Z', createdBy: 'user-1',
  },
};

describe('CLI info', () => {
  it('formatOutput shows full asset details', () => {
    const output = formatOutput(sampleResult);
    expect(output).toContain('a1');
    expect(output).toContain('texture.png');
    expect(output).toContain('image/png');
    expect(output).toContain('user-1');
  });

  it('formatOutput shows not found for null asset', () => {
    const output = formatOutput({ asset: null });
    expect(output).toContain('not found');
  });

  it('formatJson returns valid JSON', () => {
    const json = formatJson(sampleResult);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});
