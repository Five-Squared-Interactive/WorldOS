/**
 * Logs Command Tests
 *
 * Story 6.1: wos logs Command
 *
 * View plugin logs with filtering options.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import Logs from './logs.js';

describe('Logs Command', () => {
  let tempDir: string;
  let serverDir: string;
  let logsDir: string;
  let mockLog: Mock;
  let mockError: Mock;
  let command: Logs;

  beforeEach(async () => {
    // Create temp directories
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-logs-test-'));
    serverDir = path.join(tempDir, 'server');
    logsDir = path.join(serverDir, 'logs');

    await fs.mkdir(logsDir, { recursive: true });

    // Create wos.yaml
    await fs.writeFile(
      path.join(serverDir, 'wos.yaml'),
      `server:
  port: 8080
plugins:
  test-plugin:
    enabled: true
`
    );

    // Create mock command
    mockLog = vi.fn();
    mockError = vi.fn();
    command = Object.create(Logs.prototype);
    command.log = mockLog;
    command.error = mockError;
    command.parse = vi.fn();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('basic log viewing', () => {
    it('should display recent log entries', async () => {
      const now = Date.now();
      const logs = [
        JSON.stringify({ plugin: 'test-plugin', level: 'info', message: 'First message', timestamp: now }),
        JSON.stringify({ plugin: 'test-plugin', level: 'info', message: 'Second message', timestamp: now + 1 }),
      ].join('\n');

      await fs.writeFile(path.join(logsDir, 'test-plugin.log'), logs + '\n');

      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin' },
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('First message');
      expect(output).toContain('Second message');
    });

    it('should show timestamp and level', async () => {
      const timestamp = Date.now();
      const logs = JSON.stringify({
        plugin: 'test-plugin',
        level: 'error',
        message: 'Error occurred',
        timestamp,
      });

      await fs.writeFile(path.join(logsDir, 'test-plugin.log'), logs + '\n');

      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin' },
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output.toLowerCase()).toContain('error');
      expect(output).toContain('Error occurred');
    });

    it('should limit number of entries with --lines', async () => {
      const logs = [];
      for (let i = 0; i < 10; i++) {
        logs.push(JSON.stringify({
          plugin: 'test-plugin',
          level: 'info',
          message: `Message ${i}`,
          timestamp: Date.now() + i,
        }));
      }
      await fs.writeFile(path.join(logsDir, 'test-plugin.log'), logs.join('\n') + '\n');

      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin' },
        flags: { directory: serverDir, lines: 3 },
      });

      await command.run();

      // Should show only 3 most recent
      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('Message 9');
      expect(output).toContain('Message 8');
      expect(output).toContain('Message 7');
      expect(output).not.toContain('Message 6');
    });
  });

  describe('level filtering', () => {
    it('should filter by log level', async () => {
      const logs = [
        JSON.stringify({ plugin: 'test-plugin', level: 'info', message: 'Info message', timestamp: Date.now() }),
        JSON.stringify({ plugin: 'test-plugin', level: 'error', message: 'Error message', timestamp: Date.now() + 1 }),
        JSON.stringify({ plugin: 'test-plugin', level: 'warn', message: 'Warning message', timestamp: Date.now() + 2 }),
      ].join('\n');

      await fs.writeFile(path.join(logsDir, 'test-plugin.log'), logs + '\n');

      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin' },
        flags: { directory: serverDir, level: 'error' },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('Error message');
      expect(output).not.toContain('Info message');
      expect(output).not.toContain('Warning message');
    });

    it('should include higher severity levels', async () => {
      const logs = [
        JSON.stringify({ plugin: 'test-plugin', level: 'debug', message: 'Debug', timestamp: Date.now() }),
        JSON.stringify({ plugin: 'test-plugin', level: 'info', message: 'Info', timestamp: Date.now() + 1 }),
        JSON.stringify({ plugin: 'test-plugin', level: 'warn', message: 'Warning', timestamp: Date.now() + 2 }),
        JSON.stringify({ plugin: 'test-plugin', level: 'error', message: 'Error', timestamp: Date.now() + 3 }),
      ].join('\n');

      await fs.writeFile(path.join(logsDir, 'test-plugin.log'), logs + '\n');

      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin' },
        flags: { directory: serverDir, level: 'warn' },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('Warning');
      expect(output).toContain('Error');
      expect(output).not.toContain('Debug');
      expect(output).not.toContain('Info');
    });
  });

  describe('time filtering', () => {
    it('should filter by --since flag', async () => {
      const now = Date.now();
      const oneHourAgo = now - 3600000;
      const twoHoursAgo = now - 7200000;

      const logs = [
        JSON.stringify({ plugin: 'test-plugin', level: 'info', message: 'Old message', timestamp: twoHoursAgo }),
        JSON.stringify({ plugin: 'test-plugin', level: 'info', message: 'Recent message', timestamp: now }),
      ].join('\n');

      await fs.writeFile(path.join(logsDir, 'test-plugin.log'), logs + '\n');

      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin' },
        flags: { directory: serverDir, since: '1h' },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('Recent message');
      expect(output).not.toContain('Old message');
    });

    it('should parse various time formats', async () => {
      const now = Date.now();

      const logs = [
        JSON.stringify({ plugin: 'test-plugin', level: 'info', message: 'Now', timestamp: now }),
      ].join('\n');

      await fs.writeFile(path.join(logsDir, 'test-plugin.log'), logs + '\n');

      // Test 30m format
      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin' },
        flags: { directory: serverDir, since: '30m' },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('Now');
    });
  });

  describe('all plugins', () => {
    it('should show logs from all plugins with --all', async () => {
      // Ensure logs directory exists
      await fs.mkdir(logsDir, { recursive: true });

      await fs.writeFile(
        path.join(logsDir, 'plugin-a.log'),
        JSON.stringify({ plugin: 'plugin-a', level: 'info', message: 'From A', timestamp: Date.now() }) + '\n'
      );
      await fs.writeFile(
        path.join(logsDir, 'plugin-b.log'),
        JSON.stringify({ plugin: 'plugin-b', level: 'info', message: 'From B', timestamp: Date.now() + 1 }) + '\n'
      );

      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir, all: true, lines: 100 },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('From A');
      expect(output).toContain('From B');
    });

    it('should prefix logs with plugin name when --all', async () => {
      // Ensure logs directory exists
      await fs.mkdir(logsDir, { recursive: true });

      await fs.writeFile(
        path.join(logsDir, 'my-plugin.log'),
        JSON.stringify({ plugin: 'my-plugin', level: 'info', message: 'Test', timestamp: Date.now() }) + '\n'
      );

      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir, all: true, lines: 100 },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('my-plugin');
    });
  });

  describe('JSON output', () => {
    it('should output JSON with --json flag', async () => {
      const logs = JSON.stringify({
        plugin: 'test-plugin',
        level: 'info',
        message: 'Test message',
        timestamp: Date.now(),
      });

      await fs.writeFile(path.join(logsDir, 'test-plugin.log'), logs + '\n');

      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin' },
        flags: { directory: serverDir, json: true },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('');
      const parsed = JSON.parse(output);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].message).toBe('Test message');
    });
  });

  describe('error handling', () => {
    it('should show message when no logs exist', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { plugin: 'test-plugin' },
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toMatch(/no logs|empty/i);
    });

    it('should error if plugin not specified without --all', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/plugin.*required|specify.*plugin/i),
        expect.anything()
      );
    });
  });

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(Logs.description).toMatch(/log/i);
    });

    it('should have examples', () => {
      expect(Logs.examples).toBeDefined();
      expect(Logs.examples.length).toBeGreaterThan(0);
    });

    it('should have --level flag', () => {
      expect(Logs.flags.level).toBeDefined();
    });

    it('should have --follow flag', () => {
      expect(Logs.flags.follow).toBeDefined();
    });

    it('should have --since flag', () => {
      expect(Logs.flags.since).toBeDefined();
    });

    it('should have --all flag', () => {
      expect(Logs.flags.all).toBeDefined();
    });
  });
});
