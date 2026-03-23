/**
 * Plugin Registry Tests
 *
 * Story 4.8: Plugin Registry (State)
 * Story 4.1: wos add from Local Path (dependency)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PluginRegistry, PluginEntry, PluginSource } from './plugin-registry.js';

describe('PluginRegistry', () => {
  let tempDir: string;
  let registry: PluginRegistry;

  beforeEach(async () => {
    // Create temp directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-registry-test-'));

    // Create wos.yaml
    await fs.writeFile(
      path.join(tempDir, 'wos.yaml'),
      'server:\n  port: 8080\n'
    );

    registry = new PluginRegistry(tempDir);
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('initialization', () => {
    it('should load from existing wos.yaml', async () => {
      // Write wos.yaml with plugins
      await fs.writeFile(
        path.join(tempDir, 'wos.yaml'),
        `server:
  port: 8080
plugins:
  presence:
    enabled: true
    source: github:worldos/presence#v1.0.0
    installedAt: '2026-02-19T10:00:00Z'
`
      );

      await registry.load();

      const plugins = registry.getAll();
      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe('presence');
      expect(plugins[0].enabled).toBe(true);
    });

    it('should handle missing plugins section', async () => {
      await registry.load();

      const plugins = registry.getAll();
      expect(plugins).toHaveLength(0);
    });

    it('should create plugins directory if missing', async () => {
      await registry.load();

      const pluginsDir = path.join(tempDir, 'plugins');
      const exists = await fs.access(pluginsDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('plugin registration', () => {
    beforeEach(async () => {
      await registry.load();
    });

    it('should register a new plugin', async () => {
      const entry: PluginEntry = {
        name: 'test-plugin',
        version: '1.0.0',
        enabled: false,
        source: { type: 'local', path: './plugins/test-plugin' },
        installedAt: new Date().toISOString(),
      };

      await registry.register(entry);

      const plugin = registry.get('test-plugin');
      expect(plugin).toBeDefined();
      expect(plugin?.name).toBe('test-plugin');
      expect(plugin?.version).toBe('1.0.0');
    });

    it('should prevent duplicate registration', async () => {
      const entry: PluginEntry = {
        name: 'test-plugin',
        version: '1.0.0',
        enabled: false,
        source: { type: 'local', path: './plugins/test-plugin' },
        installedAt: new Date().toISOString(),
      };

      await registry.register(entry);

      await expect(registry.register(entry)).rejects.toThrow(/already/i);
    });

    it('should allow force registration', async () => {
      const entry1: PluginEntry = {
        name: 'test-plugin',
        version: '1.0.0',
        enabled: false,
        source: { type: 'local', path: './plugins/test-plugin' },
        installedAt: new Date().toISOString(),
      };

      const entry2: PluginEntry = {
        name: 'test-plugin',
        version: '2.0.0',
        enabled: true,
        source: { type: 'local', path: './plugins/test-plugin' },
        installedAt: new Date().toISOString(),
      };

      await registry.register(entry1);
      await registry.register(entry2, { force: true });

      const plugin = registry.get('test-plugin');
      expect(plugin?.version).toBe('2.0.0');
    });
  });

  describe('plugin removal', () => {
    beforeEach(async () => {
      await registry.load();
      await registry.register({
        name: 'test-plugin',
        version: '1.0.0',
        enabled: true,
        source: { type: 'local', path: './plugins/test-plugin' },
        installedAt: new Date().toISOString(),
      });
    });

    it('should unregister a plugin', async () => {
      await registry.unregister('test-plugin');

      const plugin = registry.get('test-plugin');
      expect(plugin).toBeUndefined();
    });

    it('should throw for unknown plugin', async () => {
      await expect(registry.unregister('unknown')).rejects.toThrow(/not found/i);
    });
  });

  describe('enable/disable', () => {
    beforeEach(async () => {
      await registry.load();
      await registry.register({
        name: 'test-plugin',
        version: '1.0.0',
        enabled: false,
        source: { type: 'local', path: './plugins/test-plugin' },
        installedAt: new Date().toISOString(),
      });
    });

    it('should enable a plugin', async () => {
      await registry.enable('test-plugin');

      const plugin = registry.get('test-plugin');
      expect(plugin?.enabled).toBe(true);
    });

    it('should disable a plugin', async () => {
      await registry.enable('test-plugin');
      await registry.disable('test-plugin');

      const plugin = registry.get('test-plugin');
      expect(plugin?.enabled).toBe(false);
    });

    it('should throw for unknown plugin', async () => {
      await expect(registry.enable('unknown')).rejects.toThrow(/not found/i);
    });
  });

  describe('persistence', () => {
    beforeEach(async () => {
      await registry.load();
    });

    it('should persist changes to wos.yaml', async () => {
      await registry.register({
        name: 'test-plugin',
        version: '1.0.0',
        enabled: true,
        source: { type: 'local', path: './plugins/test-plugin' },
        installedAt: '2026-02-20T10:00:00Z',
      });

      // Read wos.yaml to verify
      const content = await fs.readFile(path.join(tempDir, 'wos.yaml'), 'utf-8');
      expect(content).toContain('test-plugin');
      expect(content).toContain('enabled: true');
    });

    it('should preserve other config sections', async () => {
      await registry.register({
        name: 'test-plugin',
        version: '1.0.0',
        enabled: false,
        source: { type: 'local', path: './plugins/test-plugin' },
        installedAt: new Date().toISOString(),
      });

      const content = await fs.readFile(path.join(tempDir, 'wos.yaml'), 'utf-8');
      expect(content).toContain('port: 8080');
    });
  });

  describe('queries', () => {
    beforeEach(async () => {
      await registry.load();
      await registry.register({
        name: 'plugin-a',
        version: '1.0.0',
        enabled: true,
        source: { type: 'local', path: './plugins/plugin-a' },
        installedAt: new Date().toISOString(),
      });
      await registry.register({
        name: 'plugin-b',
        version: '2.0.0',
        enabled: false,
        source: { type: 'github', repo: 'user/plugin-b', ref: 'v2.0.0' },
        installedAt: new Date().toISOString(),
      });
    });

    it('should get all plugins', () => {
      const plugins = registry.getAll();
      expect(plugins).toHaveLength(2);
    });

    it('should get enabled plugins only', () => {
      const plugins = registry.getEnabled();
      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe('plugin-a');
    });

    it('should check if plugin exists', () => {
      expect(registry.has('plugin-a')).toBe(true);
      expect(registry.has('unknown')).toBe(false);
    });

    it('should check if plugin is enabled', () => {
      expect(registry.isEnabled('plugin-a')).toBe(true);
      expect(registry.isEnabled('plugin-b')).toBe(false);
      expect(registry.isEnabled('unknown')).toBe(false);
    });
  });

  describe('source types', () => {
    beforeEach(async () => {
      await registry.load();
    });

    it('should handle local source', async () => {
      await registry.register({
        name: 'local-plugin',
        version: '1.0.0',
        enabled: false,
        source: { type: 'local', path: './my-plugin' },
        installedAt: new Date().toISOString(),
      });

      const plugin = registry.get('local-plugin');
      expect(plugin?.source.type).toBe('local');
      if (plugin?.source.type === 'local') {
        expect(plugin.source.path).toBe('./my-plugin');
      }
    });

    it('should handle github source', async () => {
      await registry.register({
        name: 'github-plugin',
        version: '1.0.0',
        enabled: false,
        source: { type: 'github', repo: 'user/repo', ref: 'v1.0.0' },
        installedAt: new Date().toISOString(),
      });

      const plugin = registry.get('github-plugin');
      expect(plugin?.source.type).toBe('github');
      if (plugin?.source.type === 'github') {
        expect(plugin.source.repo).toBe('user/repo');
        expect(plugin.source.ref).toBe('v1.0.0');
      }
    });

    it('should handle git source', async () => {
      await registry.register({
        name: 'git-plugin',
        version: '1.0.0',
        enabled: false,
        source: { type: 'git', url: 'https://github.com/user/repo.git', ref: 'main' },
        installedAt: new Date().toISOString(),
      });

      const plugin = registry.get('git-plugin');
      expect(plugin?.source.type).toBe('git');
      if (plugin?.source.type === 'git') {
        expect(plugin.source.url).toBe('https://github.com/user/repo.git');
      }
    });
  });
});
