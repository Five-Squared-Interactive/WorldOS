/**
 * Pack Command Tests
 *
 * Story 8.4: Plugin Packaging
 *
 * Tests for packaging plugins for distribution.
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import {
  PackOptions,
  packPlugin,
  validatePackable,
  getPackageFiles,
  createTarball,
} from './pack.js';

describe('Pack Command', () => {
  let tmpDir: string;
  let pluginDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-pack-test-'));
    pluginDir = path.join(tmpDir, 'my-plugin');
    await fs.mkdir(pluginDir, { recursive: true });

    // Create a minimal plugin structure
    await fs.mkdir(path.join(pluginDir, 'dist'), { recursive: true });
    await fs.writeFile(
      path.join(pluginDir, 'wos-plugin.yaml'),
      yaml.stringify({
        name: 'my-plugin',
        version: '1.0.0',
        runtime: 'node',
        entrypoint: 'dist/index.js',
        description: 'A test plugin',
      })
    );
    await fs.writeFile(
      path.join(pluginDir, 'package.json'),
      JSON.stringify({
        name: 'my-plugin',
        version: '1.0.0',
      })
    );
    await fs.writeFile(
      path.join(pluginDir, 'dist', 'index.js'),
      'module.exports = {};'
    );
    await fs.writeFile(
      path.join(pluginDir, 'README.md'),
      '# My Plugin'
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('validatePackable', () => {
    it('should validate a packable plugin', async () => {
      const result = await validatePackable(pluginDir);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should fail if manifest is missing', async () => {
      await fs.rm(path.join(pluginDir, 'wos-plugin.yaml'));

      const result = await validatePackable(pluginDir);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing wos-plugin.yaml');
    });

    it('should fail if entrypoint is missing', async () => {
      await fs.rm(path.join(pluginDir, 'dist', 'index.js'));

      const result = await validatePackable(pluginDir);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('entrypoint'))).toBe(true);
    });

    it('should warn about missing README', async () => {
      await fs.rm(path.join(pluginDir, 'README.md'));

      const result = await validatePackable(pluginDir);

      expect(result.warnings.some(w => w.includes('README'))).toBe(true);
    });

    it('should require version in manifest', async () => {
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        yaml.stringify({
          name: 'my-plugin',
          runtime: 'node',
          entrypoint: 'dist/index.js',
        })
      );

      const result = await validatePackable(pluginDir);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('version'))).toBe(true);
    });
  });

  describe('getPackageFiles', () => {
    it('should include manifest', async () => {
      const files = await getPackageFiles(pluginDir);

      expect(files.some(f => f.includes('wos-plugin.yaml'))).toBe(true);
    });

    it('should include entrypoint', async () => {
      const files = await getPackageFiles(pluginDir);

      expect(files.some(f => f.includes('dist/index.js') || f.includes('dist\\index.js'))).toBe(true);
    });

    it('should include README if present', async () => {
      const files = await getPackageFiles(pluginDir);

      expect(files.some(f => f.includes('README'))).toBe(true);
    });

    it('should exclude node_modules', async () => {
      await fs.mkdir(path.join(pluginDir, 'node_modules'), { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'node_modules', 'dep.js'), 'dep');

      const files = await getPackageFiles(pluginDir);

      expect(files.some(f => f.includes('node_modules'))).toBe(false);
    });

    it('should exclude .git directory', async () => {
      await fs.mkdir(path.join(pluginDir, '.git'), { recursive: true });
      await fs.writeFile(path.join(pluginDir, '.git', 'config'), 'config');

      const files = await getPackageFiles(pluginDir);

      expect(files.some(f => f.includes('.git'))).toBe(false);
    });

    it('should exclude source files by default', async () => {
      await fs.mkdir(path.join(pluginDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'src', 'index.ts'), 'source');

      const files = await getPackageFiles(pluginDir);

      expect(files.some(f => f.includes('src'))).toBe(false);
    });

    it('should include package.json', async () => {
      const files = await getPackageFiles(pluginDir);

      expect(files.some(f => f.includes('package.json'))).toBe(true);
    });
  });

  describe('packPlugin', () => {
    it('should create tarball', async () => {
      const result = await packPlugin({
        pluginDir,
        outputDir: tmpDir,
      });

      expect(result.success).toBe(true);
      expect(result.outputPath).toBeDefined();
    });

    it('should name tarball with plugin name and version', async () => {
      const result = await packPlugin({
        pluginDir,
        outputDir: tmpDir,
      });

      expect(result.outputPath).toContain('my-plugin');
      expect(result.outputPath).toContain('1.0.0');
    });

    it('should create .wospkg file', async () => {
      const result = await packPlugin({
        pluginDir,
        outputDir: tmpDir,
      });

      expect(result.outputPath?.endsWith('.wospkg')).toBe(true);
    });

    it('should include file count in result', async () => {
      const result = await packPlugin({
        pluginDir,
        outputDir: tmpDir,
      });

      expect(result.fileCount).toBeGreaterThan(0);
    });

    it('should include package size in result', async () => {
      const result = await packPlugin({
        pluginDir,
        outputDir: tmpDir,
      });

      expect(result.size).toBeGreaterThan(0);
    });

    it('should fail if validation fails', async () => {
      await fs.rm(path.join(pluginDir, 'wos-plugin.yaml'));

      const result = await packPlugin({
        pluginDir,
        outputDir: tmpDir,
      });

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should use current directory if outputDir not specified', async () => {
      const result = await packPlugin({
        pluginDir,
      });

      expect(result.outputPath).toContain(pluginDir);
    });
  });

  describe('createTarball', () => {
    it('should create a tarball file', async () => {
      const files = ['wos-plugin.yaml', 'dist/index.js', 'package.json'];
      const outputPath = path.join(tmpDir, 'test.wospkg');

      await createTarball(pluginDir, files, outputPath);

      const exists = await fs.access(outputPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should have non-zero size', async () => {
      const files = ['wos-plugin.yaml', 'dist/index.js', 'package.json'];
      const outputPath = path.join(tmpDir, 'test.wospkg');

      await createTarball(pluginDir, files, outputPath);

      const stat = await fs.stat(outputPath);
      expect(stat.size).toBeGreaterThan(0);
    });
  });

  describe('options', () => {
    it('should support dry-run mode', async () => {
      const result = await packPlugin({
        pluginDir,
        outputDir: tmpDir,
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);

      // File should not be created
      if (result.outputPath) {
        const exists = await fs.access(result.outputPath).then(() => true).catch(() => false);
        expect(exists).toBe(false);
      }
    });

    it('should list files in dry-run mode', async () => {
      const result = await packPlugin({
        pluginDir,
        outputDir: tmpDir,
        dryRun: true,
      });

      expect(result.files.length).toBeGreaterThan(0);
    });

    it('should support custom output filename', async () => {
      const result = await packPlugin({
        pluginDir,
        outputDir: tmpDir,
        filename: 'custom-name.wospkg',
      });

      expect(result.outputPath).toContain('custom-name.wospkg');
    });
  });

  describe('python plugins', () => {
    it('should include python source files', async () => {
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        yaml.stringify({
          name: 'my-plugin',
          version: '1.0.0',
          runtime: 'python',
          entrypoint: 'src/plugin.py',
        })
      );
      await fs.mkdir(path.join(pluginDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'src', 'plugin.py'), 'plugin code');

      const files = await getPackageFiles(pluginDir);

      expect(files.some(f => f.includes('src'))).toBe(true);
    });

    it('should include pyproject.toml', async () => {
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        yaml.stringify({
          name: 'my-plugin',
          version: '1.0.0',
          runtime: 'python',
          entrypoint: 'src/plugin.py',
        })
      );
      await fs.mkdir(path.join(pluginDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'src', 'plugin.py'), 'plugin code');
      await fs.writeFile(path.join(pluginDir, 'pyproject.toml'), '[project]');

      const files = await getPackageFiles(pluginDir);

      expect(files.some(f => f.includes('pyproject.toml'))).toBe(true);
    });
  });
});
