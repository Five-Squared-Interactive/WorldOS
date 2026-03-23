/**
 * Stop Command
 *
 * Story 3.3: `wos stop` Command
 *
 * Stops the WorldOS server gracefully.
 */

import { Command, Flags, Args } from '@oclif/core';
import * as path from 'path';
import { readPidFile, removePidFile, isServerRunning } from './start.js';

/**
 * Stop options
 */
export interface StopOptions {
  serverDir: string;
  force?: boolean;
  timeout?: number;
}

/**
 * Send signal to process
 */
export function sendSignal(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for process to exit
 */
export async function waitForExit(
  pid: number,
  timeoutMs: number
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      process.kill(pid, 0);
      // Process still running, wait
      await new Promise(r => setTimeout(r, 100));
    } catch {
      // Process exited
      return true;
    }
  }

  return false;
}

/**
 * Stop server gracefully
 */
export async function stopServer(options: StopOptions): Promise<{
  success: boolean;
  pid?: number;
  error?: string;
  forced?: boolean;
}> {
  const { serverDir, force = false, timeout = 10000 } = options;

  // Check if server is running
  const running = await isServerRunning(serverDir);
  if (!running) {
    return { success: false, error: 'Server is not running' };
  }

  const pid = await readPidFile(serverDir);
  if (pid === null) {
    return { success: false, error: 'Could not read PID file' };
  }

  // Send SIGTERM for graceful shutdown
  const sent = sendSignal(pid, 'SIGTERM');
  if (!sent) {
    await removePidFile(serverDir);
    return { success: false, pid, error: 'Failed to send stop signal' };
  }

  // Wait for process to exit
  const exited = await waitForExit(pid, timeout);

  if (exited) {
    await removePidFile(serverDir);
    return { success: true, pid };
  }

  // Process didn't exit gracefully
  if (force) {
    // Force kill
    sendSignal(pid, 'SIGKILL');
    await new Promise(r => setTimeout(r, 500));
    await removePidFile(serverDir);
    return { success: true, pid, forced: true };
  }

  return {
    success: false,
    pid,
    error: `Server did not stop within ${timeout}ms. Use --force to kill.`,
  };
}

export default class Stop extends Command {
  static override description = 'Stop the WorldOS server gracefully';

  static override examples = [
    '<%= config.bin %> stop',
    '<%= config.bin %> stop --force',
    '<%= config.bin %> stop --timeout 30000',
    '<%= config.bin %> stop ./my-server',
  ];

  static override flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Force kill if graceful shutdown fails',
      default: false,
    }),
    timeout: Flags.integer({
      char: 't',
      description: 'Timeout in milliseconds for graceful shutdown',
      default: 10000,
    }),
    json: Flags.boolean({
      description: 'Output in JSON format',
      default: false,
    }),
  };

  static override args = {
    directory: Args.string({
      description: 'Server directory (defaults to current directory)',
      required: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Stop);

    const serverDir = args.directory
      ? path.resolve(args.directory)
      : process.cwd();

    const result = await stopServer({
      serverDir,
      force: flags.force,
      timeout: flags.timeout,
    });

    if (flags.json) {
      this.log(JSON.stringify(result));
    } else {
      if (result.success) {
        if (result.forced) {
          this.log(`Server forcefully stopped (PID: ${result.pid})`);
        } else {
          this.log(`Server stopped gracefully (PID: ${result.pid})`);
        }
      } else {
        this.error(result.error ?? 'Failed to stop server');
      }
    }
  }
}
