/**
 * Process Spawner Tests
 *
 * Story 1.2: Spawn Plugin Processes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ProcessSpawner, SpawnConfig, spawnPlugin } from './process-spawner.js';
import type { PluginManifest } from './types.js';

describe('ProcessSpawner', () => {
  let spawner: ProcessSpawner;
  let testDir: string;

  beforeEach(async () => {
    spawner = new ProcessSpawner();
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spawner-test-'));
  });

  afterEach(async () => {
    // Small delay to let Windows release file handles
    await new Promise(r => setTimeout(r, 100));
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors on Windows
    }
  });

  describe('detectRuntime', () => {
    it('should detect node runtime from explicit runtime', () => {
      const manifest: PluginManifest = {
        name: 'test',
        version: '1.0.0',
        runtime: 'node',
        entrypoint: 'index.js',
      };

      expect(spawner.detectRuntime(manifest)).toBe('node');
    });

    it('should detect node runtime from nodejs alias', () => {
      const manifest: PluginManifest = {
        name: 'test',
        version: '1.0.0',
        runtime: 'nodejs',
        entrypoint: 'index.js',
      };

      expect(spawner.detectRuntime(manifest)).toBe('node');
    });

    it('should detect python runtime', () => {
      const manifest: PluginManifest = {
        name: 'test',
        version: '1.0.0',
        runtime: 'python',
        entrypoint: 'main.py',
      };

      expect(spawner.detectRuntime(manifest)).toBe('python');
    });

    it('should detect python runtime from py alias', () => {
      const manifest: PluginManifest = {
        name: 'test',
        version: '1.0.0',
        runtime: 'py',
        entrypoint: 'main.py',
      };

      expect(spawner.detectRuntime(manifest)).toBe('python');
    });

    it('should detect binary runtime', () => {
      const manifest: PluginManifest = {
        name: 'test',
        version: '1.0.0',
        runtime: 'binary',
        entrypoint: './plugin',
      };

      expect(spawner.detectRuntime(manifest)).toBe('binary');
    });

    it('should detect docker runtime', () => {
      const manifest: PluginManifest = {
        name: 'test',
        version: '1.0.0',
        runtime: 'docker',
        entrypoint: 'my-plugin:latest',
      };

      expect(spawner.detectRuntime(manifest)).toBe('docker');
    });

    it('should infer node from .js extension', () => {
      const manifest: PluginManifest = {
        name: 'test',
        version: '1.0.0',
        runtime: '',
        entrypoint: 'index.js',
      };

      expect(spawner.detectRuntime(manifest)).toBe('node');
    });

    it('should infer node from .mjs extension', () => {
      const manifest: PluginManifest = {
        name: 'test',
        version: '1.0.0',
        runtime: '',
        entrypoint: 'index.mjs',
      };

      expect(spawner.detectRuntime(manifest)).toBe('node');
    });

    it('should infer python from .py extension', () => {
      const manifest: PluginManifest = {
        name: 'test',
        version: '1.0.0',
        runtime: '',
        entrypoint: 'main.py',
      };

      expect(spawner.detectRuntime(manifest)).toBe('python');
    });

    it('should infer binary from .exe extension', () => {
      const manifest: PluginManifest = {
        name: 'test',
        version: '1.0.0',
        runtime: '',
        entrypoint: 'plugin.exe',
      };

      expect(spawner.detectRuntime(manifest)).toBe('binary');
    });

    it('should infer docker from colon in entrypoint', () => {
      const manifest: PluginManifest = {
        name: 'test',
        version: '1.0.0',
        runtime: '',
        entrypoint: 'myregistry/plugin:v1',
      };

      expect(spawner.detectRuntime(manifest)).toBe('docker');
    });
  });

  describe('spawn', () => {
    it('should spawn a node process and return PID', async () => {
      // Create a simple script
      const scriptPath = path.join(testDir, 'index.js');
      await fs.writeFile(scriptPath, `
        // Keep process alive for a bit
        setTimeout(() => process.exit(0), 5000);
        console.log('Started');
      `);

      const config: SpawnConfig = {
        manifest: {
          name: 'test-plugin',
          version: '1.0.0',
          runtime: 'node',
          entrypoint: 'index.js',
        },
        pluginDir: testDir,
        mqttHost: 'localhost',
        mqttPort: 1883,
        configPath: path.join(testDir, 'config.yaml'),
        serverDir: testDir,
      };

      const result = spawner.spawn(config);

      expect(result.process).toBeDefined();
      expect(result.pid).toBeGreaterThan(0);
      expect(result.command).toBe(process.execPath);
      expect(result.args).toContain('index.js');

      // Clean up
      result.process.kill();
    });

    it('should set WOS environment variables', async () => {
      const scriptPath = path.join(testDir, 'env-check.js');
      await fs.writeFile(scriptPath, `
        console.log(JSON.stringify({
          WOS_MQTT_HOST: process.env.WOS_MQTT_HOST,
          WOS_MQTT_PORT: process.env.WOS_MQTT_PORT,
          WOS_PLUGIN_NAME: process.env.WOS_PLUGIN_NAME,
          WOS_CONFIG_PATH: process.env.WOS_CONFIG_PATH,
          WOS_SERVER_DIR: process.env.WOS_SERVER_DIR,
        }));
      `);

      const config: SpawnConfig = {
        manifest: {
          name: 'env-test-plugin',
          version: '1.0.0',
          runtime: 'node',
          entrypoint: 'env-check.js',
        },
        pluginDir: testDir,
        mqttHost: 'mqtt.example.com',
        mqttPort: 1884,
        configPath: '/path/to/config.yaml',
        serverDir: '/path/to/server',
      };

      const result = spawner.spawn(config);

      // Capture output
      let output = '';
      result.process.stdout?.on('data', (data) => {
        output += data.toString();
      });

      // Wait for process to complete
      await new Promise<void>((resolve) => {
        result.process.on('exit', () => resolve());
      });

      const env = JSON.parse(output);
      expect(env.WOS_MQTT_HOST).toBe('mqtt.example.com');
      expect(env.WOS_MQTT_PORT).toBe('1884');
      expect(env.WOS_PLUGIN_NAME).toBe('env-test-plugin');
      expect(env.WOS_CONFIG_PATH).toBe('/path/to/config.yaml');
      expect(env.WOS_SERVER_DIR).toBe('/path/to/server');
    });

    it('should include optional MQTT credentials', async () => {
      const scriptPath = path.join(testDir, 'creds-check.js');
      await fs.writeFile(scriptPath, `
        console.log(JSON.stringify({
          WOS_MQTT_USERNAME: process.env.WOS_MQTT_USERNAME,
          WOS_MQTT_PASSWORD: process.env.WOS_MQTT_PASSWORD,
        }));
      `);

      const config: SpawnConfig = {
        manifest: {
          name: 'creds-test',
          version: '1.0.0',
          runtime: 'node',
          entrypoint: 'creds-check.js',
        },
        pluginDir: testDir,
        mqttHost: 'localhost',
        mqttPort: 1883,
        configPath: '/config.yaml',
        serverDir: '/server',
        mqttUsername: 'user',
        mqttPassword: 'pass',
      };

      const result = spawner.spawn(config);

      let output = '';
      result.process.stdout?.on('data', (data) => {
        output += data.toString();
      });

      await new Promise<void>((resolve) => {
        result.process.on('exit', () => resolve());
      });

      const env = JSON.parse(output);
      expect(env.WOS_MQTT_USERNAME).toBe('user');
      expect(env.WOS_MQTT_PASSWORD).toBe('pass');
    });
  });

  describe('killGracefully', () => {
    it('should kill process with SIGTERM', async () => {
      const scriptPath = path.join(testDir, 'long-running.js');
      await fs.writeFile(scriptPath, `
        // Simulate graceful shutdown
        process.on('SIGTERM', () => {
          console.log('Received SIGTERM');
          process.exit(0);
        });
        setInterval(() => {}, 1000);
      `);

      const config: SpawnConfig = {
        manifest: {
          name: 'long-running',
          version: '1.0.0',
          runtime: 'node',
          entrypoint: 'long-running.js',
        },
        pluginDir: testDir,
        mqttHost: 'localhost',
        mqttPort: 1883,
        configPath: '/config.yaml',
        serverDir: '/server',
      };

      const result = spawner.spawn(config);

      // Give process time to start
      await new Promise(r => setTimeout(r, 100));

      await spawner.killGracefully(result.process, 5000);

      // Process should be dead
      expect(result.process.killed || result.process.exitCode !== null).toBe(true);
    });

    it('should force kill after timeout', async () => {
      const scriptPath = path.join(testDir, 'ignore-sigterm.js');
      await fs.writeFile(scriptPath, `
        // Ignore SIGTERM (Windows doesn't support this well)
        process.on('SIGTERM', () => {
          console.log('Ignoring SIGTERM');
        });
        setInterval(() => {}, 1000);
      `);

      const config: SpawnConfig = {
        manifest: {
          name: 'ignore-sigterm',
          version: '1.0.0',
          runtime: 'node',
          entrypoint: 'ignore-sigterm.js',
        },
        pluginDir: testDir,
        mqttHost: 'localhost',
        mqttPort: 1883,
        configPath: '/config.yaml',
        serverDir: '/server',
      };

      const result = spawner.spawn(config);

      // Give process time to start
      await new Promise(r => setTimeout(r, 100));

      await spawner.killGracefully(result.process, 500);

      // Process should be dead regardless of how it was killed
      expect(result.process.killed || result.process.exitCode !== null).toBe(true);
    });
  });

  describe('forceKill', () => {
    it('should immediately kill process', async () => {
      const scriptPath = path.join(testDir, 'unkillable.js');
      await fs.writeFile(scriptPath, `
        setInterval(() => {}, 1000);
      `);

      const config: SpawnConfig = {
        manifest: {
          name: 'unkillable',
          version: '1.0.0',
          runtime: 'node',
          entrypoint: 'unkillable.js',
        },
        pluginDir: testDir,
        mqttHost: 'localhost',
        mqttPort: 1883,
        configPath: '/config.yaml',
        serverDir: '/server',
      };

      const result = spawner.spawn(config);

      // Give process time to start
      await new Promise(r => setTimeout(r, 100));

      let exitCalled = false;
      result.process.on('exit', () => {
        exitCalled = true;
      });

      spawner.forceKill(result.process);

      // Wait a bit for process to die
      await new Promise(r => setTimeout(r, 200));

      expect(exitCalled).toBe(true);
    });
  });
});

describe('spawnPlugin convenience function', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spawn-plugin-test-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should spawn a plugin process', async () => {
    const scriptPath = path.join(testDir, 'index.js');
    await fs.writeFile(scriptPath, 'setTimeout(() => {}, 5000);');

    const result = spawnPlugin({
      manifest: {
        name: 'test',
        version: '1.0.0',
        runtime: 'node',
        entrypoint: 'index.js',
      },
      pluginDir: testDir,
      mqttHost: 'localhost',
      mqttPort: 1883,
      configPath: '/config.yaml',
      serverDir: '/server',
    });

    expect(result.pid).toBeGreaterThan(0);
    result.process.kill();
  });
});
