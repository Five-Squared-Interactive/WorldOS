// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { formatOutput, formatJson, type DeleteResult } from '../../src/cli/delete.js';

const successResult: DeleteResult = { success: true, freedBytes: 2048 };
const failResult: DeleteResult = { success: false, error: 'Asset not found' };

describe('CLI delete', () => {
  it('formatOutput shows success with freed bytes', () => {
    const output = formatOutput(successResult);
    expect(output).toContain('2048');
    expect(output).toMatch(/delet|remov/i);
  });

  it('formatOutput shows error on failure', () => {
    const output = formatOutput(failResult);
    expect(output).toContain('not found');
  });

  it('formatJson returns valid JSON', () => {
    const json = formatJson(successResult);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.success).toBe(true);
  });
});
