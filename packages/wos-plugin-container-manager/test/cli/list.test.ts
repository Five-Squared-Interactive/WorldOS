// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { formatOutput, formatJson } from '../../src/cli/list.js';

describe('CLI list', () => {
  const result = {
    services: [
      { id: 'svc1', name: 'Service One', image: 'img:latest', instanceCount: 3, runningCount: 2 },
    ],
  };

  it('should format human-readable output', () => {
    const output = formatOutput(result);
    expect(output).toContain('svc1');
    expect(output).toContain('Service One');
    expect(output).toContain('2/3 running');
  });

  it('should format JSON output', () => {
    const json = formatJson(result);
    const parsed = JSON.parse(json);
    expect(parsed.services[0].id).toBe('svc1');
  });

  it('should handle empty services', () => {
    expect(formatOutput({ services: [] })).toContain('No services');
  });
});
