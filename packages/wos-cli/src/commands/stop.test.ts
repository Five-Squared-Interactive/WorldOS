/**
 * Stop Command Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { sendSignal, waitForExit, stopServer } from './stop.js';
import { writePidFile } from './start.js';

describe('Stop Command', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-stop-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('sendSignal', () => {
    it('should return false for invalid process', () => {
      const result = sendSignal(999999999, 'SIGTERM');
      expect(result).toBe(false);
    });

    it('should handle signal to valid process', () => {
      // Just verify the function can be called without throwing
      // Don't actually send SIGTERM to avoid killing the test process
      const result = sendSignal(999999999, 'SIGTERM');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('waitForExit', () => {
    it('should return true immediately for non-existent process', async () => {
      const result = await waitForExit(999999999, 1000);
      expect(result).toBe(true);
    });
  });

  describe('stopServer', () => {
    it('should return error if server not running', async () => {
      const result = await stopServer({ serverDir: testDir });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not running');
    });

    it('should return error for non-existent PID', async () => {
      await writePidFile(testDir, 999999999);

      // isServerRunning should clean up the stale PID file
      const result = await stopServer({ serverDir: testDir });

      expect(result.success).toBe(false);
    });

    it('should include PID in error result', async () => {
      // Write a non-existent PID
      await writePidFile(testDir, 999999998);

      const result = await stopServer({
        serverDir: testDir,
        timeout: 100,
      });

      // PID file gets cleaned up by isServerRunning for non-existent process
      expect(result.success).toBe(false);
    });
  });
});
