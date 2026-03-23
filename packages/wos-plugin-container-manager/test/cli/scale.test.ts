// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { formatOutput, formatJson } from '../../src/cli/scale.js';

describe('CLI scale', () => {
  const result = {
    serviceId: 'svc1',
    targetCount: 5,
    instances: [
      { instanceId: 'i1', action: 'unchanged' as const, status: 'ok' },
      { instanceId: 'i2', action: 'created' as const, status: 'created' },
    ],
  };

  it('should format scale output', () => {
    const output = formatOutput(result);
    expect(output).toContain('Scaled svc1 to 5 instances');
    expect(output).toContain('i1: unchanged');
    expect(output).toContain('i2: created');
  });

  it('should format JSON', () => {
    const json = formatJson(result);
    const parsed = JSON.parse(json);
    expect(parsed.targetCount).toBe(5);
  });
});
