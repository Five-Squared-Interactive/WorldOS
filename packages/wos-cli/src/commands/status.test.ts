/**
 * Status Command Tests
 *
 * Story 3.6: wos status Command
 * Story 6.3: Real-time Health Dashboard
 *
 * Displays the server and plugin status.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import Status from './status.js';

describe('Status Command', () => {
  let tempDir: string;
  let serverDir: string;
  let mockLog: Mock;
  let mockError: Mock;
  let command: Status;

  beforeEach(async () => {
    // Create temp directories
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-status-test-'));
    serverDir = path.join(tempDir, 'server');

    await fs.mkdir(serverDir, { recursive: true });

    // Create mock command
    mockLog = vi.fn();
    mockError = vi.fn();
    command = Object.create(Status.prototype);
    command.log = mockLog;
    command.error = mockError;
    command.parse = vi.fn();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('basic status', () => {
    it('should show server stopped when no PID file', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `server:
  port: 8080
`
      );

      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('Stopped');
    });

    it('should show configuration details', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `server:
  port: 3000
  host: localhost
`
      );

      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('3000');
    });

    it('should show plugins list', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `server:
  port: 8080
plugins:
  test-plugin:
    enabled: true
  another-plugin:
    enabled: false
`
      );

      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('test-plugin');
    });
  });

  describe('JSON output', () => {
    it('should output JSON with --json flag', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `server:
  port: 8080
`
      );

      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir, json: true },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('');
      const parsed = JSON.parse(output);

      expect(parsed.server).toBeDefined();
      expect(parsed.server.status).toBe('stopped');
    });
  });

  describe('not initialized', () => {
    it('should show not initialized when no wos.yaml', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: {},
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toMatch(/not initialized/i);
    });
  });

  describe('watch mode', () => {
    it('should have --watch flag', () => {
      expect(Status.flags.watch).toBeDefined();
    });

    it('should have --interval flag', () => {
      expect(Status.flags.interval).toBeDefined();
    });
  });

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(Status.description).toMatch(/status/i);
    });

    it('should have examples', () => {
      expect(Status.examples).toBeDefined();
      expect(Status.examples.length).toBeGreaterThan(0);
    });

    it('should have --json flag', () => {
      expect(Status.flags.json).toBeDefined();
    });

    it('should have --directory flag', () => {
      expect(Status.flags.directory).toBeDefined();
    });
  });
});
