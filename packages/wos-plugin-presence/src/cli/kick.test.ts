/**
 * Presence Kick Command Tests
 *
 * Story 11.2: Presence CLI Commands
 *
 * Tests for the kick command.
 */

import { describe, it, expect } from 'vitest';
import {
  KickOptions,
  KickResult,
  formatKickOutput,
  formatKickJson,
  createKickRequest,
  formatKick,
} from './kick.js';

describe('Kick Command', () => {
  describe('formatKickOutput', () => {
    it('should format successful kick', () => {
      const result: KickResult = {
        success: true,
        userId: 'user-1',
      };

      const output = formatKickOutput(result);

      expect(output).toBe('User user-1 has been kicked');
    });

    it('should include reason in output', () => {
      const result: KickResult = {
        success: true,
        userId: 'user-1',
        reason: 'bad behavior',
      };

      const output = formatKickOutput(result);

      expect(output).toContain('reason: bad behavior');
    });

    it('should format failed kick', () => {
      const result: KickResult = {
        success: false,
        userId: 'user-1',
        error: 'User not found',
      };

      const output = formatKickOutput(result);

      expect(output).toContain('Failed to kick user user-1');
      expect(output).toContain('User not found');
    });

    it('should handle missing error message', () => {
      const result: KickResult = {
        success: false,
        userId: 'user-1',
      };

      const output = formatKickOutput(result);

      expect(output).toContain('Unknown error');
    });
  });

  describe('formatKickJson', () => {
    it('should output valid JSON for success', () => {
      const result: KickResult = {
        success: true,
        userId: 'user-1',
        reason: 'testing',
      };

      const json = formatKickJson(result);
      const parsed = JSON.parse(json);

      expect(parsed.success).toBe(true);
      expect(parsed.userId).toBe('user-1');
      expect(parsed.reason).toBe('testing');
    });

    it('should output valid JSON for failure', () => {
      const result: KickResult = {
        success: false,
        userId: 'user-1',
        error: 'Not found',
      };

      const json = formatKickJson(result);
      const parsed = JSON.parse(json);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('Not found');
    });
  });

  describe('createKickRequest', () => {
    it('should create basic kick request', () => {
      const options: KickOptions = {
        userId: 'user-1',
      };

      const request = createKickRequest(options);

      expect(request.type).toBe('kick');
      expect(request.userId).toBe('user-1');
      expect(request.reason).toBeUndefined();
    });

    it('should include reason', () => {
      const options: KickOptions = {
        userId: 'user-1',
        reason: 'spam',
      };

      const request = createKickRequest(options);

      expect(request.reason).toBe('spam');
    });
  });

  describe('formatKick', () => {
    it('should format text output by default', () => {
      const result: KickResult = {
        success: true,
        userId: 'user-1',
      };
      const options: KickOptions = { userId: 'user-1' };

      const output = formatKick(result, options);

      expect(output).toBe('User user-1 has been kicked');
    });

    it('should format JSON when requested', () => {
      const result: KickResult = {
        success: true,
        userId: 'user-1',
      };
      const options: KickOptions = { userId: 'user-1', json: true };

      const output = formatKick(result, options);
      const parsed = JSON.parse(output);

      expect(parsed.success).toBe(true);
    });
  });
});
