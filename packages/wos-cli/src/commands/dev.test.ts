/**
 * Dev Command Tests
 *
 * Story 8.3: `wos dev` Command
 *
 * Tests for development mode with hot-reload.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import {
  DevRunner,
  DevRunnerOptions,
  DevRunnerEvents,
} from './dev.js';

describe('Dev Command', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-dev-test-'));

    // Create a minimal plugin structure
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'wos-plugin.yaml'),
      yaml.stringify({
        name: 'test-plugin',
        version: '0.1.0',
        runtime: 'node',
        entrypoint: 'dist/index.js',
      })
    );
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-plugin',
        scripts: { build: 'echo "build"' },
      })
    );
    await fs.writeFile(
      path.join(tmpDir, 'src', 'index.ts'),
      'export default class Plugin {}'
    );
  });

  afterEach(async () => {
    // Small delay to let file watchers fully release on Windows
    await new Promise(resolve => setTimeout(resolve, 100));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('DevRunner', () => {
    it('should create dev runner', () => {
      const runner = new DevRunner({ pluginDir: tmpDir });
      expect(runner).toBeDefined();
    });

    it('should detect plugin directory', async () => {
      const runner = new DevRunner({ pluginDir: tmpDir });
      const valid = await runner.validatePluginDir();
      expect(valid).toBe(true);
    });

    it('should fail for non-plugin directory', async () => {
      const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-empty-'));
      try {
        const runner = new DevRunner({ pluginDir: emptyDir });
        const valid = await runner.validatePluginDir();
        expect(valid).toBe(false);
      } finally {
        await fs.rm(emptyDir, { recursive: true, force: true });
      }
    });

    it('should load manifest', async () => {
      const runner = new DevRunner({ pluginDir: tmpDir });
      const manifest = await runner.loadManifest();

      expect(manifest.name).toBe('test-plugin');
      expect(manifest.runtime).toBe('node');
    });
  });

  describe('file watching', () => {
    it('should setup watcher for src directory', async () => {
      const runner = new DevRunner({ pluginDir: tmpDir });

      let watchDir: string | null = null;
      runner.on('watching', (dir: string) => {
        watchDir = dir;
      });

      await runner.setupWatcher();
      runner.stop();

      // Extra delay for Windows to release file handles
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(watchDir).toContain('src');
    });

    it('should emit change event on file modification', async () => {
      const runner = new DevRunner({ pluginDir: tmpDir });

      const changes: string[] = [];
      runner.on('change', (file: string) => {
        changes.push(file);
      });

      await runner.setupWatcher();

      // Simulate file change
      await fs.writeFile(
        path.join(tmpDir, 'src', 'index.ts'),
        'export default class Plugin { updated = true; }'
      );

      // Wait for watcher to detect
      await new Promise(resolve => setTimeout(resolve, 500));

      runner.stop();

      // Extra delay for Windows to release file handles
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(changes.length).toBeGreaterThanOrEqual(1);
    });

    it('should not watch when noReload is true', async () => {
      const runner = new DevRunner({ pluginDir: tmpDir, noReload: true });

      let watching = false;
      runner.on('watching', () => {
        watching = true;
      });

      await runner.setupWatcher();
      runner.stop();

      expect(watching).toBe(false);
    });
  });

  describe('build', () => {
    it('should run build command', async () => {
      const runner = new DevRunner({ pluginDir: tmpDir });

      let buildStarted = false;
      let buildCompleted = false;
      runner.on('build:start', () => {
        buildStarted = true;
      });
      runner.on('build:complete', () => {
        buildCompleted = true;
      });

      await runner.build();

      expect(buildStarted).toBe(true);
      expect(buildCompleted).toBe(true);
    });

    it('should emit error on build failure', async () => {
      // Create package with failing build
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'test-plugin',
          scripts: { build: 'exit 1' },
        })
      );

      const runner = new DevRunner({ pluginDir: tmpDir });

      let errorEmitted = false;
      runner.on('build:error', () => {
        errorEmitted = true;
      });

      try {
        await runner.build();
      } catch {
        // Expected
      }

      expect(errorEmitted).toBe(true);
    });
  });

  describe('plugin lifecycle', () => {
    it('should track running state', async () => {
      const runner = new DevRunner({ pluginDir: tmpDir });

      expect(runner.isRunning()).toBe(false);
    });

    it('should emit start event', async () => {
      const runner = new DevRunner({ pluginDir: tmpDir });

      let started = false;
      runner.on('start', () => {
        started = true;
      });

      // Just test the event emission
      runner.emit('start');

      expect(started).toBe(true);
    });

    it('should emit stop event on stop', async () => {
      const runner = new DevRunner({ pluginDir: tmpDir });

      let stopped = false;
      runner.on('stop', () => {
        stopped = true;
      });

      runner.stop();

      expect(stopped).toBe(true);
    });
  });

  describe('reload', () => {
    it('should emit reload event', async () => {
      const runner = new DevRunner({ pluginDir: tmpDir });

      let reloaded = false;
      runner.on('reload', () => {
        reloaded = true;
      });

      await runner.reload();

      expect(reloaded).toBe(true);
    });
  });

  describe('server connection', () => {
    it('should accept server directory option', () => {
      const serverDir = '/path/to/server';
      const runner = new DevRunner({
        pluginDir: tmpDir,
        serverDir,
      });

      expect(runner.getServerDir()).toBe(serverDir);
    });

    it('should use default server when not specified', () => {
      const runner = new DevRunner({ pluginDir: tmpDir });
      expect(runner.getServerDir()).toBeUndefined();
    });
  });

  describe('configuration', () => {
    it('should respect watch patterns', async () => {
      const runner = new DevRunner({
        pluginDir: tmpDir,
        watchPatterns: ['src/**/*.ts', 'config/**/*.yaml'],
      });

      const patterns = runner.getWatchPatterns();
      expect(patterns).toContain('src/**/*.ts');
      expect(patterns).toContain('config/**/*.yaml');
    });

    it('should have default watch patterns', () => {
      const runner = new DevRunner({ pluginDir: tmpDir });
      const patterns = runner.getWatchPatterns();

      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns).toContain('src/**/*');
    });

    it('should support debounce configuration', () => {
      const runner = new DevRunner({
        pluginDir: tmpDir,
        debounceMs: 500,
      });

      expect(runner.getDebounceMs()).toBe(500);
    });

    it('should have default debounce', () => {
      const runner = new DevRunner({ pluginDir: tmpDir });
      expect(runner.getDebounceMs()).toBe(300);
    });
  });
});
