/**
 * Completion Command Tests
 *
 * Story 3.10: Shell Completion
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import Completion from './completion.js';

describe('Completion Command', () => {
  let mockLog: Mock;
  let mockError: Mock;
  let command: Completion;

  beforeEach(() => {
    mockLog = vi.fn();
    mockError = vi.fn();

    // Create command with mocked methods
    command = Object.create(Completion.prototype);
    command.log = mockLog;
    command.error = mockError;
    command.parse = vi.fn();
  });

  describe('bash completion', () => {
    it('should generate valid bash completion script', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { shell: 'bash' },
        flags: {},
      });

      await command.run();

      expect(mockLog).toHaveBeenCalledTimes(1);
      const script = mockLog.mock.calls[0][0];
      expect(script).toContain('_wos_completions');
      expect(script).toContain('complete -F _wos_completions wos');
      expect(script).toContain('init start stop restart status');
    });

    it('should include command-specific flags for bash', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { shell: 'bash' },
        flags: {},
      });

      await command.run();

      const script = mockLog.mock.calls[0][0];
      expect(script).toContain('--directory');
      expect(script).toContain('--foreground');
      expect(script).toContain('--force');
      expect(script).toContain('--json');
    });
  });

  describe('zsh completion', () => {
    it('should generate valid zsh completion script', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { shell: 'zsh' },
        flags: {},
      });

      await command.run();

      expect(mockLog).toHaveBeenCalledTimes(1);
      const script = mockLog.mock.calls[0][0];
      expect(script).toContain('#compdef wos');
      expect(script).toContain('_wos()');
      expect(script).toContain('_values "wos command"');
    });

    it('should include command descriptions for zsh', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { shell: 'zsh' },
        flags: {},
      });

      await command.run();

      const script = mockLog.mock.calls[0][0];
      expect(script).toContain('Initialize a new WorldOS server');
      expect(script).toContain('Start the WorldOS server');
      expect(script).toContain('Stop the WorldOS server');
    });

    it('should include flag descriptions for zsh', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { shell: 'zsh' },
        flags: {},
      });

      await command.run();

      const script = mockLog.mock.calls[0][0];
      expect(script).toContain('Server directory');
      expect(script).toContain('Run in foreground');
    });
  });

  describe('powershell completion', () => {
    it('should generate valid PowerShell completion script', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { shell: 'powershell' },
        flags: {},
      });

      await command.run();

      expect(mockLog).toHaveBeenCalledTimes(1);
      const script = mockLog.mock.calls[0][0];
      expect(script).toContain('Register-ArgumentCompleter');
      expect(script).toContain('-CommandName wos');
      expect(script).toContain('CompletionResult');
    });

    it('should include commands with descriptions for PowerShell', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { shell: 'powershell' },
        flags: {},
      });

      await command.run();

      const script = mockLog.mock.calls[0][0];
      expect(script).toContain("'init'");
      expect(script).toContain("'start'");
      expect(script).toContain("'stop'");
      expect(script).toContain('Initialize a new WorldOS server');
    });
  });

  describe('fish completion', () => {
    it('should generate valid Fish completion script', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { shell: 'fish' },
        flags: {},
      });

      await command.run();

      expect(mockLog).toHaveBeenCalledTimes(1);
      const script = mockLog.mock.calls[0][0];
      expect(script).toContain('complete -c wos');
      expect(script).toContain('__fish_use_subcommand');
      expect(script).toContain('__fish_seen_subcommand_from');
    });

    it('should include command descriptions for Fish', async () => {
      (command.parse as Mock).mockResolvedValue({
        args: { shell: 'fish' },
        flags: {},
      });

      await command.run();

      const script = mockLog.mock.calls[0][0];
      expect(script).toContain('-d \'Initialize a new WorldOS server\'');
      expect(script).toContain('-d \'Start the WorldOS server\'');
    });
  });

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(Completion.description).toBe('Generate shell completion scripts');
    });

    it('should have examples', () => {
      expect(Completion.examples).toBeDefined();
      expect(Completion.examples.length).toBeGreaterThan(0);
    });

    it('should require shell argument', () => {
      expect(Completion.args.shell.required).toBe(true);
    });

    it('should accept bash, zsh, powershell, and fish', () => {
      expect(Completion.args.shell.options).toContain('bash');
      expect(Completion.args.shell.options).toContain('zsh');
      expect(Completion.args.shell.options).toContain('powershell');
      expect(Completion.args.shell.options).toContain('fish');
    });
  });
});
