/**
 * Presence Count Command Tests
 *
 * Story 11.2: Presence CLI Commands
 *
 * Tests for the count command.
 */

import { describe, it, expect } from 'vitest';
import {
  CountOptions,
  CountResult,
  formatCountOutput,
  formatCountJson,
  formatCount,
  executeCount,
} from './count.js';

describe('Count Command', () => {
  describe('formatCountOutput', () => {
    it('should format total count', () => {
      const result: CountResult = {
        count: 5,
      };

      const output = formatCountOutput(result);

      expect(output).toBe('Total online users: 5');
    });

    it('should format world-specific count', () => {
      const result: CountResult = {
        count: 3,
        worldId: 'world-1',
      };

      const output = formatCountOutput(result);

      expect(output).toBe('Users in world world-1: 3');
    });

    it('should include world counts', () => {
      const result: CountResult = {
        count: 5,
        worldCounts: {
          'world-1': 3,
          'world-2': 2,
        },
      };

      const output = formatCountOutput(result);

      expect(output).toContain('Total online users: 5');
      expect(output).toContain('By world:');
      expect(output).toContain('world-1: 3');
      expect(output).toContain('world-2: 2');
    });

    it('should not show world section if no worlds', () => {
      const result: CountResult = {
        count: 5,
        worldCounts: {},
      };

      const output = formatCountOutput(result);

      expect(output).not.toContain('By world:');
    });
  });

  describe('formatCountJson', () => {
    it('should output valid JSON', () => {
      const result: CountResult = {
        count: 5,
        worldCounts: {
          'world-1': 3,
          'world-2': 2,
        },
      };

      const json = formatCountJson(result);
      const parsed = JSON.parse(json);

      expect(parsed.count).toBe(5);
      expect(parsed.worldCounts['world-1']).toBe(3);
    });

    it('should include worldId filter', () => {
      const result: CountResult = {
        count: 3,
        worldId: 'world-1',
      };

      const json = formatCountJson(result);
      const parsed = JSON.parse(json);

      expect(parsed.worldId).toBe('world-1');
    });
  });

  describe('formatCount', () => {
    it('should format text output by default', () => {
      const result: CountResult = { count: 5 };
      const options: CountOptions = {};

      const output = formatCount(result, options);

      expect(output).toContain('Total online users: 5');
    });

    it('should format JSON when requested', () => {
      const result: CountResult = { count: 5 };
      const options: CountOptions = { json: true };

      const output = formatCount(result, options);
      const parsed = JSON.parse(output);

      expect(parsed.count).toBe(5);
    });
  });

  describe('executeCount', () => {
    const worldCounts = {
      'world-1': 3,
      'world-2': 2,
    };

    it('should return total count', () => {
      const output = executeCount(5, worldCounts, {});

      expect(output).toContain('Total online users: 5');
      expect(output).toContain('world-1: 3');
    });

    it('should filter by world', () => {
      const output = executeCount(5, worldCounts, { worldId: 'world-1' });

      expect(output).toContain('Users in world world-1: 3');
      expect(output).not.toContain('By world:');
    });

    it('should return 0 for unknown world', () => {
      const output = executeCount(5, worldCounts, { worldId: 'world-3' });

      expect(output).toContain('Users in world world-3: 0');
    });

    it('should output JSON when requested', () => {
      const output = executeCount(5, worldCounts, { json: true });
      const parsed = JSON.parse(output);

      expect(parsed.count).toBe(5);
      expect(parsed.worldCounts).toEqual(worldCounts);
    });

    it('should filter and output JSON', () => {
      const output = executeCount(5, worldCounts, {
        worldId: 'world-1',
        json: true,
      });
      const parsed = JSON.parse(output);

      expect(parsed.count).toBe(3);
      expect(parsed.worldId).toBe('world-1');
    });
  });
});
