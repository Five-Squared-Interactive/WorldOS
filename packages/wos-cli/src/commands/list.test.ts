/**
 * List Command Tests
 *
 * Story 4.4: wos list Command
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import List from './list.js';

describe('List Command', () => {
  let tempDir: string;
  let serverDir: string;
  let mockLog: Mock;
  let mockError: Mock;
  let command: List;

  beforeEach(async () => {
    // Create temp directories
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-list-test-'));
    serverDir = path.join(tempDir, 'server');

    // Create server directory
    await fs.mkdir(serverDir, { recursive: true });
    await fs.mkdir(path.join(serverDir, 'plugins'), { recursive: true });

    // Create mock command
    mockLog = vi.fn();
    mockError = vi.fn();
    command = Object.create(List.prototype);
    command.log = mockLog;
    command.error = mockError;
    command.parse = vi.fn();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('with plugins installed', () => {
    beforeEach(async () => {
      // Create plugin directories with manifests
      await fs.mkdir(path.join(serverDir, 'plugins', 'plugin-a'), { recursive: true });
      await fs.writeFile(
        path.join(serverDir, 'plugins', 'plugin-a', 'wos-plugin.yaml'),
        `name: plugin-a
version: 1.0.0
runtime: node
entrypoint: ./dist/index.js
description: First test plugin
`
      );

      await fs.mkdir(path.join(serverDir, 'plugins', 'plugin-b'), { recursive: true });
      await fs.writeFile(
        path.join(serverDir, 'plugins', 'plugin-b', 'wos-plugin.yaml'),
        `name: plugin-b
version: 2.0.0
runtime: node
entrypoint: ./dist/index.js
description: Second test plugin
`
      );

      // Create wos.yaml with plugins registered
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `server:
  port: 8080
plugins:
  plugin-a:
    enabled: true
    version: 1.0.0
    source: ./plugin-a
  plugin-b:
    enabled: false
    version: 2.0.0
    source: ./plugin-b
`
      );
    });

    it('should list all installed plugins', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('plugin-a');
      expect(output).toContain('plugin-b');
    });

    it('should show plugin versions', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('1.0.0');
      expect(output).toContain('2.0.0');
    });

    it('should show enabled/disabled status', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toMatch(/enabled|disabled/i);
    });

    it('should output JSON with --json flag', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
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
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(2);
      expect(parsed.find((p: { name: string }) => p.name === 'plugin-a')).toBeDefined();
      expect(parsed.find((p: { name: string }) => p.name === 'plugin-b')).toBeDefined();
    });

    it('should filter by --enabled flag', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir, enabled: true },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('plugin-a');
      expect(output).not.toContain('plugin-b');
    });

    it('should filter by --disabled flag', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir, disabled: true },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).not.toContain('plugin-a');
      expect(output).toContain('plugin-b');
    });
  });

  describe('with no plugins installed', () => {
    beforeEach(async () => {
      // Create wos.yaml without plugins
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `server:
  port: 8080
`
      );
    });

    it('should show "No plugins installed" message', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toMatch(/no plugins|empty/i);
    });

    it('should suggest wos add command', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toMatch(/wos add/i);
    });

    it('should output empty JSON array with --json flag', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
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
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should error if server not initialized', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/not initialized|wos\.yaml/i),
        expect.anything()
      );
    });
  });

  describe('table formatting', () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(serverDir, 'plugins', 'test-plugin'), { recursive: true });
      await fs.writeFile(
        path.join(serverDir, 'plugins', 'test-plugin', 'wos-plugin.yaml'),
        `name: test-plugin
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
`
      );
    });

    it('should include column headers', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toMatch(/name|plugin/i);
      expect(output).toMatch(/version/i);
      expect(output).toMatch(/status|enabled/i);
    });
  });

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(List.description).toMatch(/list.*plugin/i);
    });

    it('should have examples', () => {
      expect(List.examples).toBeDefined();
      expect(List.examples.length).toBeGreaterThan(0);
    });

    it('should have --json flag', () => {
      expect(List.flags.json).toBeDefined();
    });

    it('should have --enabled flag', () => {
      expect(List.flags.enabled).toBeDefined();
    });

    it('should have --disabled flag', () => {
      expect(List.flags.disabled).toBeDefined();
    });
  });
});
