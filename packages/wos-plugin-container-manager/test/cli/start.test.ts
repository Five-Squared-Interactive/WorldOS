// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { formatOutput, formatJson } from '../../src/cli/start.js';

describe('CLI start', () => {
  it('should format start results', () => {
    const output = formatOutput({
      results: [
        { serviceId: 'svc1', instanceId: 'i1', containerName: 'svc1-i1', status: 'started' },
      ],
    });
    expect(output).toContain('svc1/i1: started');
  });

  it('should format JSON', () => {
    const json = formatJson({ results: [] });
    expect(JSON.parse(json).results).toEqual([]);
  });

  it('should handle empty', () => {
    expect(formatOutput({ results: [] })).toContain('No instances');
  });
});
