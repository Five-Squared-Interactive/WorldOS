// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { formatOutput, formatJson, type SendResult } from '../../src/cli/send.js';

describe('CLI: send', () => {
  it('formatOutput shows success', () => {
    const result: SendResult = { success: true, messageId: 'msg-1' };
    const output = formatOutput(result);
    expect(output).toContain('msg-1');
    expect(output).toMatch(/sent|success/i);
  });

  it('formatOutput shows failure', () => {
    const result: SendResult = { success: false, error: 'unauthorized' };
    const output = formatOutput(result);
    expect(output).toMatch(/error|fail/i);
    expect(output).toContain('unauthorized');
  });

  it('formatJson returns valid JSON', () => {
    const result: SendResult = { success: true, messageId: 'msg-1' };
    const json = formatJson(result);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.success).toBe(true);
  });
});
