/**
 * Config Manager Tests
 *
 * Story 5.3: Environment Variable Support
 * Story 5.5: Configuration Schema Validation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ConfigManager, ConfigSchema } from './config-manager.js';

describe('ConfigManager', () => {
  let tempDir: string;
  let serverDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-manager-test-'));
    serverDir = path.join(tempDir, 'server');
    await fs.mkdir(serverDir, { recursive: true });
    await fs.mkdir(path.join(serverDir, 'plugins', 'test-plugin'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    // Clean up env vars
    delete process.env.WOS_PLUGIN_TEST_PLUGIN_PORT;
    delete process.env.WOS_PLUGIN_TEST_PLUGIN_DEBUG;
    delete process.env.WOS_PLUGIN_TEST_PLUGIN_STORAGE_BACKEND;
  });

  describe('loadConfig', () => {
    it('should load config from wos.yaml', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `plugins:
  test-plugin:
    config:
      port: 3000
      debug: true
`
      );

      const manager = new ConfigManager(serverDir);
      const config = await manager.loadConfig('test-plugin');

      expect(config.port).toBe(3000);
      expect(config.debug).toBe(true);
    });

    it('should return empty object when no config', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `plugins:
  test-plugin:
    enabled: true
`
      );

      const manager = new ConfigManager(serverDir);
      const config = await manager.loadConfig('test-plugin');

      expect(config).toEqual({});
    });

    it('should throw error for unknown plugin', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `plugins: {}`
      );

      const manager = new ConfigManager(serverDir);
      await expect(manager.loadConfig('unknown')).rejects.toThrow(/not found/i);
    });
  });

  describe('environment variable overrides', () => {
    it('should override config with environment variables', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `plugins:
  test-plugin:
    config:
      port: 3000
`
      );

      process.env.WOS_PLUGIN_TEST_PLUGIN_PORT = '4000';

      const manager = new ConfigManager(serverDir);
      const config = await manager.loadConfig('test-plugin');

      expect(config.port).toBe(4000);
    });

    it('should handle boolean env vars', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `plugins:
  test-plugin:
    config:
      debug: false
`
      );

      process.env.WOS_PLUGIN_TEST_PLUGIN_DEBUG = 'true';

      const manager = new ConfigManager(serverDir);
      const config = await manager.loadConfig('test-plugin');

      expect(config.debug).toBe(true);
    });

    it('should handle nested env vars with double underscore', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `plugins:
  test-plugin:
    config:
      storage:
        backend: memory
`
      );

      process.env.WOS_PLUGIN_TEST_PLUGIN_STORAGE__BACKEND = 'redis';

      const manager = new ConfigManager(serverDir);
      const config = await manager.loadConfig('test-plugin');

      expect(config.storage.backend).toBe('redis');

      delete process.env.WOS_PLUGIN_TEST_PLUGIN_STORAGE__BACKEND;
    });

    it('should convert plugin name to uppercase with underscores', async () => {
      await fs.mkdir(path.join(serverDir, 'plugins', 'my-cool-plugin'), { recursive: true });
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `plugins:
  my-cool-plugin:
    config:
      port: 3000
`
      );

      process.env.WOS_PLUGIN_MY_COOL_PLUGIN_PORT = '5000';

      const manager = new ConfigManager(serverDir);
      const config = await manager.loadConfig('my-cool-plugin');

      expect(config.port).toBe(5000);

      delete process.env.WOS_PLUGIN_MY_COOL_PLUGIN_PORT;
    });
  });

  describe('schema validation', () => {
    const schema: ConfigSchema = {
      type: 'object',
      properties: {
        port: { type: 'number', minimum: 1, maximum: 65535 },
        debug: { type: 'boolean' },
        name: { type: 'string', minLength: 1 },
        level: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
      required: ['port'],
    };

    it('should validate config against schema', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `plugins:
  test-plugin:
    config:
      port: 3000
      debug: true
`
      );

      const manager = new ConfigManager(serverDir);
      const result = await manager.validateConfig('test-plugin', schema);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required fields', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `plugins:
  test-plugin:
    config:
      debug: true
`
      );

      const manager = new ConfigManager(serverDir);
      const result = await manager.validateConfig('test-plugin', schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'port',
          message: expect.stringMatching(/required/i),
        })
      );
    });

    it('should detect type mismatches', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `plugins:
  test-plugin:
    config:
      port: "not-a-number"
`
      );

      const manager = new ConfigManager(serverDir);
      const result = await manager.validateConfig('test-plugin', schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'port',
          message: expect.stringMatching(/number|type/i),
        })
      );
    });

    it('should detect enum violations', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `plugins:
  test-plugin:
    config:
      port: 3000
      level: invalid
`
      );

      const manager = new ConfigManager(serverDir);
      const result = await manager.validateConfig('test-plugin', schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'level',
          message: expect.stringMatching(/low|medium|high/i),
        })
      );
    });

    it('should detect range violations', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `plugins:
  test-plugin:
    config:
      port: 99999
`
      );

      const manager = new ConfigManager(serverDir);
      const result = await manager.validateConfig('test-plugin', schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'port',
          message: expect.stringMatching(/maximum|65535/i),
        })
      );
    });
  });

  describe('defaults', () => {
    const schema: ConfigSchema = {
      type: 'object',
      properties: {
        port: { type: 'number', default: 8080 },
        debug: { type: 'boolean', default: false },
        timeout: { type: 'number', default: 30 },
      },
    };

    it('should apply defaults for missing values', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `plugins:
  test-plugin:
    config:
      port: 3000
`
      );

      const manager = new ConfigManager(serverDir);
      const config = await manager.loadConfigWithDefaults('test-plugin', schema);

      expect(config.port).toBe(3000); // Custom value
      expect(config.debug).toBe(false); // Default
      expect(config.timeout).toBe(30); // Default
    });

    it('should not override existing values with defaults', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `plugins:
  test-plugin:
    config:
      debug: true
`
      );

      const manager = new ConfigManager(serverDir);
      const config = await manager.loadConfigWithDefaults('test-plugin', schema);

      expect(config.debug).toBe(true); // Custom value, not default
    });
  });

  describe('saveConfig', () => {
    it('should save config to wos.yaml', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `plugins:
  test-plugin:
    enabled: true
`
      );

      const manager = new ConfigManager(serverDir);
      await manager.saveConfig('test-plugin', { port: 4000, debug: true });

      const content = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
      expect(content).toContain('port: 4000');
      expect(content).toContain('debug: true');
    });

    it('should merge with existing config', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `plugins:
  test-plugin:
    config:
      port: 3000
      debug: false
`
      );

      const manager = new ConfigManager(serverDir);
      await manager.saveConfig('test-plugin', { debug: true });

      const content = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
      expect(content).toContain('port: 3000');
      expect(content).toContain('debug: true');
    });
  });
});
