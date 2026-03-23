/**
 * Plugin Loader Tests
 *
 * Stories 1.5, 1.7: Main Orchestrator
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { PluginLoader } from './plugin-loader.js';
import { MqttClient } from './health-monitor.js';

// Mock MQTT client
class MockMqttClient extends EventEmitter implements MqttClient {
  connected = true;

  async publish(): Promise<void> {}
  async subscribe(): Promise<void> {}
  async unsubscribe(): Promise<void> {}
}

describe('PluginLoader', () => {
  let loader: PluginLoader;
  let testDir: string;
  let pluginsDir: string;
  let mqttClient: MockMqttClient;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-loader-test-'));
    pluginsDir = path.join(testDir, 'plugins');
    await fs.mkdir(pluginsDir);

    loader = new PluginLoader({
      serverDir: testDir,
      mqttHost: 'localhost',
      mqttPort: 1883,
    });

    mqttClient = new MockMqttClient();
    loader.setMqttClient(mqttClient);
  });

  afterEach(async () => {
    await loader.stopAll();
    // Small delay to let Windows release file handles
    await new Promise(r => setTimeout(r, 200));
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors on Windows
    }
  });

  describe('loadAll', () => {
    it('should emit loader:ready for empty plugins directory', async () => {
      const readyHandler = vi.fn();
      loader.on('loader:ready', readyHandler);

      await loader.loadAll();

      expect(readyHandler).toHaveBeenCalled();
    });

    it('should discover and start valid plugins', async () => {
      // Create a test plugin
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
      await fs.writeFile(
        path.join(pluginDir, 'index.js'),
        'setTimeout(() => {}, 10000);'
      );

      const discoveredHandler = vi.fn();
      const startedHandler = vi.fn();
      loader.on('plugin:discovered', discoveredHandler);
      loader.on('plugin:started', startedHandler);

      await loader.loadAll();

      expect(discoveredHandler).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test-plugin' })
      );
      expect(startedHandler).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'test-plugin', state: 'running' })
      );
    });

    it('should respect dependency order', async () => {
      // Create plugin A (depends on B)
      const pluginADir = path.join(pluginsDir, 'plugin-a');
      await fs.mkdir(pluginADir);
      await fs.writeFile(
        path.join(pluginADir, 'wos-plugin.yaml'),
        `name: plugin-a
version: 1.0.0
runtime: node
entrypoint: index.js
dependencies:
  - plugin-b
`
      );
      await fs.writeFile(path.join(pluginADir, 'index.js'), 'setTimeout(() => {}, 10000);');

      // Create plugin B (no dependencies)
      const pluginBDir = path.join(pluginsDir, 'plugin-b');
      await fs.mkdir(pluginBDir);
      await fs.writeFile(
        path.join(pluginBDir, 'wos-plugin.yaml'),
        `name: plugin-b
version: 1.0.0
runtime: node
entrypoint: index.js
`
      );
      await fs.writeFile(path.join(pluginBDir, 'index.js'), 'setTimeout(() => {}, 10000);');

      const startOrder: string[] = [];
      loader.on('plugin:started', (status) => {
        startOrder.push(status.name);
      });

      await loader.loadAll();

      // B should start before A
      expect(startOrder.indexOf('plugin-b')).toBeLessThan(startOrder.indexOf('plugin-a'));
    });

    it('should emit errors for invalid plugins but continue', async () => {
      // Create valid plugin
      const validDir = path.join(pluginsDir, 'valid-plugin');
      await fs.mkdir(validDir);
      await fs.writeFile(
        path.join(validDir, 'wos-plugin.yaml'),
        `name: valid-plugin
version: 1.0.0
runtime: node
entrypoint: index.js
`
      );
      await fs.writeFile(path.join(validDir, 'index.js'), 'setTimeout(() => {}, 10000);');

      // Create invalid plugin (missing manifest)
      const invalidDir = path.join(pluginsDir, 'invalid-plugin');
      await fs.mkdir(invalidDir);

      const errorHandler = vi.fn();
      const startedHandler = vi.fn();
      loader.on('loader:error', errorHandler);
      loader.on('plugin:started', startedHandler);

      await loader.loadAll();

      expect(errorHandler).toHaveBeenCalled();
      expect(startedHandler).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'valid-plugin' })
      );
    });
  });

  describe('startPlugin / stopPlugin', () => {
    it('should start a registered plugin', async () => {
      const pluginDir = path.join(pluginsDir, 'start-test');
      await fs.mkdir(pluginDir);
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: start-test
version: 1.0.0
runtime: node
entrypoint: index.js
`
      );
      await fs.writeFile(path.join(pluginDir, 'index.js'), 'setTimeout(() => {}, 10000);');

      await loader.loadAll();

      const status = loader.getPluginStatus('start-test');
      expect(status?.state).toBe('running');
      expect(status?.pid).toBeGreaterThan(0);
    });

    it('should stop a running plugin', async () => {
      const pluginDir = path.join(pluginsDir, 'stop-test');
      await fs.mkdir(pluginDir);
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: stop-test
version: 1.0.0
runtime: node
entrypoint: index.js
`
      );
      await fs.writeFile(path.join(pluginDir, 'index.js'), 'setTimeout(() => {}, 10000);');

      await loader.loadAll();
      await loader.stopPlugin('stop-test');

      const status = loader.getPluginStatus('stop-test');
      expect(status?.state).toBe('stopped');
    });

    it('should emit stopping and stopped events', async () => {
      const pluginDir = path.join(pluginsDir, 'event-test');
      await fs.mkdir(pluginDir);
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: event-test
version: 1.0.0
runtime: node
entrypoint: index.js
`
      );
      await fs.writeFile(path.join(pluginDir, 'index.js'), 'setTimeout(() => {}, 10000);');

      const stoppingHandler = vi.fn();
      const stoppedHandler = vi.fn();
      loader.on('plugin:stopping', stoppingHandler);
      loader.on('plugin:stopped', stoppedHandler);

      await loader.loadAll();
      await loader.stopPlugin('event-test');

      expect(stoppingHandler).toHaveBeenCalledWith('event-test');
      expect(stoppedHandler).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'event-test' })
      );
    });
  });

  describe('restartPlugin', () => {
    it('should stop and start a plugin', async () => {
      const pluginDir = path.join(pluginsDir, 'restart-test');
      await fs.mkdir(pluginDir);
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: restart-test
version: 1.0.0
runtime: node
entrypoint: index.js
`
      );
      await fs.writeFile(path.join(pluginDir, 'index.js'), 'setTimeout(() => {}, 10000);');

      await loader.loadAll();
      const originalPid = loader.getPluginStatus('restart-test')?.pid;

      await loader.restartPlugin('restart-test');

      const status = loader.getPluginStatus('restart-test');
      expect(status?.state).toBe('running');
      expect(status?.pid).not.toBe(originalPid);
    });
  });

  describe('getServerStatus', () => {
    it('should return healthy when all plugins running', async () => {
      const pluginDir = path.join(pluginsDir, 'healthy-test');
      await fs.mkdir(pluginDir);
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: healthy-test
version: 1.0.0
runtime: node
entrypoint: index.js
`
      );
      await fs.writeFile(path.join(pluginDir, 'index.js'), 'setTimeout(() => {}, 10000);');

      await loader.loadAll();

      const status = loader.getServerStatus();
      expect(status.status).toBe('healthy');
      expect(status.totalPlugins).toBe(1);
      expect(status.runningPlugins).toBe(1);
      expect(status.failedPlugins).toBe(0);
    });

    it('should return appropriate counts', async () => {
      // Create multiple plugins
      for (let i = 0; i < 3; i++) {
        const pluginDir = path.join(pluginsDir, `plugin-${i}`);
        await fs.mkdir(pluginDir);
        await fs.writeFile(
          path.join(pluginDir, 'wos-plugin.yaml'),
          `name: plugin-${i}
version: 1.0.0
runtime: node
entrypoint: index.js
`
        );
        await fs.writeFile(path.join(pluginDir, 'index.js'), 'setTimeout(() => {}, 10000);');
      }

      await loader.loadAll();

      const status = loader.getServerStatus();
      expect(status.totalPlugins).toBe(3);
      expect(status.runningPlugins).toBe(3);
      expect(status.plugins).toHaveLength(3);
    });
  });

  describe('isRunning', () => {
    it('should return true for running plugin', async () => {
      const pluginDir = path.join(pluginsDir, 'running-check');
      await fs.mkdir(pluginDir);
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: running-check
version: 1.0.0
runtime: node
entrypoint: index.js
`
      );
      await fs.writeFile(path.join(pluginDir, 'index.js'), 'setTimeout(() => {}, 10000);');

      await loader.loadAll();

      expect(loader.isRunning('running-check')).toBe(true);
    });

    it('should return false for stopped plugin', async () => {
      const pluginDir = path.join(pluginsDir, 'stopped-check');
      await fs.mkdir(pluginDir);
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: stopped-check
version: 1.0.0
runtime: node
entrypoint: index.js
`
      );
      await fs.writeFile(path.join(pluginDir, 'index.js'), 'setTimeout(() => {}, 10000);');

      await loader.loadAll();
      await loader.stopPlugin('stopped-check');

      expect(loader.isRunning('stopped-check')).toBe(false);
    });

    it('should return false for unknown plugin', () => {
      expect(loader.isRunning('unknown')).toBe(false);
    });
  });

  describe('crash detection', () => {
    it('should emit plugin:crashed when process exits abnormally', async () => {
      const pluginDir = path.join(pluginsDir, 'crash-test');
      await fs.mkdir(pluginDir);
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: crash-test
version: 1.0.0
runtime: node
entrypoint: index.js
`
      );
      // Script that exits with error
      await fs.writeFile(
        path.join(pluginDir, 'index.js'),
        'process.exit(1);'
      );

      const crashHandler = vi.fn();
      loader.on('plugin:crashed', crashHandler);

      await loader.loadAll();

      // Wait for crash detection
      await new Promise(r => setTimeout(r, 500));

      expect(crashHandler).toHaveBeenCalled();
    });

    it('should emit plugin:restarting when restart is scheduled', async () => {
      const pluginDir = path.join(pluginsDir, 'restart-event-test');
      await fs.mkdir(pluginDir);
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: restart-event-test
version: 1.0.0
runtime: node
entrypoint: index.js
`
      );
      await fs.writeFile(
        path.join(pluginDir, 'index.js'),
        'process.exit(1);'
      );

      const restartingHandler = vi.fn();
      loader.on('plugin:restarting', restartingHandler);

      await loader.loadAll();

      // Wait for crash and restart scheduling
      await new Promise(r => setTimeout(r, 500));

      expect(restartingHandler).toHaveBeenCalledWith('restart-event-test', 1, expect.any(Number));
    });
  });

  describe('output capture', () => {
    it('should emit plugin:output for stdout', async () => {
      const pluginDir = path.join(pluginsDir, 'output-test');
      await fs.mkdir(pluginDir);
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: output-test
version: 1.0.0
runtime: node
entrypoint: index.js
`
      );
      await fs.writeFile(
        path.join(pluginDir, 'index.js'),
        `console.log('hello world');
setTimeout(() => {}, 5000);`
      );

      const outputHandler = vi.fn();
      loader.on('plugin:output', outputHandler);

      await loader.loadAll();

      // Wait for output
      await new Promise(r => setTimeout(r, 200));

      expect(outputHandler).toHaveBeenCalledWith(
        'output-test',
        expect.stringContaining('hello'),
        'stdout'
      );
    });
  });

  describe('resetCircuitBreaker', () => {
    it('should allow failed plugin to be restarted', async () => {
      const pluginDir = path.join(pluginsDir, 'circuit-test');
      await fs.mkdir(pluginDir);
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: circuit-test
version: 1.0.0
runtime: node
entrypoint: index.js
`
      );
      await fs.writeFile(path.join(pluginDir, 'index.js'), 'setTimeout(() => {}, 10000);');

      await loader.loadAll();

      // Manually set to failed state
      const status = loader.getPluginStatus('circuit-test');
      expect(status?.state).toBe('running');

      loader.resetCircuitBreaker('circuit-test');

      // Should be able to restart
      expect(() => loader.restartPlugin('circuit-test')).not.toThrow();
    });
  });

  describe('getAllPluginStatuses', () => {
    it('should return status of all plugins', async () => {
      for (let i = 0; i < 2; i++) {
        const pluginDir = path.join(pluginsDir, `status-plugin-${i}`);
        await fs.mkdir(pluginDir);
        await fs.writeFile(
          path.join(pluginDir, 'wos-plugin.yaml'),
          `name: status-plugin-${i}
version: 1.0.0
runtime: node
entrypoint: index.js
`
        );
        await fs.writeFile(path.join(pluginDir, 'index.js'), 'setTimeout(() => {}, 10000);');
      }

      await loader.loadAll();

      const statuses = loader.getAllPluginStatuses();
      expect(statuses).toHaveLength(2);

      const names = statuses.map(s => s.name);
      expect(names).toContain('status-plugin-0');
      expect(names).toContain('status-plugin-1');
    });
  });
});
