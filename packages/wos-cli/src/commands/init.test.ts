/**
 * Init Command Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  initServerDirectory,
  isServerDirectory,
  getDefaultConfig,
} from './init.js';

describe('Init Command', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-init-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('getDefaultConfig', () => {
    it('should include server name', () => {
      const config = getDefaultConfig('my-server');

      expect(config).toContain('name: my-server');
    });

    it('should include default MQTT settings', () => {
      const config = getDefaultConfig('test');

      expect(config).toContain('mqtt:');
      expect(config).toContain('host: localhost');
      expect(config).toContain('port: 1883');
    });

    it('should include admin settings', () => {
      const config = getDefaultConfig('test');

      expect(config).toContain('admin:');
      expect(config).toContain('enabled: true');
      expect(config).toContain('port: 3000');
    });

    it('should include empty plugins section', () => {
      const config = getDefaultConfig('test');

      expect(config).toContain('plugins: {}');
    });
  });

  describe('initServerDirectory', () => {
    it('should create server directory', async () => {
      const serverDir = path.join(testDir, 'my-server');

      await initServerDirectory(serverDir);

      const stat = await fs.stat(serverDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should create plugins directory', async () => {
      const serverDir = path.join(testDir, 'my-server');

      await initServerDirectory(serverDir);

      const pluginsDir = path.join(serverDir, 'plugins');
      const stat = await fs.stat(pluginsDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should create wos.yaml', async () => {
      const serverDir = path.join(testDir, 'my-server');

      await initServerDirectory(serverDir);

      const configPath = path.join(serverDir, 'wos.yaml');
      const content = await fs.readFile(configPath, 'utf-8');
      expect(content).toContain('WorldOS Server Configuration');
    });

    it('should create .gitignore', async () => {
      const serverDir = path.join(testDir, 'my-server');

      await initServerDirectory(serverDir);

      const gitignorePath = path.join(serverDir, '.gitignore');
      const content = await fs.readFile(gitignorePath, 'utf-8');
      expect(content).toContain('node_modules/');
    });

    it('should use custom server name', async () => {
      const serverDir = path.join(testDir, 'my-server');

      await initServerDirectory(serverDir, { name: 'custom-name' });

      const configPath = path.join(serverDir, 'wos.yaml');
      const content = await fs.readFile(configPath, 'utf-8');
      expect(content).toContain('name: custom-name');
    });

    it('should not overwrite existing wos.yaml without force', async () => {
      const serverDir = path.join(testDir, 'my-server');
      await fs.mkdir(serverDir, { recursive: true });
      const configPath = path.join(serverDir, 'wos.yaml');
      await fs.writeFile(configPath, 'existing: config');

      const result = await initServerDirectory(serverDir);

      const content = await fs.readFile(configPath, 'utf-8');
      expect(content).toBe('existing: config');
      expect(result.skipped).toContain('wos.yaml (already exists)');
    });

    it('should overwrite existing wos.yaml with force', async () => {
      const serverDir = path.join(testDir, 'my-server');
      await fs.mkdir(serverDir, { recursive: true });
      const configPath = path.join(serverDir, 'wos.yaml');
      await fs.writeFile(configPath, 'existing: config');

      const result = await initServerDirectory(serverDir, { force: true });

      const content = await fs.readFile(configPath, 'utf-8');
      expect(content).toContain('WorldOS Server Configuration');
      expect(result.created).toContain('wos.yaml');
    });

    it('should return created and skipped files', async () => {
      const serverDir = path.join(testDir, 'my-server');

      const result = await initServerDirectory(serverDir);

      expect(result.created).toContain('plugins/');
      expect(result.created).toContain('wos.yaml');
      expect(result.created).toContain('.gitignore');
    });
  });

  describe('isServerDirectory', () => {
    it('should return false for non-existent directory', async () => {
      const result = await isServerDirectory(path.join(testDir, 'nonexistent'));

      expect(result).toBe(false);
    });

    it('should return false for empty directory', async () => {
      const emptyDir = path.join(testDir, 'empty');
      await fs.mkdir(emptyDir);

      const result = await isServerDirectory(emptyDir);

      expect(result).toBe(false);
    });

    it('should return true for initialized directory', async () => {
      const serverDir = path.join(testDir, 'my-server');
      await initServerDirectory(serverDir);

      const result = await isServerDirectory(serverDir);

      expect(result).toBe(true);
    });

    it('should return true for directory with wos.yaml', async () => {
      const serverDir = path.join(testDir, 'my-server');
      await fs.mkdir(serverDir, { recursive: true });
      await fs.writeFile(path.join(serverDir, 'wos.yaml'), 'server: {}');

      const result = await isServerDirectory(serverDir);

      expect(result).toBe(true);
    });
  });
});
