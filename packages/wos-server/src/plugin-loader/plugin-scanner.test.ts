/**
 * Plugin Scanner Tests
 *
 * Story 1.9: Plugin Directory Discovery
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PluginScanner, scanPlugins, scanSinglePlugin } from './plugin-scanner.js';

describe('PluginScanner', () => {
  let testDir: string;
  let pluginsDir: string;
  let scanner: PluginScanner;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-scanner-test-'));
    pluginsDir = path.join(testDir, 'plugins');
    await fs.mkdir(pluginsDir);

    scanner = new PluginScanner({ validateFiles: false });
  });

  afterEach(async () => {
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('scan', () => {
    it('should return empty result for empty plugins directory', async () => {
      const result = await scanner.scan(pluginsDir);

      expect(result.plugins).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should return empty result for non-existent plugins directory', async () => {
      const result = await scanner.scan(path.join(testDir, 'nonexistent'));

      expect(result.plugins).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should discover valid plugin with manifest', async () => {
      const pluginDir = path.join(pluginsDir, 'test-plugin');
      await fs.mkdir(pluginDir);
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: test-plugin
version: 1.0.0
runtime: node
entrypoint: index.js
`
      );

      const result = await scanner.scan(pluginsDir);

      expect(result.plugins).toHaveLength(1);
      expect(result.plugins[0].name).toBe('test-plugin');
      expect(result.plugins[0].manifest.version).toBe('1.0.0');
      expect(result.plugins[0].manifest.runtime).toBe('node');
      expect(result.errors).toHaveLength(0);
    });

    it('should discover multiple plugins', async () => {
      // Create plugin 1
      const plugin1Dir = path.join(pluginsDir, 'plugin-one');
      await fs.mkdir(plugin1Dir);
      await fs.writeFile(
        path.join(plugin1Dir, 'wos-plugin.yaml'),
        `name: plugin-one
version: 1.0.0
runtime: node
entrypoint: index.js
`
      );

      // Create plugin 2
      const plugin2Dir = path.join(pluginsDir, 'plugin-two');
      await fs.mkdir(plugin2Dir);
      await fs.writeFile(
        path.join(plugin2Dir, 'wos-plugin.yaml'),
        `name: plugin-two
version: 2.0.0
runtime: python
entrypoint: main.py
`
      );

      const result = await scanner.scan(pluginsDir);

      expect(result.plugins).toHaveLength(2);
      const names = result.plugins.map(p => p.name);
      expect(names).toContain('plugin-one');
      expect(names).toContain('plugin-two');
    });

    it('should report error for missing manifest', async () => {
      const pluginDir = path.join(pluginsDir, 'no-manifest');
      await fs.mkdir(pluginDir);

      const result = await scanner.scan(pluginsDir);

      expect(result.plugins).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Missing manifest');
    });

    it('should report error for invalid YAML', async () => {
      const pluginDir = path.join(pluginsDir, 'bad-yaml');
      await fs.mkdir(pluginDir);
      // Use YAML that actually fails to parse
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        'name: test\n  bad indentation: here'
      );

      const result = await scanner.scan(pluginsDir);

      expect(result.plugins).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      // Error could be YAML parsing error or validation error
      expect(result.errors[0].message).toBeDefined();
    });

    it('should report error for invalid manifest structure', async () => {
      const pluginDir = path.join(pluginsDir, 'bad-manifest');
      await fs.mkdir(pluginDir);
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: bad-manifest
# missing required fields
`
      );

      const result = await scanner.scan(pluginsDir);

      expect(result.plugins).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('validation failed');
      expect(result.errors[0].validationErrors).toBeDefined();
    });

    it('should skip files in plugins directory', async () => {
      await fs.writeFile(path.join(pluginsDir, 'readme.txt'), 'test');

      const result = await scanner.scan(pluginsDir);

      expect(result.plugins).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should parse optional fields', async () => {
      const pluginDir = path.join(pluginsDir, 'full-plugin');
      await fs.mkdir(pluginDir);
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: full-plugin
version: 1.0.0
runtime: node
entrypoint: index.js
description: A full featured plugin
dependencies:
  - other-plugin
`
      );

      const result = await scanner.scan(pluginsDir);

      expect(result.plugins).toHaveLength(1);
      expect(result.plugins[0].manifest.description).toBe('A full featured plugin');
      expect(result.plugins[0].manifest.dependencies).toEqual(['other-plugin']);
    });
  });

  describe('scanPlugin', () => {
    it('should return plugin for valid directory', async () => {
      const pluginDir = path.join(pluginsDir, 'valid-plugin');
      await fs.mkdir(pluginDir);
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: valid-plugin
version: 1.0.0
runtime: node
entrypoint: index.js
`
      );

      const result = await scanner.scanPlugin(pluginDir);

      expect(result.plugin).toBeDefined();
      expect(result.plugin?.name).toBe('valid-plugin');
      expect(result.error).toBeUndefined();
    });

    it('should return error for missing manifest', async () => {
      const pluginDir = path.join(pluginsDir, 'no-manifest');
      await fs.mkdir(pluginDir);

      const result = await scanner.scanPlugin(pluginDir);

      expect(result.plugin).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Missing manifest');
    });
  });

  describe('isValidPlugin', () => {
    it('should return true for valid plugin', async () => {
      const pluginDir = path.join(pluginsDir, 'valid');
      await fs.mkdir(pluginDir);
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: valid
version: 1.0.0
runtime: node
entrypoint: index.js
`
      );

      const isValid = await scanner.isValidPlugin(pluginDir);
      expect(isValid).toBe(true);
    });

    it('should return false for invalid plugin', async () => {
      const pluginDir = path.join(pluginsDir, 'invalid');
      await fs.mkdir(pluginDir);

      const isValid = await scanner.isValidPlugin(pluginDir);
      expect(isValid).toBe(false);
    });
  });

  describe('getManifestPath', () => {
    it('should return correct manifest path', () => {
      const pluginDir = '/path/to/plugin';
      const manifestPath = scanner.getManifestPath(pluginDir);

      expect(manifestPath).toBe(path.join(pluginDir, 'wos-plugin.yaml'));
    });
  });
});

describe('scanPlugins convenience function', () => {
  let testDir: string;
  let pluginsDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-plugins-test-'));
    pluginsDir = path.join(testDir, 'plugins');
    await fs.mkdir(pluginsDir);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should scan plugins directory', async () => {
    const pluginDir = path.join(pluginsDir, 'test');
    await fs.mkdir(pluginDir);
    await fs.writeFile(
      path.join(pluginDir, 'wos-plugin.yaml'),
      `name: test
version: 1.0.0
runtime: node
entrypoint: index.js
`
    );

    const result = await scanPlugins(pluginsDir, { validateFiles: false });

    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].name).toBe('test');
  });
});

describe('scanSinglePlugin convenience function', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-single-test-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should return plugin for valid directory', async () => {
    await fs.writeFile(
      path.join(testDir, 'wos-plugin.yaml'),
      `name: single-test
version: 1.0.0
runtime: node
entrypoint: index.js
`
    );

    const plugin = await scanSinglePlugin(testDir, { validateFiles: false });

    expect(plugin).not.toBeNull();
    expect(plugin?.name).toBe('single-test');
  });

  it('should return null for invalid directory', async () => {
    const plugin = await scanSinglePlugin(testDir, { validateFiles: false });
    expect(plugin).toBeNull();
  });
});
