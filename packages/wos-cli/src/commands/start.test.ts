/**
 * Start Command Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  loadServerConfig,
  getEnabledPlugins,
  writePidFile,
  readPidFile,
  removePidFile,
  isServerRunning,
} from './start.js';

describe('Start Command', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-start-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('loadServerConfig', () => {
    it('should load config from wos.yaml', async () => {
      const configContent = `
server:
  name: test-server

plugins:
  my-plugin:
    enabled: true
`;
      await fs.writeFile(path.join(testDir, 'wos.yaml'), configContent);

      const config = await loadServerConfig(testDir);

      expect(config.server).toEqual({ name: 'test-server' });
      expect(config.plugins).toBeDefined();
    });

    it('should throw if wos.yaml not found', async () => {
      await expect(loadServerConfig(testDir)).rejects.toThrow(
        /No wos\.yaml found/
      );
    });

    it('should return empty object for empty config', async () => {
      await fs.writeFile(path.join(testDir, 'wos.yaml'), '');

      const config = await loadServerConfig(testDir);

      expect(config).toEqual({});
    });
  });

  describe('getEnabledPlugins', () => {
    it('should return empty array for no plugins', () => {
      const plugins = getEnabledPlugins({});

      expect(plugins).toEqual([]);
    });

    it('should return enabled plugins', () => {
      const config = {
        plugins: {
          'plugin-a': { enabled: true },
          'plugin-b': { enabled: false },
          'plugin-c': {}, // default enabled
        },
      };

      const plugins = getEnabledPlugins(config);

      expect(plugins).toContain('plugin-a');
      expect(plugins).toContain('plugin-c');
      expect(plugins).not.toContain('plugin-b');
    });

    it('should treat plugins without enabled field as enabled', () => {
      const config = {
        plugins: {
          'implicit-enabled': { version: '1.0.0' },
        },
      };

      const plugins = getEnabledPlugins(config);

      expect(plugins).toContain('implicit-enabled');
    });
  });

  describe('PID file operations', () => {
    describe('writePidFile', () => {
      it('should write PID to file', async () => {
        await writePidFile(testDir, 12345);

        const pidPath = path.join(testDir, '.wos.pid');
        const content = await fs.readFile(pidPath, 'utf-8');
        expect(content).toBe('12345');
      });

      it('should overwrite existing PID file', async () => {
        await writePidFile(testDir, 11111);
        await writePidFile(testDir, 22222);

        const pidPath = path.join(testDir, '.wos.pid');
        const content = await fs.readFile(pidPath, 'utf-8');
        expect(content).toBe('22222');
      });
    });

    describe('readPidFile', () => {
      it('should read PID from file', async () => {
        await writePidFile(testDir, 12345);

        const pid = await readPidFile(testDir);

        expect(pid).toBe(12345);
      });

      it('should return null if file not found', async () => {
        const pid = await readPidFile(testDir);

        expect(pid).toBeNull();
      });

      it('should return null for invalid content', async () => {
        const pidPath = path.join(testDir, '.wos.pid');
        await fs.writeFile(pidPath, 'not-a-number');

        const pid = await readPidFile(testDir);

        expect(pid).toBeNull();
      });
    });

    describe('removePidFile', () => {
      it('should remove PID file', async () => {
        await writePidFile(testDir, 12345);
        await removePidFile(testDir);

        const pid = await readPidFile(testDir);
        expect(pid).toBeNull();
      });

      it('should not throw if file not found', async () => {
        await expect(removePidFile(testDir)).resolves.not.toThrow();
      });
    });
  });

  describe('isServerRunning', () => {
    it('should return false if no PID file', async () => {
      const running = await isServerRunning(testDir);

      expect(running).toBe(false);
    });

    it('should return true for current process PID', async () => {
      await writePidFile(testDir, process.pid);

      const running = await isServerRunning(testDir);

      expect(running).toBe(true);
    });

    it('should return false and clean up for non-existent process', async () => {
      // Use a PID that's very unlikely to exist
      await writePidFile(testDir, 999999999);

      const running = await isServerRunning(testDir);

      expect(running).toBe(false);

      // PID file should be cleaned up
      const pid = await readPidFile(testDir);
      expect(pid).toBeNull();
    });
  });
});
