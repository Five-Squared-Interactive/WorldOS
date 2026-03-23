/**
 * Test Command Tests
 *
 * Story 8.5: Local Testing Support
 *
 * Tests for the `wos test` command and test harness.
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import {
  TestHarness,
  TestHarnessOptions,
  TestRunner,
  discoverTestFiles,
  TestResult,
} from './test.js';

describe('Test Command', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-test-test-'));

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
        scripts: { test: 'vitest run' },
      })
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('discoverTestFiles', () => {
    it('should discover .test.ts files', async () => {
      await fs.writeFile(path.join(tmpDir, 'src', 'index.test.ts'), 'test file');

      const files = await discoverTestFiles(tmpDir);

      expect(files.length).toBeGreaterThanOrEqual(1);
      expect(files.some(f => f.endsWith('.test.ts'))).toBe(true);
    });

    it('should discover .test.js files', async () => {
      await fs.writeFile(path.join(tmpDir, 'src', 'index.test.js'), 'test file');

      const files = await discoverTestFiles(tmpDir);

      expect(files.some(f => f.endsWith('.test.js'))).toBe(true);
    });

    it('should discover _test.py files', async () => {
      await fs.writeFile(path.join(tmpDir, 'src', 'plugin_test.py'), 'test file');

      const files = await discoverTestFiles(tmpDir);

      expect(files.some(f => f.endsWith('_test.py'))).toBe(true);
    });

    it('should discover test_*.py files', async () => {
      await fs.writeFile(path.join(tmpDir, 'src', 'test_plugin.py'), 'test file');

      const files = await discoverTestFiles(tmpDir);

      expect(files.some(f => f.includes('test_'))).toBe(true);
    });

    it('should return empty array when no tests found', async () => {
      const files = await discoverTestFiles(tmpDir);

      expect(files).toEqual([]);
    });

    it('should discover tests in nested directories', async () => {
      await fs.mkdir(path.join(tmpDir, 'src', 'nested'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'src', 'nested', 'deep.test.ts'), 'test file');

      const files = await discoverTestFiles(tmpDir);

      expect(files.some(f => f.includes('nested'))).toBe(true);
    });
  });

  describe('TestHarness', () => {
    it('should create test harness', () => {
      const harness = new TestHarness({ pluginDir: tmpDir });
      expect(harness).toBeDefined();
    });

    it('should provide plugin context', () => {
      const harness = new TestHarness({ pluginDir: tmpDir });
      const context = harness.getPluginContext();

      expect(context).toBeDefined();
      expect(context.pluginName).toBe('test-plugin');
    });

    it('should provide mock MQTT client', () => {
      const harness = new TestHarness({ pluginDir: tmpDir });
      const mqtt = harness.getMqttClient();

      expect(mqtt).toBeDefined();
      expect(mqtt.publish).toBeDefined();
      expect(mqtt.subscribe).toBeDefined();
    });

    it('should provide mock logger', () => {
      const harness = new TestHarness({ pluginDir: tmpDir });
      const logger = harness.getLogger();

      expect(logger).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.error).toBeDefined();
    });

    it('should setup before tests', async () => {
      const harness = new TestHarness({ pluginDir: tmpDir });

      await harness.setup();

      expect(harness.isSetup()).toBe(true);
    });

    it('should teardown after tests', async () => {
      const harness = new TestHarness({ pluginDir: tmpDir });

      await harness.setup();
      await harness.teardown();

      expect(harness.isSetup()).toBe(false);
    });

    it('should cleanup MQTT subscriptions after each test', async () => {
      const harness = new TestHarness({ pluginDir: tmpDir });
      const mqtt = harness.getMqttClient();

      await harness.setup();
      mqtt.subscribe('test/topic');

      harness.cleanup();

      expect(mqtt.getSubscriptions()).toEqual([]);
    });

    it('should track published messages', async () => {
      const harness = new TestHarness({ pluginDir: tmpDir });
      const mqtt = harness.getMqttClient();

      await harness.setup();
      mqtt.publish('test/topic', { data: 'value' });

      const messages = harness.getPublishedMessages();
      expect(messages.length).toBe(1);
      expect(messages[0].topic).toBe('test/topic');
    });
  });

  describe('mock MQTT client', () => {
    it('should allow subscribing to topics', () => {
      const harness = new TestHarness({ pluginDir: tmpDir });
      const mqtt = harness.getMqttClient();

      mqtt.subscribe('test/topic');

      expect(mqtt.getSubscriptions()).toContain('test/topic');
    });

    it('should allow publishing messages', () => {
      const harness = new TestHarness({ pluginDir: tmpDir });
      const mqtt = harness.getMqttClient();

      mqtt.publish('test/topic', { key: 'value' });

      const messages = harness.getPublishedMessages();
      expect(messages.length).toBe(1);
    });

    it('should deliver messages to subscribers', async () => {
      const harness = new TestHarness({ pluginDir: tmpDir });
      const mqtt = harness.getMqttClient();

      const received: any[] = [];
      mqtt.subscribe('test/topic');
      mqtt.on('message', (topic: string, message: any) => {
        received.push({ topic, message });
      });

      mqtt.publish('test/topic', { data: 'value' });

      // Wait for async delivery
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(received.length).toBe(1);
      expect(received[0].topic).toBe('test/topic');
    });

    it('should support wildcard subscriptions', async () => {
      const harness = new TestHarness({ pluginDir: tmpDir });
      const mqtt = harness.getMqttClient();

      const received: any[] = [];
      mqtt.subscribe('test/+/events');
      mqtt.on('message', (topic: string, message: any) => {
        received.push({ topic, message });
      });

      mqtt.publish('test/plugin/events', { data: 'value' });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(received.length).toBe(1);
    });

    it('should support multi-level wildcard', async () => {
      const harness = new TestHarness({ pluginDir: tmpDir });
      const mqtt = harness.getMqttClient();

      const received: any[] = [];
      mqtt.subscribe('test/#');
      mqtt.on('message', (topic: string, message: any) => {
        received.push({ topic, message });
      });

      mqtt.publish('test/plugin/deep/topic', { data: 'value' });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(received.length).toBe(1);
    });

    it('should unsubscribe from topics', () => {
      const harness = new TestHarness({ pluginDir: tmpDir });
      const mqtt = harness.getMqttClient();

      mqtt.subscribe('test/topic');
      mqtt.unsubscribe('test/topic');

      expect(mqtt.getSubscriptions()).not.toContain('test/topic');
    });
  });

  describe('TestRunner', () => {
    it('should create test runner', () => {
      const runner = new TestRunner({ pluginDir: tmpDir });
      expect(runner).toBeDefined();
    });

    it('should detect runtime from manifest', async () => {
      const runner = new TestRunner({ pluginDir: tmpDir });
      const runtime = await runner.detectRuntime();

      expect(runtime).toBe('node');
    });

    it('should detect python runtime', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'wos-plugin.yaml'),
        yaml.stringify({
          name: 'test-plugin',
          version: '0.1.0',
          runtime: 'python',
          entrypoint: 'src/plugin.py',
        })
      );

      const runner = new TestRunner({ pluginDir: tmpDir });
      const runtime = await runner.detectRuntime();

      expect(runtime).toBe('python');
    });

    it('should run node tests', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'test-plugin',
          scripts: { test: 'echo "test passed"' },
        })
      );

      const runner = new TestRunner({ pluginDir: tmpDir });
      const result = await runner.run();

      expect(result.success).toBe(true);
    });

    it('should report test failures', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'test-plugin',
          scripts: { test: 'exit 1' },
        })
      );

      const runner = new TestRunner({ pluginDir: tmpDir });
      const result = await runner.run();

      expect(result.success).toBe(false);
    });

    it('should emit start event', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'test-plugin',
          scripts: { test: 'echo "test"' },
        })
      );

      const runner = new TestRunner({ pluginDir: tmpDir });

      let started = false;
      runner.on('start', () => {
        started = true;
      });

      await runner.run();

      expect(started).toBe(true);
    });

    it('should emit complete event', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'test-plugin',
          scripts: { test: 'echo "test"' },
        })
      );

      const runner = new TestRunner({ pluginDir: tmpDir });

      let completed = false;
      runner.on('complete', () => {
        completed = true;
      });

      await runner.run();

      expect(completed).toBe(true);
    });

    it('should capture stdout', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'test-plugin',
          scripts: { test: 'echo "hello from tests"' },
        })
      );

      const runner = new TestRunner({ pluginDir: tmpDir });
      const result = await runner.run();

      expect(result.output).toContain('hello from tests');
    });

    it('should support watch mode', () => {
      const runner = new TestRunner({ pluginDir: tmpDir, watch: true });
      expect(runner.isWatchMode()).toBe(true);
    });
  });

  describe('plugin context', () => {
    it('should include plugin name', () => {
      const harness = new TestHarness({ pluginDir: tmpDir });
      const context = harness.getPluginContext();

      expect(context.pluginName).toBe('test-plugin');
    });

    it('should include plugin version', () => {
      const harness = new TestHarness({ pluginDir: tmpDir });
      const context = harness.getPluginContext();

      expect(context.version).toBe('0.1.0');
    });

    it('should provide config access', () => {
      const harness = new TestHarness({ pluginDir: tmpDir });
      const context = harness.getPluginContext();

      expect(context.config).toBeDefined();
      expect(context.config.get).toBeDefined();
    });

    it('should provide state access', () => {
      const harness = new TestHarness({ pluginDir: tmpDir });
      const context = harness.getPluginContext();

      expect(context.state).toBeDefined();
      expect(context.state.get).toBeDefined();
      expect(context.state.set).toBeDefined();
    });
  });
});
