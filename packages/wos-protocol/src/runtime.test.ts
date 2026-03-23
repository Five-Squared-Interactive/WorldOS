/**
 * Runtime Detection Tests
 *
 * Story 10.3: Runtime Detection
 *
 * Tests for detecting and handling different plugin runtimes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RuntimeType,
  RuntimeConfig,
  detectRuntime,
  getRuntimeCommand,
  RuntimeRequirements,
  validateRuntime,
  isRuntimeAvailable,
} from './runtime.js';

describe('Runtime Detection', () => {
  describe('RuntimeType', () => {
    it('should support node runtime', () => {
      const runtime: RuntimeType = 'node';
      expect(runtime).toBe('node');
    });

    it('should support python runtime', () => {
      const runtime: RuntimeType = 'python';
      expect(runtime).toBe('python');
    });

    it('should support binary runtime', () => {
      const runtime: RuntimeType = 'binary';
      expect(runtime).toBe('binary');
    });

    it('should support docker runtime', () => {
      const runtime: RuntimeType = 'docker';
      expect(runtime).toBe('docker');
    });
  });

  describe('detectRuntime', () => {
    it('should detect node runtime from manifest', () => {
      const manifest = { runtime: 'node', entrypoint: 'dist/index.js' };
      const runtime = detectRuntime(manifest);
      expect(runtime).toBe('node');
    });

    it('should detect python runtime from manifest', () => {
      const manifest = { runtime: 'python', entrypoint: 'src/plugin.py' };
      const runtime = detectRuntime(manifest);
      expect(runtime).toBe('python');
    });

    it('should detect binary runtime from manifest', () => {
      const manifest = { runtime: 'binary', entrypoint: './plugin' };
      const runtime = detectRuntime(manifest);
      expect(runtime).toBe('binary');
    });

    it('should detect docker runtime from manifest', () => {
      const manifest = { runtime: 'docker', entrypoint: 'plugin:latest' };
      const runtime = detectRuntime(manifest);
      expect(runtime).toBe('docker');
    });

    it('should default to node for unknown runtime', () => {
      const manifest = { runtime: 'unknown', entrypoint: 'index.js' };
      const runtime = detectRuntime(manifest);
      expect(runtime).toBe('node');
    });

    it('should infer runtime from entrypoint extension', () => {
      const manifestJs = { entrypoint: 'dist/index.js' };
      const manifestPy = { entrypoint: 'src/plugin.py' };
      const manifestBin = { entrypoint: './plugin.exe' };

      expect(detectRuntime(manifestJs)).toBe('node');
      expect(detectRuntime(manifestPy)).toBe('python');
      expect(detectRuntime(manifestBin)).toBe('binary');
    });
  });

  describe('getRuntimeCommand', () => {
    it('should return node command for node runtime', () => {
      const config: RuntimeConfig = {
        type: 'node',
        entrypoint: 'dist/index.js',
        workingDir: '/plugins/my-plugin',
      };

      const command = getRuntimeCommand(config);

      expect(command.executable).toBe('node');
      expect(command.args).toContain('dist/index.js');
    });

    it('should return python command for python runtime', () => {
      const config: RuntimeConfig = {
        type: 'python',
        entrypoint: 'src/plugin.py',
        workingDir: '/plugins/my-plugin',
      };

      const command = getRuntimeCommand(config);

      expect(command.executable).toMatch(/python/);
      expect(command.args).toContain('src/plugin.py');
    });

    it('should return direct path for binary runtime', () => {
      const config: RuntimeConfig = {
        type: 'binary',
        entrypoint: './plugin',
        workingDir: '/plugins/my-plugin',
      };

      const command = getRuntimeCommand(config);

      expect(command.executable).toContain('plugin');
    });

    it('should return docker command for docker runtime', () => {
      const config: RuntimeConfig = {
        type: 'docker',
        entrypoint: 'my-plugin:latest',
        workingDir: '/plugins/my-plugin',
      };

      const command = getRuntimeCommand(config);

      expect(command.executable).toBe('docker');
      expect(command.args).toContain('run');
    });

    it('should include environment variables', () => {
      const config: RuntimeConfig = {
        type: 'node',
        entrypoint: 'dist/index.js',
        workingDir: '/plugins/my-plugin',
        env: {
          WOS_MQTT_HOST: 'localhost',
          WOS_MQTT_PORT: '1883',
          WOS_PLUGIN_NAME: 'my-plugin',
          WOS_CONFIG_PATH: '/config.yaml',
        },
      };

      const command = getRuntimeCommand(config);

      expect(command.env).toBeDefined();
      expect(command.env?.WOS_PLUGIN_NAME).toBe('my-plugin');
    });
  });

  describe('RuntimeRequirements', () => {
    it('should define node requirements', () => {
      const reqs: RuntimeRequirements = {
        node: { minVersion: '18.0.0' },
      };

      expect(reqs.node?.minVersion).toBe('18.0.0');
    });

    it('should define python requirements', () => {
      const reqs: RuntimeRequirements = {
        python: { minVersion: '3.9.0' },
      };

      expect(reqs.python?.minVersion).toBe('3.9.0');
    });

    it('should define docker requirements', () => {
      const reqs: RuntimeRequirements = {
        docker: { minVersion: '20.0.0' },
      };

      expect(reqs.docker?.minVersion).toBe('20.0.0');
    });
  });

  describe('validateRuntime', () => {
    it('should validate node runtime', async () => {
      const result = await validateRuntime('node');

      expect(result.available).toBeDefined();
      expect(typeof result.available).toBe('boolean');
    });

    it('should return version info', async () => {
      const result = await validateRuntime('node');

      if (result.available) {
        expect(result.version).toBeDefined();
      }
    });

    it('should handle missing runtime', async () => {
      // Mock a missing runtime
      const result = await validateRuntime('nonexistent' as RuntimeType);

      expect(result.available).toBe(false);
    });

    it('should include error message for unavailable runtime', async () => {
      const result = await validateRuntime('nonexistent' as RuntimeType);

      expect(result.error).toBeDefined();
    });
  });

  describe('isRuntimeAvailable', () => {
    it('should check if node is available', async () => {
      const available = await isRuntimeAvailable('node');

      // Node should always be available in test environment
      expect(available).toBe(true);
    });

    it('should return false for unknown runtime', async () => {
      const available = await isRuntimeAvailable('unknown' as RuntimeType);

      expect(available).toBe(false);
    });
  });

  describe('cross-runtime messaging', () => {
    it('should use same MQTT topics regardless of runtime', () => {
      const nodePlugin = { name: 'my-plugin', runtime: 'node' };
      const pythonPlugin = { name: 'my-plugin', runtime: 'python' };

      // Both should use same topic pattern
      const nodeTopic = `wos/plugin/${nodePlugin.name}/health/request`;
      const pythonTopic = `wos/plugin/${pythonPlugin.name}/health/request`;

      expect(nodeTopic).toBe(pythonTopic);
    });

    it('should use same message format regardless of runtime', () => {
      const healthRequest = {
        correlationId: 'req-123',
        timestamp: new Date().toISOString(),
      };

      // Message format is runtime-agnostic
      expect(typeof healthRequest.correlationId).toBe('string');
      expect(typeof healthRequest.timestamp).toBe('string');
    });
  });
});
