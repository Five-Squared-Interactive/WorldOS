/**
 * Webhook Command Tests
 *
 * Story 6.4: Webhook Notifications
 *
 * Test and manage webhook configurations.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import Webhook from './webhook.js';

describe('Webhook Command', () => {
  let tempDir: string;
  let serverDir: string;
  let mockLog: Mock;
  let mockError: Mock;
  let command: Webhook;

  beforeEach(async () => {
    // Create temp directories
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-webhook-test-'));
    serverDir = path.join(tempDir, 'server');

    await fs.mkdir(serverDir, { recursive: true });

    // Create mock command
    mockLog = vi.fn();
    mockError = vi.fn();
    command = Object.create(Webhook.prototype);
    command.log = mockLog;
    command.error = mockError;
    command.parse = vi.fn();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('webhook list', () => {
    it('should list configured webhooks', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `server:
  port: 8080
webhooks:
  - url: https://example.com/hook1
    events: [plugin.crashed]
  - url: https://example.com/hook2
    events: [plugin.unhealthy, plugin.recovered]
`
      );

      (command.parse as Mock).mockResolvedValue({
        args: { action: 'list' },
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('https://example.com/hook1');
      expect(output).toContain('https://example.com/hook2');
      expect(output).toContain('plugin.crashed');
    });

    it('should show message when no webhooks configured', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `server:
  port: 8080
`
      );

      (command.parse as Mock).mockResolvedValue({
        args: { action: 'list' },
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toMatch(/no webhooks|none configured/i);
    });

    it('should output JSON with --json flag', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `server:
  port: 8080
webhooks:
  - url: https://example.com/hook
    events: [plugin.crashed]
`
      );

      (command.parse as Mock).mockResolvedValue({
        args: { action: 'list' },
        flags: { directory: serverDir, json: true },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('');
      const parsed = JSON.parse(output);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].url).toBe('https://example.com/hook');
    });
  });

  describe('webhook test', () => {
    it('should show usage when URL not provided', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `server:
  port: 8080
`
      );

      (command.parse as Mock).mockResolvedValue({
        args: { action: 'test' },
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/url.*required/i),
        expect.anything()
      );
    });
  });

  describe('webhook events', () => {
    it('should list available event types', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `server:
  port: 8080
`
      );

      (command.parse as Mock).mockResolvedValue({
        args: { action: 'events' },
        flags: { directory: serverDir },
      });

      await command.run();

      const output = mockLog.mock.calls.flat().join('\n');
      expect(output).toContain('plugin.crashed');
      expect(output).toContain('plugin.unhealthy');
      expect(output).toContain('plugin.recovered');
      expect(output).toContain('server.started');
    });
  });

  describe('error handling', () => {
    it('should error if server not initialized', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { action: 'list' },
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/not initialized|wos\.yaml/i),
        expect.anything()
      );
    });

    it('should error for unknown action', async () => {
      await fs.writeFile(
        path.join(serverDir, 'wos.yaml'),
        `server:
  port: 8080
`
      );

      (command.parse as Mock).mockResolvedValue({
        args: { action: 'unknown' },
        flags: { directory: serverDir },
      });

      await command.run();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringMatching(/unknown.*action|invalid/i),
        expect.anything()
      );
    });
  });

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(Webhook.description).toMatch(/webhook/i);
    });

    it('should have examples', () => {
      expect(Webhook.examples).toBeDefined();
      expect(Webhook.examples.length).toBeGreaterThan(0);
    });

    it('should have action argument', () => {
      expect(Webhook.args.action).toBeDefined();
    });

    it('should have --json flag', () => {
      expect(Webhook.flags.json).toBeDefined();
    });
  });
});
