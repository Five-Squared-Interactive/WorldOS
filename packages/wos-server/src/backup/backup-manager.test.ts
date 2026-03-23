/**
 * Backup Manager Tests
 *
 * Story 4.8: Installation Rollback
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { BackupManager, BackupEntry } from './backup-manager.js';

describe('BackupManager', () => {
  let tempDir: string;
  let serverDir: string;
  let backupManager: BackupManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-test-'));
    serverDir = path.join(tempDir, 'server');
    await fs.mkdir(serverDir, { recursive: true });
    await fs.mkdir(path.join(serverDir, 'plugins'), { recursive: true });

    backupManager = new BackupManager(serverDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('createBackup', () => {
    it('should create backup of plugin directory', async () => {
      // Create a plugin
      const pluginDir = path.join(serverDir, 'plugins', 'test-plugin');
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'index.js'), 'module.exports = {}');
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        'name: test-plugin\nversion: 1.0.0\n'
      );

      const entry = await backupManager.createBackup('test-plugin', 'pre-upgrade');

      expect(entry).toBeDefined();
      expect(entry.pluginName).toBe('test-plugin');
      expect(entry.reason).toBe('pre-upgrade');
      expect(entry.timestamp).toBeDefined();
    });

    it('should preserve file contents in backup', async () => {
      const pluginDir = path.join(serverDir, 'plugins', 'test-plugin');
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'data.txt'), 'original content');

      const entry = await backupManager.createBackup('test-plugin', 'test');

      // Verify backup exists and has correct content
      const backupPath = path.join(entry.backupPath, 'data.txt');
      const content = await fs.readFile(backupPath, 'utf-8');
      expect(content).toBe('original content');
    });

    it('should handle nested directories', async () => {
      const pluginDir = path.join(serverDir, 'plugins', 'test-plugin');
      await fs.mkdir(path.join(pluginDir, 'src', 'utils'), { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'src', 'utils', 'helper.js'), 'export {}');

      const entry = await backupManager.createBackup('test-plugin', 'test');

      const backupPath = path.join(entry.backupPath, 'src', 'utils', 'helper.js');
      const exists = await fs.access(backupPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should skip node_modules in backup', async () => {
      const pluginDir = path.join(serverDir, 'plugins', 'test-plugin');
      await fs.mkdir(path.join(pluginDir, 'node_modules', 'lodash'), { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'node_modules', 'lodash', 'index.js'), '');
      await fs.writeFile(path.join(pluginDir, 'index.js'), 'module.exports = {}');

      const entry = await backupManager.createBackup('test-plugin', 'test');

      const nodeModulesPath = path.join(entry.backupPath, 'node_modules');
      const exists = await fs.access(nodeModulesPath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });
  });

  describe('restore', () => {
    it('should restore plugin from backup', async () => {
      // Create original plugin
      const pluginDir = path.join(serverDir, 'plugins', 'test-plugin');
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'index.js'), 'original');

      // Create backup
      const entry = await backupManager.createBackup('test-plugin', 'test');

      // Modify the plugin
      await fs.writeFile(path.join(pluginDir, 'index.js'), 'modified');

      // Restore
      await backupManager.restore(entry.id);

      // Verify restored content
      const content = await fs.readFile(path.join(pluginDir, 'index.js'), 'utf-8');
      expect(content).toBe('original');
    });

    it('should restore plugin even if current version deleted', async () => {
      // Create original plugin
      const pluginDir = path.join(serverDir, 'plugins', 'test-plugin');
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'index.js'), 'original');

      // Create backup
      const entry = await backupManager.createBackup('test-plugin', 'test');

      // Delete the plugin
      await fs.rm(pluginDir, { recursive: true, force: true });

      // Restore
      await backupManager.restore(entry.id);

      // Verify restored
      const content = await fs.readFile(path.join(pluginDir, 'index.js'), 'utf-8');
      expect(content).toBe('original');
    });

    it('should throw error for invalid backup id', async () => {
      await expect(backupManager.restore('invalid-id')).rejects.toThrow(/not found/i);
    });
  });

  describe('list', () => {
    it('should list all backups', async () => {
      // Create plugin
      const pluginDir = path.join(serverDir, 'plugins', 'test-plugin');
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'index.js'), '');

      // Create multiple backups
      await backupManager.createBackup('test-plugin', 'backup-1');
      await backupManager.createBackup('test-plugin', 'backup-2');

      const backups = await backupManager.list();

      expect(backups.length).toBe(2);
    });

    it('should list backups for specific plugin', async () => {
      // Create plugins
      await fs.mkdir(path.join(serverDir, 'plugins', 'plugin-a'), { recursive: true });
      await fs.mkdir(path.join(serverDir, 'plugins', 'plugin-b'), { recursive: true });
      await fs.writeFile(path.join(serverDir, 'plugins', 'plugin-a', 'index.js'), '');
      await fs.writeFile(path.join(serverDir, 'plugins', 'plugin-b', 'index.js'), '');

      await backupManager.createBackup('plugin-a', 'test');
      await backupManager.createBackup('plugin-b', 'test');
      await backupManager.createBackup('plugin-a', 'test-2');

      const backups = await backupManager.list('plugin-a');

      expect(backups.length).toBe(2);
      expect(backups.every(b => b.pluginName === 'plugin-a')).toBe(true);
    });

    it('should return empty array when no backups', async () => {
      const backups = await backupManager.list();
      expect(backups).toEqual([]);
    });
  });

  describe('delete', () => {
    it('should delete a backup', async () => {
      // Create plugin and backup
      const pluginDir = path.join(serverDir, 'plugins', 'test-plugin');
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'index.js'), '');

      const entry = await backupManager.createBackup('test-plugin', 'test');

      // Delete backup
      await backupManager.delete(entry.id);

      // Verify deleted
      const backups = await backupManager.list();
      expect(backups.find(b => b.id === entry.id)).toBeUndefined();
    });

    it('should throw error for invalid backup id', async () => {
      await expect(backupManager.delete('invalid-id')).rejects.toThrow(/not found/i);
    });
  });

  describe('cleanup', () => {
    it('should remove backups older than retention period', async () => {
      // Create plugin
      const pluginDir = path.join(serverDir, 'plugins', 'test-plugin');
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'index.js'), '');

      // Create backup
      const entry = await backupManager.createBackup('test-plugin', 'test');

      // Manually update the manifest to have old timestamp
      const manifestPath = path.join(serverDir, '.wos-backups', 'manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
      manifest.backups[0].timestamp = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      // Cleanup with 7 day retention
      const deleted = await backupManager.cleanup(7);

      expect(deleted).toBe(1);
      const backups = await backupManager.list();
      expect(backups.length).toBe(0);
    });

    it('should keep recent backups', async () => {
      // Create plugin
      const pluginDir = path.join(serverDir, 'plugins', 'test-plugin');
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'index.js'), '');

      // Create backup (recent)
      await backupManager.createBackup('test-plugin', 'test');

      // Cleanup with 7 day retention
      const deleted = await backupManager.cleanup(7);

      expect(deleted).toBe(0);
      const backups = await backupManager.list();
      expect(backups.length).toBe(1);
    });
  });

  describe('getLatest', () => {
    it('should return latest backup for a plugin', async () => {
      // Create plugin
      const pluginDir = path.join(serverDir, 'plugins', 'test-plugin');
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'index.js'), '');

      await backupManager.createBackup('test-plugin', 'first');
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      const second = await backupManager.createBackup('test-plugin', 'second');

      const latest = await backupManager.getLatest('test-plugin');

      expect(latest?.id).toBe(second.id);
      expect(latest?.reason).toBe('second');
    });

    it('should return undefined if no backups exist', async () => {
      const latest = await backupManager.getLatest('nonexistent');
      expect(latest).toBeUndefined();
    });
  });
});
