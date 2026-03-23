/**
 * Config Command Tests
 *
 * Story 5.1: wos config get Command
 * Story 5.2: wos config set Command
 * Story 5.4: wos config reset Command
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import Config from './config.js';

describe('Config Command', () => {
  let tempDir: string;
  let serverDir: string;
  let mockLog: Mock;
  let mockError: Mock;
  let mockWarn: Mock;
  let command: Config;

  beforeEach(async () => {
    // Create temp directories
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-config-test-'));
    serverDir = path.join(tempDir, 'server');

    // Create server directory with plugin
    await fs.mkdir(serverDir, { recursive: true });
    await fs.mkdir(path.join(serverDir, 'plugins', 'test-plugin'), { recursive: true });

    // Create plugin manifest with config schema
    await fs.writeFile(
      path.join(serverDir, 'plugins', 'test-plugin', 'wos-plugin.yaml'),
      `name: test-plugin
version: 1.0.0
runtime: node
entrypoint: ./dist/index.js
config:
  schema:
    type: object
    properties:
      port:
        type: number
        default: 8080
      debug:
        type: boolean
        default: false
      storage:
        type: object
        properties:
          backend:
            type: string
            default: memory
`
    );

    // Create wos.yaml with plugin config
    await fs.writeFile(
      path.join(serverDir, 'wos.yaml'),
      `server:
  port: 8080
plugins:
  test-plugin:
    enabled: true
    version: 1.0.0
    source: ./test-plugin
    config:
      port: 3000
      debug: true
`
    );

    // Create mock command
    mockLog = vi.fn();
    mockError = vi.fn();
    mockWarn = vi.fn();
    command = Object.create(Config.prototype);
    command.log = mockLog;
    command.error = mockError;
    command.warn = mockWarn;
    command.parse = vi.fn();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('config get', () => {
    it('should display all config for a plugin', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin' },
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('port');
      expect(output).toContain('3000');
      expect(output).toContain('debug');
      expect(output).toContain('true');
    });

    it('should display specific key value', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin', key: 'port' },
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('3000');
    });

    it('should support dot notation for nested keys', async () => {
      // Add nested config
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `server:
  port: 8080
plugins:
  test-plugin:
    enabled: true
    version: 1.0.0
    source: ./test-plugin
    config:
      storage:
        backend: sqlite
        path: /data/db.sqlite
`
      );

      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin', key: 'storage.backend' },
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('sqlite');
    });

    it('should output JSON with --json flag', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin' },
        flags: { directory: serverDir, json: true },
      });

      await command.run();

      const logCalls = mockLog.mock.calls.flat();
      const jsonOutput = logCalls.find(call => {
        try {
          JSON.parse(call);
          return true;
        } catch {
          return false;
        }
      });

      expect(jsonOutput).toBeDefined();
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.port).toBe(3000);
      expect(parsed.debug).toBe(true);
    });

    it('should show defaults when no custom config', async () => {
      // Remove custom config
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `server:
  port: 8080
plugins:
  test-plugin:
    enabled: true
    version: 1.0.0
    source: ./test-plugin
`
      );

      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin' },
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toMatch(/default|no.*config/i);
    });
  });

  describe('config set', () => {
    it('should set a config value', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin', key: 'port', value: '4000' },
        flags: { directory: serverDir },
      });

      await command.run();

      const content = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
      expect(content).toContain('4000');
    });

    it('should convert numeric strings to numbers', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin', key: 'port', value: '5000' },
        flags: { directory: serverDir },
      });

      await command.run();

      const content = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
      // YAML should not have quotes around number
      expect(content).toMatch(/port:\s*5000/);
      expect(content).not.toMatch(/port:\s*["']5000["']/);
    });

    it('should convert boolean strings to booleans', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin', key: 'debug', value: 'false' },
        flags: { directory: serverDir },
      });

      await command.run();

      const content = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
      expect(content).toMatch(/debug:\s*false/);
    });

    it('should create nested keys', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin', key: 'storage.backend', value: 'redis' },
        flags: { directory: serverDir },
      });

      await command.run();

      const content = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
      expect(content).toContain('storage');
      expect(content).toContain('backend');
      expect(content).toContain('redis');
    });

    it('should show success message', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin', key: 'port', value: '9000' },
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockLog).toHaveBeenCalledWith(
        expect.stringMatching(/set|updated|changed/i)
      );
    });
  });

  describe('config reset', () => {
    it('should reset all config with --reset flag', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin' },
        flags: { directory: serverDir, reset: true, yes: true },
      });

      await command.run();

      const content = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
      // Config section should be removed or empty
      expect(content).not.toContain('port: 3000');
      expect(content).not.toContain('debug: true');
    });

    it('should reset specific key', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin', key: 'port' },
        flags: { directory: serverDir, reset: true, yes: true },
      });

      await command.run();

      const content = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
      // Port should be removed but debug should remain
      expect(content).not.toContain('port: 3000');
      expect(content).toContain('debug: true');
    });

    it('should show success message after reset', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin' },
        flags: { directory: serverDir, reset: true, yes: true },
      });

      await command.run();

      expect(mockLog).toHaveBeenCalledWith(
        expect.stringMatching(/reset|restored|default/i)
      );
    });
  });

  describe('error handling', () => {
    it('should error if plugin not found', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'nonexistent' },
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/not found|not installed/i),
        expect.anything()
      );
    });

    it('should error if server not initialized', async () => {
      await fs.unlink(path.join(serverDir, 'wos.yaml'));

      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin' },
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/not initialized|wos\.yaml/i),
        expect.anything()
      );
    });

    it('should error if key not found when getting specific key', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin', key: 'nonexistent.key' },
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/not found|undefined|does not exist/i),
        expect.anything()
      );
    });
  });

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(Config.description).toMatch(/config/i);
    });

    it('should have examples', () => {
      expect(Config.examples).toBeDefined();
      expect(Config.examples.length).toBeGreaterThan(0);
    });

    it('should require plugin argument', () => {
      expect(Config.args.plugin.required).toBe(true);
    });

    it('should have optional key argument', () => {
      expect(Config.args.key.required).toBe(false);
    });

    it('should have --json flag', () => {
      expect(Config.flags.json).toBeDefined();
    });

    it('should have --reset flag', () => {
      expect(Config.flags.reset).toBeDefined();
    });
  });
});
