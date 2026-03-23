/**
 * Remove Command Tests
 *
 * Story 4.3: wos remove Command
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import Remove from './remove.js';

describe('Remove Command', () => {
  let tempDir: string;
  let serverDir: string;
  let mockLog: Mock;
  let mockError: Mock;
  let mockWarn: Mock;
  let command: Remove;

  beforeEach(async () => {
    // Create temp directories
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-remove-test-'));
    serverDir = path.join(tempDir, 'server');

    // Create server directory with wos.yaml and plugins
    await fs.mkdir(serverDir, { recursive: true });
    await fs.mkdir(path.join(serverDir, 'plugins', 'test-plugin'), { recursive: true });

    // Create plugin manifest
    await fs.writeFile(
      path.join(serverDir, 'plugins', 'test-plugin', 'wos-plugin.yaml'),
      `name: test-plugin
version: 1.0.0
runtime: node
entrypoint: ./dist/index.js
`
    );

    // Create wos.yaml with plugin registered
    await fs.writeFile(
      path.join(serverDir, 'wos.yaml'),
      `server:
  port: 8080
plugins:
  test-plugin:
    enabled: false
    version: 1.0.0
    source: ./my-plugin
    installedAt: "2026-02-20T00:00:00.000Z"
`
    );

    // Create mock command
    mockLog = vi.fn();
    mockError = vi.fn();
    mockWarn = vi.fn();
    command = Object.create(Remove.prototype);
    command.log = mockLog;
    command.error = mockError;
    command.warn = mockWarn;
    command.parse = vi.fn();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('basic removal', () => {
    it('should remove plugin directory', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { name: 'test-plugin' },
        flags: { directory: serverDir },
      });

      await command.run();

      const pluginPath = path.join(serverDir, 'plugins', 'test-plugin');
      const exists = await fs.access(pluginPath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it('should remove plugin from wos.yaml', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { name: 'test-plugin' },
        flags: { directory: serverDir },
      });

      await command.run();

      const content = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
      expect(content).not.toContain('test-plugin');
    });

    it('should show success message', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { name: 'test-plugin' },
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockLog).toHaveBeenCalledWith(
        expect.stringMatching(/removed|uninstalled/i)
      );
    });
  });

  describe('error handling', () => {
    it('should error if plugin not found', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { name: 'nonexistent-plugin' },
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
        args: { name: 'test-plugin' },
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/not initialized|wos\.yaml/i),
        expect.anything()
      );
    });
  });

  describe('running plugin handling', () => {
    it('should warn if plugin might be running', async () => {
      // Update wos.yaml to show plugin as enabled
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `server:
  port: 8080
plugins:
  test-plugin:
    enabled: true
    version: 1.0.0
    source: ./my-plugin
`
      );

      (command.parse as Mock).mockResolvedValue({
        args: { name: 'test-plugin' },
        flags: { directory: serverDir },
      });

      await command.run();

      // Should still remove but may warn
      const pluginPath = path.join(serverDir, 'plugins', 'test-plugin');
      const exists = await fs.access(pluginPath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });
  });

  describe('dependency checking', () => {
    it('should warn about dependents without --force', async () => {
      // Create another plugin that depends on test-plugin
      await fs.mkdir(path.join(serverDir, 'plugins', 'dependent-plugin'), { recursive: true });
      await fs.writeFile(
        path.join(serverDir, 'plugins', 'dependent-plugin', 'wos-plugin.yaml'),
        `name: dependent-plugin
version: 1.0.0
runtime: node
entrypoint: ./dist/index.js
dependencies:
  - test-plugin
`
      );

      // Update wos.yaml
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `server:
  port: 8080
plugins:
  test-plugin:
    enabled: false
    version: 1.0.0
    source: ./my-plugin
  dependent-plugin:
    enabled: false
    version: 1.0.0
    source: ./dependent-plugin
`
      );

      (command.parse as Mock).mockResolvedValue({
        args: { name: 'test-plugin' },
        flags: { directory: serverDir },
      });

      await command.run();

      // Should error requiring --force
      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/depend|force/i),
        expect.anything()
      );
    });

    it('should allow removal with --force when dependents exist', async () => {
      // Create dependent plugin
      await fs.mkdir(path.join(serverDir, 'plugins', 'dependent-plugin'), { recursive: true });
      await fs.writeFile(
        path.join(serverDir, 'plugins', 'dependent-plugin', 'wos-plugin.yaml'),
        `name: dependent-plugin
version: 1.0.0
runtime: node
entrypoint: ./dist/index.js
dependencies:
  - test-plugin
`
      );

      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `server:
  port: 8080
plugins:
  test-plugin:
    enabled: false
    version: 1.0.0
    source: ./my-plugin
  dependent-plugin:
    enabled: false
    version: 1.0.0
    source: ./dependent-plugin
`
      );

      (command.parse as Mock).mockResolvedValue({
        args: { name: 'test-plugin' },
        flags: { directory: serverDir, force: true },
      });

      await command.run();

      // Should proceed with removal
      const pluginPath = path.join(serverDir, 'plugins', 'test-plugin');
      const exists = await fs.access(pluginPath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });
  });

  describe('json output', () => {
    it('should output JSON when --json flag is used', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { name: 'test-plugin' },
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
      expect(parsed.status).toBe('removed');
      expect(parsed.plugin.name).toBe('test-plugin');
    });
  });

  describe('dry-run mode', () => {
    it('should not remove plugin with --dry-run', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { name: 'test-plugin' },
        flags: { directory: serverDir, 'dry-run': true },
      });

      await command.run();

      // Plugin should still exist
      const pluginPath = path.join(serverDir, 'plugins', 'test-plugin');
      const exists = await fs.access(pluginPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should show what would happen with --dry-run', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { name: 'test-plugin' },
        flags: { directory: serverDir, 'dry-run': true },
      });

      await command.run();

      expect(mockLog).toHaveBeenCalledWith(
        expect.stringMatching(/would|dry.?run/i)
      );
    });
  });

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(Remove.description).toMatch(/remove|uninstall.*plugin/i);
    });

    it('should have examples', () => {
      expect(Remove.examples).toBeDefined();
      expect(Remove.examples.length).toBeGreaterThan(0);
    });

    it('should require name argument', () => {
      expect(Remove.args.name.required).toBe(true);
    });

    it('should have --force flag', () => {
      expect(Remove.flags.force).toBeDefined();
    });

    it('should have --json flag', () => {
      expect(Remove.flags.json).toBeDefined();
    });

    it('should have --dry-run flag', () => {
      expect(Remove.flags['dry-run']).toBeDefined();
    });
  });
});
