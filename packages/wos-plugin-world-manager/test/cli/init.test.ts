// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { formatOutput, formatJson } from '../../src/cli/init.js';

describe('CLI: init', () => {
  it('should format success output', () => {
    const output = formatOutput({
      success: true,
      name: 'New World',
      type: 'planet',
      template: 'earth-planet',
    });
    expect(output).toContain('New World');
    expect(output).toContain('planet');
    expect(output).toContain('earth-planet');
  });

  it('should format error output', () => {
    const output = formatOutput({
      success: false,
      error: 'World already initialized',
    });
    expect(output).toContain('Error');
    expect(output).toContain('already initialized');
  });

  it('should format JSON output', () => {
    const json = formatJson({ success: true, name: 'World', type: 'space' });
    const parsed = JSON.parse(json);
    expect(parsed.success).toBe(true);
  });
});
