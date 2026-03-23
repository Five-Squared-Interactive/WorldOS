// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { formatOutput, formatJson } from '../../src/cli/stop.js';

describe('CLI stop', () => {
  it('should format stop results', () => {
    const output = formatOutput({
      results: [
        { serviceId: 'svc1', instanceId: 'i1', containerName: 'svc1-i1', status: 'stopped' },
      ],
    });
    expect(output).toContain('svc1/i1: stopped');
  });

  it('should format JSON', () => {
    const json = formatJson({ results: [] });
    expect(JSON.parse(json).results).toEqual([]);
  });

  it('should handle errors', () => {
    const output = formatOutput({
      results: [
        { serviceId: 's', instanceId: 'i', containerName: 'x', status: 'error', error: 'timeout' },
      ],
    });
    expect(output).toContain('(timeout)');
  });
});
