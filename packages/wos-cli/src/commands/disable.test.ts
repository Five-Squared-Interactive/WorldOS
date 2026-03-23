/**
 * Disable Command Tests
 *
 * Story 4.5: wos enable/disable Commands
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import Disable from './disable.js';

describe('Disable Command', () => {
  let tempDir: string;
  let serverDir: string;
  let mockLog: Mock;
  let mockError: Mock;
  let mockWarn: Mock;
  let command: Disable;

  beforeEach(async () => {
    // Create temp directories
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-disable-test-'));
    serverDir = path.join(tempDir, 'server');

    // Create server directory with plugin
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

    // Create wos.yaml with enabled plugin
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

    // Create mock command
    mockLog = vi.fn();
    mockError = vi.fn();
    mockWarn = vi.fn();
    command = Object.create(Disable.prototype);
    command.log = mockLog;
    command.error = mockError;
    command.warn = mockWarn;
    command.parse = vi.fn();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('disabling a plugin', () => {
    it('should mark plugin as disabled in wos.yaml', async () => {
      (command.parse as Mock).mockResolvedValue({
        argv: ['test-plugin'],
        flags: { directory: serverDir },
      });

      await command.run();

      const content = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
      // YAML library omits false values, so check for absence of enabled: true
      expect(content).not.toContain('enabled: true');
    });

    it('should show success message', async () => {
      (command.parse as Mock).mockResolvedValue({
        argv: ['test-plugin'],
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockLog).toHaveBeenCalledWith(
        expect.stringMatching(/disabled|test-plugin/i)
      );
    });

    it('should handle already disabled plugin', async () => {
      // Update wos.yaml to have disabled plugin
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `server:
  port: 8080
plugins:
  test-plugin:
    enabled: false
    version: 1.0.0
    source: ./test-plugin
`
      );

      (command.parse as Mock).mockResolvedValue({
        argv: ['test-plugin'],
        flags: { directory: serverDir },
      });

      await command.run();

      // Should succeed without error
      expect(mockError).not.toHaveBeenCalled();
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringMatching(/already|disabled/i)
      );
    });
  });

  describe('disabling multiple plugins', () => {
    beforeEach(async () => {
      // Create second plugin
      await fs.mkdir(path.join(serverDir, 'plugins', 'plugin-b'), { recursive: true });
      await fs.writeFile(
        path.join(serverDir, 'plugins', 'plugin-b', 'wos-plugin.yaml'),
        `name: plugin-b
version: 1.0.0
runtime: node
entrypoint: ./dist/index.js
`
      );

      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `server:
  port: 8080
plugins:
  test-plugin:
    enabled: true
    version: 1.0.0
    source: ./test-plugin
  plugin-b:
    enabled: true
    version: 1.0.0
    source: ./plugin-b
`
      );
    });

    it('should disable multiple plugins', async () => {
      (command.parse as Mock).mockResolvedValue({
        argv: ['test-plugin', 'plugin-b'],
        flags: { directory: serverDir },
      });

      await command.run();

      const content = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
      // YAML library omits false values, so check for absence of enabled: true
      expect(content).not.toContain('enabled: true');
    });
  });

  describe('error handling', () => {
    it('should error if plugin not found', async () => {
      (command.parse as Mock).mockResolvedValue({
        argv: ['nonexistent-plugin'],
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
        argv: ['test-plugin'],
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/not initialized|wos\.yaml/i),
        expect.anything()
      );
    });

    it('should error if no plugin name provided', async () => {
      (command.parse as Mock).mockResolvedValue({
        argv: [],
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/plugin.*name|required/i),
        expect.anything()
      );
    });
  });

  describe('json output', () => {
    it('should output JSON when --json flag is used', async () => {
      (command.parse as Mock).mockResolvedValue({
        argv: ['test-plugin'],
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
      expect(parsed.disabled).toContain('test-plugin');
    });
  });

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(Disable.description).toMatch(/disable.*plugin/i);
    });

    it('should have examples', () => {
      expect(Disable.examples).toBeDefined();
      expect(Disable.examples.length).toBeGreaterThan(0);
    });

    it('should accept multiple plugin arguments', () => {
      expect(Disable.strict).toBe(false);
    });

    it('should have --json flag', () => {
      expect(Disable.flags.json).toBeDefined();
    });
  });
});
