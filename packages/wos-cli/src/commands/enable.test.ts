/**
 * Enable Command Tests
 *
 * Story 4.5: wos enable/disable Commands
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import Enable from './enable.js';

describe('Enable Command', () => {
  let tempDir: string;
  let serverDir: string;
  let mockLog: Mock;
  let mockError: Mock;
  let command: Enable;

  beforeEach(async () => {
    // Create temp directories
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-enable-test-'));
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

    // Create wos.yaml with disabled plugin
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

    // Create mock command
    mockLog = vi.fn();
    mockError = vi.fn();
    command = Object.create(Enable.prototype);
    command.log = mockLog;
    command.error = mockError;
    command.parse = vi.fn();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('enabling a plugin', () => {
    it('should mark plugin as enabled in wos.yaml', async () => {
      (command.parse as Mock).mockResolvedValue({
        argv: ['test-plugin'],
        flags: { directory: serverDir },
      });

      await command.run();

      const content = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
      expect(content).toContain('enabled: true');
    });

    it('should show success message', async () => {
      (command.parse as Mock).mockResolvedValue({
        argv: ['test-plugin'],
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockLog).toHaveBeenCalledWith(
        expect.stringMatching(/enabled|test-plugin/i)
      );
    });

    it('should handle already enabled plugin', async () => {
      // Update wos.yaml to have enabled plugin
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
        argv: ['test-plugin'],
        flags: { directory: serverDir },
      });

      await command.run();

      // Should succeed without error
      expect(mockError).not.toHaveBeenCalled();
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringMatching(/already|enabled/i)
      );
    });
  });

  describe('enabling multiple plugins', () => {
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
    enabled: false
    version: 1.0.0
    source: ./test-plugin
  plugin-b:
    enabled: false
    version: 1.0.0
    source: ./plugin-b
`
      );
    });

    it('should enable multiple plugins', async () => {
      (command.parse as Mock).mockResolvedValue({
        argv: ['test-plugin', 'plugin-b'],
        flags: { directory: serverDir },
      });

      await command.run();

      const content = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
      // Both plugins should be enabled (check for 2 occurrences)
      const enabledMatches = content.match(/enabled: true/g);
      expect(enabledMatches).not.toBeNull();
      expect(enabledMatches!.length).toBe(2);
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
      expect(parsed.enabled).toContain('test-plugin');
    });
  });

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(Enable.description).toMatch(/enable.*plugin/i);
    });

    it('should have examples', () => {
      expect(Enable.examples).toBeDefined();
      expect(Enable.examples.length).toBeGreaterThan(0);
    });

    it('should accept multiple plugin arguments', () => {
      expect(Enable.strict).toBe(false);
    });

    it('should have --json flag', () => {
      expect(Enable.flags.json).toBeDefined();
    });
  });
});
