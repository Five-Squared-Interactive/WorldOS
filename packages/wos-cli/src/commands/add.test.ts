/**
 * Add Command Tests
 *
 * Story 4.1: wos add from Local Path
 * Story 4.2: wos add from GitHub/Git/npm
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import Add from './add.js';

describe('Add Command', () => {
  let tempDir: string;
  let serverDir: string;
  let pluginDir: string;
  let mockLog: Mock;
  let mockError: Mock;
  let command: Add;

  beforeEach(async () => {
    // Create temp directories
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-add-test-'));
    serverDir = path.join(tempDir, 'server');
    pluginDir = path.join(tempDir, 'my-plugin');

    // Create server directory with wos.yaml
    await fs.mkdir(serverDir, { recursive: true });
    await fs.mkdir(path.join(serverDir, 'plugins'), { recursive: true });
    await fs.writeFile(
      path.join(serverDir, 'wos.yaml'),
      'server:\n  port: 8080\n'
    );

    // Create plugin directory with manifest
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginDir, 'wos-plugin.yaml'),
      `name: test-plugin
version: 1.0.0
runtime: node
entrypoint: ./dist/index.js
description: A test plugin
`
    );

    // Create mock command
    mockLog = vi.fn();
    mockError = vi.fn();
    command = Object.create(Add.prototype);
    command.log = mockLog;
    command.error = mockError;
    command.parse = vi.fn();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('local path installation', () => {
    it('should install plugin from local path', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { source: pluginDir },
        flags: { directory: serverDir },
      });

      await command.run();

      // Check plugin was copied
      const installedPath = path.join(serverDir, 'plugins', 'test-plugin');
      const exists = await fs.access(installedPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should validate manifest before installation', async () => {
      // Create invalid manifest (missing required fields)
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        'name: test-plugin\n'
      );

      (command.parse as Mock).mockResolvedValue({
        args: { source: pluginDir },
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/invalid|missing|required/i),
        expect.anything()
      );
    });

    it('should register plugin in wos.yaml', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { source: pluginDir },
        flags: { directory: serverDir },
      });

      await command.run();

      const content = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
      expect(content).toContain('test-plugin');
    });

    it('should show success message with name and version', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { source: pluginDir },
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockLog).toHaveBeenCalledWith(
        expect.stringMatching(/test-plugin.*1\.0\.0|installed/i)
      );
    });
  });

  describe('duplicate handling', () => {
    it('should reject duplicate plugin without --force', async () => {
      // Install first time
      (command.parse as Mock).mockResolvedValue({
        args: { source: pluginDir },
        flags: { directory: serverDir },
      });
      await command.run();

      // Try to install again
      mockError.mockClear();
      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/already.*installed/i),
        expect.anything()
      );
    });

    it('should allow overwrite with --force', async () => {
      // Install first time
      (command.parse as Mock).mockResolvedValue({
        args: { source: pluginDir },
        flags: { directory: serverDir },
      });
      await command.run();

      // Install again with force
      (command.parse as Mock).mockResolvedValue({
        args: { source: pluginDir },
        flags: { directory: serverDir, force: true },
      });
      mockLog.mockClear();
      await command.run();

      expect(mockLog).toHaveBeenCalledWith(
        expect.stringMatching(/test-plugin|installed/i)
      );
    });
  });

  describe('enable flag', () => {
    it('should enable plugin with --enable flag', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { source: pluginDir },
        flags: { directory: serverDir, enable: true },
      });

      await command.run();

      const content = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
      expect(content).toContain('enabled: true');
    });

    it('should default to disabled without --enable', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { source: pluginDir },
        flags: { directory: serverDir },
      });

      await command.run();

      const content = await fs.readFile(path.join(serverDir, 'wos.yaml'), 'utf-8');
      // When disabled, yaml library may omit the field or set it to false
      expect(content).not.toContain('enabled: true');
    });
  });

  describe('dependency installation', () => {
    it('should detect package.json and note npm install needed', async () => {
      // Add package.json to plugin
      await fs.writeFile(
        path.join(pluginDir, 'package.json'),
        JSON.stringify({ name: 'test-plugin', dependencies: { lodash: '^4.0.0' } })
      );

      (command.parse as Mock).mockResolvedValue({
        args: { source: pluginDir },
        flags: { directory: serverDir },
      });

      await command.run();

      // Should mention dependencies
      const logCalls = mockLog.mock.calls.flat().join(' ');
      expect(logCalls).toMatch(/dependencies|npm|install/i);
    });
  });

  describe('error handling', () => {
    it('should error if source path does not exist', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { source: '/nonexistent/path' },
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/not found|does not exist/i),
        expect.anything()
      );
    });

    it('should error if no manifest found', async () => {
      // Remove manifest
      await fs.unlink(path.join(pluginDir, 'wos-plugin.yaml'));

      (command.parse as Mock).mockResolvedValue({
        args: { source: pluginDir },
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/manifest|wos-plugin\.yaml/i),
        expect.anything()
      );
    });

    it('should error if server not initialized', async () => {
      // Remove wos.yaml
      await fs.unlink(path.join(serverDir, 'wos.yaml'));

      (command.parse as Mock).mockResolvedValue({
        args: { source: pluginDir },
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/not initialized|wos\.yaml/i),
        expect.anything()
      );
    });
  });

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(Add.description).toMatch(/install|add.*plugin/i);
    });

    it('should have examples', () => {
      expect(Add.examples).toBeDefined();
      expect(Add.examples.length).toBeGreaterThan(0);
    });

    it('should require source argument', () => {
      expect(Add.args.source.required).toBe(true);
    });

    it('should have --force flag', () => {
      expect(Add.flags.force).toBeDefined();
    });

    it('should have --enable flag', () => {
      expect(Add.flags.enable).toBeDefined();
    });
  });

  describe('source type parsing', () => {
    // Access the private method via prototype
    const parseSourceType = (Add.prototype as any).parseSourceType.bind({});

    it('should parse local path', () => {
      const result = parseSourceType('./my-plugin');
      expect(result.type).toBe('local');
      expect(result.path).toBe('./my-plugin');
    });

    it('should parse absolute local path', () => {
      const result = parseSourceType('/usr/local/plugins/my-plugin');
      expect(result.type).toBe('local');
      expect(result.path).toBe('/usr/local/plugins/my-plugin');
    });

    it('should parse github:user/repo', () => {
      const result = parseSourceType('github:worldos/plugin-example');
      expect(result.type).toBe('github');
      expect(result.repo).toBe('worldos/plugin-example');
      expect(result.ref).toBeUndefined();
    });

    it('should parse github:user/repo#ref', () => {
      const result = parseSourceType('github:worldos/plugin-example#v1.0.0');
      expect(result.type).toBe('github');
      expect(result.repo).toBe('worldos/plugin-example');
      expect(result.ref).toBe('v1.0.0');
    });

    it('should parse github with branch ref', () => {
      const result = parseSourceType('github:worldos/plugin-example#main');
      expect(result.type).toBe('github');
      expect(result.ref).toBe('main');
    });

    it('should parse git:url', () => {
      const result = parseSourceType('git:https://github.com/worldos/plugin.git');
      expect(result.type).toBe('git');
      expect(result.url).toBe('https://github.com/worldos/plugin.git');
      expect(result.ref).toBeUndefined();
    });

    it('should parse git:url#ref', () => {
      const result = parseSourceType('git:https://github.com/worldos/plugin.git#v2.0.0');
      expect(result.type).toBe('git');
      expect(result.url).toBe('https://github.com/worldos/plugin.git');
      expect(result.ref).toBe('v2.0.0');
    });

    it('should parse npm:package', () => {
      const result = parseSourceType('npm:worldos-plugin-example');
      expect(result.type).toBe('npm');
      expect(result.package).toBe('worldos-plugin-example');
      expect(result.version).toBeUndefined();
    });

    it('should parse npm:package@version', () => {
      const result = parseSourceType('npm:worldos-plugin-example@1.2.3');
      expect(result.type).toBe('npm');
      expect(result.package).toBe('worldos-plugin-example');
      expect(result.version).toBe('1.2.3');
    });

    it('should parse npm:@scope/package', () => {
      const result = parseSourceType('npm:@worldos/plugin-example');
      expect(result.type).toBe('npm');
      expect(result.package).toBe('@worldos/plugin-example');
      expect(result.version).toBeUndefined();
    });

    it('should parse npm:@scope/package@version', () => {
      const result = parseSourceType('npm:@worldos/plugin-example@1.2.3');
      expect(result.type).toBe('npm');
      expect(result.package).toBe('@worldos/plugin-example');
      expect(result.version).toBe('1.2.3');
    });
  });
});
