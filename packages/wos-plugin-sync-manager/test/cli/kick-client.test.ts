// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';

import { formatOutput, formatJson } from '../../src/cli/kick-client.js';
import type { KickClientResult } from '../../src/cli/kick-client.js';

describe('kick-client CLI', () => {
  describe('formatOutput', () => {
    it('should display success message', () => {
      const result: KickClientResult = {
        success: true,
        sessionId: 'sess-1',
        clientId: 'client-1',
      };
      const output = formatOutput(result);
      expect(output).toContain('client-1');
      expect(output).toContain('sess-1');
      expect(output).toContain('removed');
    });

    it('should display error when success is false without error message', () => {
      const result: KickClientResult = {
        success: false,
        sessionId: 'sess-1',
        clientId: 'client-1',
      };
      const output = formatOutput(result);
      expect(output).toContain('Error');
      expect(output).not.toContain('removed');
    });

    it('should display error when client not found', () => {
      const result: KickClientResult = {
        success: false,
        sessionId: 'sess-1',
        clientId: 'client-unknown',
        error: 'Client not found in session',
      };
      const output = formatOutput(result);
      expect(output).toContain('Error');
      expect(output).toContain('Client not found');
    });
  });

  describe('formatJson', () => {
    it('should return valid JSON with result', () => {
      const result: KickClientResult = {
        success: true,
        sessionId: 'sess-1',
        clientId: 'client-1',
      };
      const json = formatJson(result);
      const parsed = JSON.parse(json);
      expect(parsed.success).toBe(true);
      expect(parsed.clientId).toBe('client-1');
    });
  });
});
