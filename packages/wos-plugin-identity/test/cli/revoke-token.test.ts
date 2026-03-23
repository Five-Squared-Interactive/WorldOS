// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { formatOutput, formatJson, type RevokeTokenResult } from '../../src/cli/revoke-token.js';

describe('revoke-token CLI', () => {
  describe('formatOutput', () => {
    it('should format single token revocation', () => {
      const result: RevokeTokenResult = { revoked: true, count: 1 };
      const output = formatOutput(result);
      expect(output).toContain('Revoked');
    });

    it('should format revoke all for user', () => {
      const result: RevokeTokenResult = { revoked: true, count: 3 };
      const output = formatOutput(result);
      expect(output).toContain('3');
    });

    it('should format not found', () => {
      const result: RevokeTokenResult = { revoked: false, count: 0, error: 'Token not found' };
      const output = formatOutput(result);
      expect(output).toContain('not found');
    });
  });

  describe('formatJson', () => {
    it('should return valid JSON', () => {
      const result: RevokeTokenResult = { revoked: true, count: 1 };
      const json = formatJson(result);
      const parsed = JSON.parse(json);
      expect(parsed.revoked).toBe(true);
      expect(parsed.count).toBe(1);
    });
  });
});
