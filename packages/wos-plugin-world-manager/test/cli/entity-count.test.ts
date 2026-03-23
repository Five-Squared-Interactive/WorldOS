// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { formatOutput, formatJson } from '../../src/cli/entity-count.js';

describe('CLI: entity-count', () => {
  const counts = {
    total: 15,
    byType: { mesh: 10, light: 3, camera: 2 },
  };

  it('should format human-readable output', () => {
    const output = formatOutput(counts);
    expect(output).toContain('15');
    expect(output).toContain('mesh');
    expect(output).toContain('10');
    expect(output).toContain('light');
    expect(output).toContain('3');
  });

  it('should format JSON output', () => {
    const json = formatJson(counts);
    const parsed = JSON.parse(json);
    expect(parsed.total).toBe(15);
    expect(parsed.byType.mesh).toBe(10);
  });

  it('should handle zero entities', () => {
    const output = formatOutput({ total: 0, byType: {} });
    expect(output).toContain('0');
  });
});
