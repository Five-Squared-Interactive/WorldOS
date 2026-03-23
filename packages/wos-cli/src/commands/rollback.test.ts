/**
 * Rollback Command Tests
 *
 * Story 4.8: Installation Rollback
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import Rollback from './rollback.js';

describe('Rollback Command', () => {
  let tempDir: string;
  let serverDir: string;
  let mockLog: Mock;
  let mockError: Mock;
  let mockWarn: Mock;
  let command: Rollback;

  beforeEach(async () => {
    // Create temp directories
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-rollback-test-'));
    serverDir = path.join(tempDir, 'server');

    // Create server directory structure
    await fs.mkdir(serverDir, { recursive: true });
    await fs.mkdir(path.join(serverDir, 'plugins'), { recursive: true });
    await fs.writeFile(
      path.join(serverDir, 'wos.yaml'),
      'server:\n  port: 8080\n'
    );

    // Create mock command
    mockLog = vi.fn();
    mockError = vi.fn();
    mockWarn = vi.fn();
    command = Object.create(Rollback.prototype);
    command.log = mockLog;
    command.error = mockError;
    command.warn = mockWarn;
    command.parse = vi.fn();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('list backups', () => {
    it('should list available backups with --list flag', async () => {
      // Create a plugin and backup
      const pluginDir = path.join(serverDir, 'plugins', 'test-plugin');
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'index.js'), 'original');

      // Create backup manually
      const backupsDir = path.join(serverDir, '.wos-backups');
      const backupId = 'test-backup-123';
      await fs.mkdir(path.join(backupsDir, backupId), { recursive: true });
      await fs.writeFile(
        path.join(backupsDir, backupId, 'index.js'),
        'backup content'
      );
      await fs.writeFile(
        path.join(backupsDir, 'manifest.json'),
        JSON.stringify({
          version: 1,
          backups: [{
            id: backupId,
            pluginName: 'test-plugin',
            reason: 'test',
            timestamp: new Date().toISOString(),
            backupPath: path.join(backupsDir, backupId),
          }],
        })
      );

      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir, list: true },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('test-plugin');
    });

    it('should show message when no backups available', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir, list: true },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toMatch(/no.*backup/i);
    });
  });

  describe('rollback to latest', () => {
    it('should rollback plugin to latest backup', async () => {
      // Create plugin
      const pluginDir = path.join(serverDir, 'plugins', 'test-plugin');
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'index.js'), 'modified');

      // Create backup
      const backupsDir = path.join(serverDir, '.wos-backups');
      const backupId = 'test-backup-123';
      await fs.mkdir(path.join(backupsDir, backupId), { recursive: true });
      await fs.writeFile(
        path.join(backupsDir, backupId, 'index.js'),
        'original'
      );
      await fs.writeFile(
        path.join(backupsDir, 'manifest.json'),
        JSON.stringify({
          version: 1,
          backups: [{
            id: backupId,
            pluginName: 'test-plugin',
            reason: 'pre-upgrade',
            timestamp: new Date().toISOString(),
            backupPath: path.join(backupsDir, backupId),
          }],
        })
      );

      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin' },
        flags: { directory: serverDir },
      });

      await command.run();

      // Verify rollback occurred
      const content = await fs.readFile(path.join(pluginDir, 'index.js'), 'utf-8');
      expect(content).toBe('original');
    });
  });

  describe('rollback to specific backup', () => {
    it('should rollback to specific backup ID', async () => {
      // Create plugin
      const pluginDir = path.join(serverDir, 'plugins', 'test-plugin');
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'index.js'), 'current');

      // Create multiple backups
      const backupsDir = path.join(serverDir, '.wos-backups');
      await fs.mkdir(path.join(backupsDir, 'backup-1'), { recursive: true });
      await fs.mkdir(path.join(backupsDir, 'backup-2'), { recursive: true });
      await fs.writeFile(path.join(backupsDir, 'backup-1', 'index.js'), 'version-1');
      await fs.writeFile(path.join(backupsDir, 'backup-2', 'index.js'), 'version-2');
      await fs.writeFile(
        path.join(backupsDir, 'manifest.json'),
        JSON.stringify({
          version: 1,
          backups: [
            {
              id: 'backup-1',
              pluginName: 'test-plugin',
              reason: 'first',
              timestamp: new Date(Date.now() - 1000).toISOString(),
              backupPath: path.join(backupsDir, 'backup-1'),
            },
            {
              id: 'backup-2',
              pluginName: 'test-plugin',
              reason: 'second',
              timestamp: new Date().toISOString(),
              backupPath: path.join(backupsDir, 'backup-2'),
            },
          ],
        })
      );

      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin' },
        flags: { directory: serverDir, id: 'backup-1' },
      });

      await command.run();

      const content = await fs.readFile(path.join(pluginDir, 'index.js'), 'utf-8');
      expect(content).toBe('version-1');
    });
  });

  describe('error handling', () => {
    it('should error if no backups exist for plugin', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'nonexistent' },
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/no.*backup|not found/i),
        expect.anything()
      );
    });

    it('should error if server not initialized', async () => {
      await fs.unlink(path.join(serverDir, 'wos.yaml'));

      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin' },
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/not initialized|wos\.yaml/i),
        expect.anything()
      );
    });

    it('should error if backup ID not found', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin' },
        flags: { directory: serverDir, id: 'invalid-id' },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/not found/i),
        expect.anything()
      );
    });
  });

  describe('json output', () => {
    it('should output JSON with --json flag', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir, list: true, json: true },
      });

      await command.run();

      const logCalls = mockLog.mock.calls.flat();
      const jsonOutput = logCalls.find(call => {
        try {
          JSON.parse(call);
          return true;
        } catch {
          return false;
        }
      });

      expect(jsonOutput).toBeDefined();
      const parsed = JSON.parse(jsonOutput);
      expect(Array.isArray(parsed.backups)).toBe(true);
    });
  });

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(Rollback.description).toMatch(/rollback|restore.*plugin/i);
    });

    it('should have examples', () => {
      expect(Rollback.examples).toBeDefined();
      expect(Rollback.examples.length).toBeGreaterThan(0);
    });

    it('should have --list flag', () => {
      expect(Rollback.flags.list).toBeDefined();
    });

    it('should have --id flag', () => {
      expect(Rollback.flags.id).toBeDefined();
    });

    it('should have optional plugin argument', () => {
      expect(Rollback.args.plugin.required).toBe(false);
    });
  });
});
