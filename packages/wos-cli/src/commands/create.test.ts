/**
 * Create Plugin Command Tests
 *
 * Story 8.1: `wos create plugin` Command
 *
 * Tests for scaffolding new plugins from templates.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import {
  createPlugin,
  CreatePluginOptions,
  getAvailableTemplates,
  validatePluginName,
} from './create.js';

describe('Create Plugin Command', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-create-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('validatePluginName', () => {
    it('should accept valid plugin names', () => {
      expect(validatePluginName('my-plugin')).toBe(true);
      expect(validatePluginName('plugin123')).toBe(true);
      expect(validatePluginName('my_plugin')).toBe(true);
      expect(validatePluginName('MyPlugin')).toBe(true);
    });

    it('should reject invalid plugin names', () => {
      expect(validatePluginName('')).toBe(false);
      expect(validatePluginName('my plugin')).toBe(false);
      expect(validatePluginName('my/plugin')).toBe(false);
      expect(validatePluginName('.hidden')).toBe(false);
      expect(validatePluginName('-starts-with-dash')).toBe(false);
    });

    it('should reject reserved names', () => {
      expect(validatePluginName('node_modules')).toBe(false);
      expect(validatePluginName('wos')).toBe(false);
      expect(validatePluginName('worldos')).toBe(false);
    });
  });

  describe('getAvailableTemplates', () => {
    it('should return available templates', () => {
      const templates = getAvailableTemplates();
      expect(templates).toContain('node');
      expect(templates).toContain('typescript');
    });

    it('should include python template', () => {
      const templates = getAvailableTemplates();
      expect(templates).toContain('python');
    });
  });

  describe('createPlugin', () => {
    it('should create plugin directory', async () => {
      const pluginPath = path.join(tmpDir, 'my-plugin');

      await createPlugin({
        name: 'my-plugin',
        directory: tmpDir,
        template: 'typescript',
      });

      const exists = await fs.access(pluginPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should create wos-plugin.yaml manifest', async () => {
      await createPlugin({
        name: 'my-plugin',
        directory: tmpDir,
        template: 'typescript',
      });

      const manifestPath = path.join(tmpDir, 'my-plugin', 'wos-plugin.yaml');
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);

      expect(manifest.name).toBe('my-plugin');
      expect(manifest.version).toBe('0.1.0');
      expect(manifest.runtime).toBe('node');
    });

    it('should create package.json for typescript template', async () => {
      await createPlugin({
        name: 'my-plugin',
        directory: tmpDir,
        template: 'typescript',
      });

      const pkgPath = path.join(tmpDir, 'my-plugin', 'package.json');
      const content = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);

      expect(pkg.name).toBe('my-plugin');
      expect(pkg.dependencies).toBeDefined();
    });

    it('should create source files', async () => {
      await createPlugin({
        name: 'my-plugin',
        directory: tmpDir,
        template: 'typescript',
      });

      const srcPath = path.join(tmpDir, 'my-plugin', 'src', 'index.ts');
      const exists = await fs.access(srcPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should create tsconfig.json for typescript template', async () => {
      await createPlugin({
        name: 'my-plugin',
        directory: tmpDir,
        template: 'typescript',
      });

      const tsconfigPath = path.join(tmpDir, 'my-plugin', 'tsconfig.json');
      const exists = await fs.access(tsconfigPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should include description in manifest', async () => {
      await createPlugin({
        name: 'my-plugin',
        directory: tmpDir,
        template: 'typescript',
        description: 'My awesome plugin',
      });

      const manifestPath = path.join(tmpDir, 'my-plugin', 'wos-plugin.yaml');
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);

      expect(manifest.description).toBe('My awesome plugin');
    });

    it('should throw if directory already exists', async () => {
      const pluginPath = path.join(tmpDir, 'existing-plugin');
      await fs.mkdir(pluginPath, { recursive: true });

      await expect(createPlugin({
        name: 'existing-plugin',
        directory: tmpDir,
        template: 'typescript',
      })).rejects.toThrow('already exists');
    });

    it('should allow overwriting with force flag', async () => {
      const pluginPath = path.join(tmpDir, 'existing-plugin');
      await fs.mkdir(pluginPath, { recursive: true });
      await fs.writeFile(path.join(pluginPath, 'old-file.txt'), 'old content');

      await createPlugin({
        name: 'existing-plugin',
        directory: tmpDir,
        template: 'typescript',
        force: true,
      });

      const manifestPath = path.join(pluginPath, 'wos-plugin.yaml');
      const exists = await fs.access(manifestPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should create Python files for python template', async () => {
      await createPlugin({
        name: 'my-python-plugin',
        directory: tmpDir,
        template: 'python',
      });

      const pyPath = path.join(tmpDir, 'my-python-plugin', 'src', 'plugin.py');
      const exists = await fs.access(pyPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should create pyproject.toml for python template', async () => {
      await createPlugin({
        name: 'my-python-plugin',
        directory: tmpDir,
        template: 'python',
      });

      const pyprojectPath = path.join(tmpDir, 'my-python-plugin', 'pyproject.toml');
      const exists = await fs.access(pyprojectPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should set runtime to python for python template', async () => {
      await createPlugin({
        name: 'my-python-plugin',
        directory: tmpDir,
        template: 'python',
      });

      const manifestPath = path.join(tmpDir, 'my-python-plugin', 'wos-plugin.yaml');
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);

      expect(manifest.runtime).toBe('python');
    });
  });

  describe('features', () => {
    it('should add CLI feature when requested', async () => {
      await createPlugin({
        name: 'my-plugin',
        directory: tmpDir,
        template: 'typescript',
        features: ['cli'],
      });

      const cliPath = path.join(tmpDir, 'my-plugin', 'src', 'cli');
      const exists = await fs.access(cliPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      const manifestPath = path.join(tmpDir, 'my-plugin', 'wos-plugin.yaml');
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      expect(manifest.cli).toBeDefined();
    });

    it('should add admin feature when requested', async () => {
      await createPlugin({
        name: 'my-plugin',
        directory: tmpDir,
        template: 'typescript',
        features: ['admin'],
      });

      const adminPath = path.join(tmpDir, 'my-plugin', 'src', 'admin');
      const exists = await fs.access(adminPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      const manifestPath = path.join(tmpDir, 'my-plugin', 'wos-plugin.yaml');
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);
      expect(manifest.admin).toBeDefined();
    });

    it('should support multiple features', async () => {
      await createPlugin({
        name: 'my-plugin',
        directory: tmpDir,
        template: 'typescript',
        features: ['cli', 'admin'],
      });

      const manifestPath = path.join(tmpDir, 'my-plugin', 'wos-plugin.yaml');
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = yaml.parse(content);

      expect(manifest.cli).toBeDefined();
      expect(manifest.admin).toBeDefined();
    });
  });

  describe('template content', () => {
    it('should replace placeholders in templates', async () => {
      await createPlugin({
        name: 'my-plugin',
        directory: tmpDir,
        template: 'typescript',
        description: 'Test description',
        author: 'Test Author',
      });

      const pkgPath = path.join(tmpDir, 'my-plugin', 'package.json');
      const content = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);

      expect(pkg.name).toBe('my-plugin');
      expect(pkg.description).toBe('Test description');
      expect(pkg.author).toBe('Test Author');
    });

    it('should include test file', async () => {
      await createPlugin({
        name: 'my-plugin',
        directory: tmpDir,
        template: 'typescript',
      });

      const testPath = path.join(tmpDir, 'my-plugin', 'src', 'index.test.ts');
      const exists = await fs.access(testPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should include README.md', async () => {
      await createPlugin({
        name: 'my-plugin',
        directory: tmpDir,
        template: 'typescript',
      });

      const readmePath = path.join(tmpDir, 'my-plugin', 'README.md');
      const content = await fs.readFile(readmePath, 'utf-8');
      expect(content).toContain('my-plugin');
    });
  });
});
