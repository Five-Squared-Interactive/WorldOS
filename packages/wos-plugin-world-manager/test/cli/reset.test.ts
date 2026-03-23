// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { formatOutput, formatJson } from '../../src/cli/reset.js';

describe('CLI: reset', () => {
  it('should format success output', () => {
    const output = formatOutput({ success: true, name: 'Reset World', type: 'space' });
    expect(output).toContain('Reset World');
    expect(output).toContain('reset');
  });

  it('should format error output', () => {
    const output = formatOutput({ success: false, error: 'No world to reset' });
    expect(output).toContain('Error');
  });

  it('should format JSON output', () => {
    const json = formatJson({ success: true, name: 'W', type: 'space' });
    const parsed = JSON.parse(json);
    expect(parsed.success).toBe(true);
  });
});
