/**
 * Upgrade Command Tests
 *
 * Story 4.7: wos upgrade Command
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import Upgrade from './upgrade.js';

describe('Upgrade Command', () => {
  let tempDir: string;
  let serverDir: string;
  let mockLog: Mock;
  let mockError: Mock;
  let mockWarn: Mock;
  let command: Upgrade;

  beforeEach(async () => {
    // Create temp directories
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-upgrade-test-'));
    serverDir = path.join(tempDir, 'server');

    // Create server directory with plugins
    await fs.mkdir(serverDir, { recursive: true });
    await fs.mkdir(path.join(serverDir, 'plugins', 'local-plugin'), { recursive: true });
    await fs.mkdir(path.join(serverDir, 'plugins', 'git-plugin'), { recursive: true });

    // Create plugin manifests
    await fs.writeFile(
      path.join(serverDir, 'plugins', 'local-plugin', 'wos-plugin.yaml'),
      `name: local-plugin
version: 1.0.0
runtime: node
entrypoint: ./dist/index.js
`
    );

    await fs.writeFile(
      path.join(serverDir, 'plugins', 'git-plugin', 'wos-plugin.yaml'),
      `name: git-plugin
version: 1.0.0
runtime: node
entrypoint: ./dist/index.js
`
    );

    // Create wos.yaml with plugins registered
    await fs.writeFile(
      path.join(serverDir, 'wos.yaml'),
      `server:
  port: 8080
plugins:
  local-plugin:
    enabled: true
    version: 1.0.0
    source: ./my-local-plugin
  git-plugin:
    enabled: true
    version: 1.0.0
    source: "github:user/git-plugin"
`
    );

    // Create mock command
    mockLog = vi.fn();
    mockError = vi.fn();
    mockWarn = vi.fn();
    command = Object.create(Upgrade.prototype);
    command.log = mockLog;
    command.error = mockError;
    command.warn = mockWarn;
    command.parse = vi.fn();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('local path plugins', () => {
    it('should show message for local path plugins', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { name: 'local-plugin' },
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toMatch(/local.*path|manual/i);
      expect(output).toMatch(/wos add.*--force/i);
    });
  });

  describe('check mode', () => {
    it('should show available updates with --check', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir, check: true },
      });

      await command.run();

      // Should not error
      expect(mockError).not.toHaveBeenCalled();
      // Should show status for plugins
      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toMatch(/local-plugin|git-plugin/i);
    });

    it('should not make changes with --check', async () => {
      const originalContent = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');

      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir, check: true },
      });

      await command.run();

      const newContent = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
      expect(newContent).toBe(originalContent);
    });
  });

  describe('upgrade all plugins', () => {
    it('should check all plugins when no name specified', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir, check: true },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('local-plugin');
      expect(output).toContain('git-plugin');
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
        args: { name: 'local-plugin' },
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/not initialized|wos\.yaml/i),
        expect.anything()
      );
    });
  });

  describe('json output', () => {
    it('should output JSON with --json flag', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir, json: true, check: true },
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
      expect(Array.isArray(parsed.plugins)).toBe(true);
    });
  });

  describe('source type detection', () => {
    it('should identify local source plugins', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { name: 'local-plugin' },
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

      const parsed = JSON.parse(jsonOutput);
      expect(parsed.sourceType).toBe('local');
    });

    it('should identify github source plugins', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { name: 'git-plugin' },
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

      const parsed = JSON.parse(jsonOutput);
      expect(parsed.sourceType).toBe('github');
    });
  });

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(Upgrade.description).toMatch(/upgrade|update.*plugin/i);
    });

    it('should have examples', () => {
      expect(Upgrade.examples).toBeDefined();
      expect(Upgrade.examples.length).toBeGreaterThan(0);
    });

    it('should have --check flag', () => {
      expect(Upgrade.flags.check).toBeDefined();
    });

    it('should have --json flag', () => {
      expect(Upgrade.flags.json).toBeDefined();
    });

    it('should have optional name argument', () => {
      expect(Upgrade.args.name.required).toBe(false);
    });
  });
});
