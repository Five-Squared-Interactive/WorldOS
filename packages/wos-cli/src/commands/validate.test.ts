/**
 * Validate Command Tests
 *
 * Story 4.7: Manifest Validation
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import Validate from './validate.js';

describe('Validate Command', () => {
  let tempDir: string;
  let pluginDir: string;
  let mockLog: Mock;
  let mockError: Mock;
  let mockWarn: Mock;
  let command: Validate;

  beforeEach(async () => {
    // Create temp directories
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-validate-test-'));
    pluginDir = path.join(tempDir, 'my-plugin');
    await fs.mkdir(pluginDir, { recursive: true });

    // Create mock command
    mockLog = vi.fn();
    mockError = vi.fn();
    mockWarn = vi.fn();
    command = Object.create(Validate.prototype);
    command.log = mockLog;
    command.error = mockError;
    command.warn = mockWarn;
    command.parse = vi.fn();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('valid manifest', () => {
    beforeEach(async () => {
      // Create valid manifest and entrypoint
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: my-plugin
version: 1.0.0
runtime: node
entrypoint: ./index.js
description: A test plugin
`
      );
      await fs.writeFile(path.join(pluginDir, 'index.js'), 'module.exports = {}');
    });

    it('should show success for valid manifest', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: pluginDir },
      });

      await command.run();

      expect(mockError).not.toHaveBeenCalled();
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringMatching(/valid|pass|success/i)
      );
    });

    it('should output JSON with --json flag', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: pluginDir, json: true },
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
      expect(parsed.valid).toBe(true);
    });
  });

  describe('invalid manifest', () => {
    it('should show errors for missing required fields', async () => {
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: my-plugin
`
      );

      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: pluginDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toMatch(/version|runtime|entrypoint/i);
      expect(output).toMatch(/required|missing/i);
    });

    it('should show error for invalid runtime', async () => {
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: my-plugin
version: 1.0.0
runtime: invalid
entrypoint: ./index.js
`
      );

      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: pluginDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toMatch(/runtime/i);
      expect(output).toMatch(/invalid|node|python|binary|docker/i);
    });

    it('should show error for missing entrypoint file', async () => {
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: my-plugin
version: 1.0.0
runtime: node
entrypoint: ./nonexistent.js
`
      );

      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: pluginDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toMatch(/entrypoint/i);
      expect(output).toMatch(/not found|does not exist/i);
    });

    it('should collect all errors', async () => {
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `invalid: true
`
      );

      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: pluginDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      // Should mention multiple missing fields
      expect(output).toMatch(/name/i);
      expect(output).toMatch(/version/i);
    });
  });

  describe('error handling', () => {
    it('should error if no manifest found', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: pluginDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/not found|wos-plugin\.yaml/i),
        expect.anything()
      );
    });

    it('should error if manifest is invalid YAML', async () => {
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `invalid: yaml: content: [broken`
      );

      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: pluginDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/invalid|yaml|parse/i),
        expect.anything()
      );
    });
  });

  describe('warnings', () => {
    it('should show warnings for non-semver versions', async () => {
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        `name: my-plugin
version: latest
runtime: node
entrypoint: ./index.js
`
      );
      await fs.writeFile(path.join(pluginDir, 'index.js'), 'module.exports = {}');

      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: pluginDir },
      });

      await command.run();

      // Should pass but with warning
      expect(mockError).not.toHaveBeenCalled();
      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toMatch(/warning|semver/i);
    });
  });

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(Validate.description).toMatch(/validate.*manifest|plugin/i);
    });

    it('should have examples', () => {
      expect(Validate.examples).toBeDefined();
      expect(Validate.examples.length).toBeGreaterThan(0);
    });

    it('should have --json flag', () => {
      expect(Validate.flags.json).toBeDefined();
    });

    it('should have --directory flag', () => {
      expect(Validate.flags.directory).toBeDefined();
    });
  });
});
