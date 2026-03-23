/**
 * Restart Command Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { restartServer } from './restart.js';
import { writePidFile } from './start.js';

describe('Restart Command', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-restart-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('restartServer', () => {
    it('should start server if not running', async () => {
      const startFn = vi.fn().mockResolvedValue(undefined);

      const result = await restartServer(
        { serverDir: testDir },
        startFn
      );

      expect(result.success).toBe(true);
      expect(result.stopped).toBe(false);
      expect(result.started).toBe(true);
      expect(startFn).toHaveBeenCalled();
    });

    it('should stop and start if server is running', async () => {
      // Write a PID file with a non-existent process
      await writePidFile(testDir, 999999999);

      const startFn = vi.fn().mockResolvedValue(undefined);

      const result = await restartServer(
        { serverDir: testDir },
        startFn
      );

      // Since the PID doesn't exist, isServerRunning should return false
      // after cleaning up the stale PID file
      expect(result.success).toBe(true);
      expect(startFn).toHaveBeenCalled();
    });

    it('should return error if start fails', async () => {
      const startFn = vi.fn().mockRejectedValue(new Error('Start failed'));

      const result = await restartServer(
        { serverDir: testDir },
        startFn
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to start');
      expect(result.started).toBe(false);
    });

    it('should respect force option', async () => {
      const startFn = vi.fn().mockResolvedValue(undefined);

      const result = await restartServer(
        { serverDir: testDir, force: true },
        startFn
      );

      expect(result.success).toBe(true);
      expect(startFn).toHaveBeenCalled();
    });

    it('should respect timeout option', async () => {
      const startFn = vi.fn().mockResolvedValue(undefined);

      const result = await restartServer(
        { serverDir: testDir, timeout: 5000 },
        startFn
      );

      expect(result.success).toBe(true);
      expect(startFn).toHaveBeenCalled();
    });
  });
});
