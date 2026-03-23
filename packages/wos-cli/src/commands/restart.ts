/**
 * Restart Command
 *
 * Story 3.4: `wos restart` Command
 *
 * Restarts the WorldOS server or individual plugins.
 */

import { Command, Flags, Args } from '@oclif/core';
import * as path from 'path';
import { isServerRunning, readPidFile } from './start.js';
import { stopServer } from './stop.js';

/**
 * Restart options
 */
export interface RestartOptions {
  serverDir: string;
  plugin?: string;
  force?: boolean;
  timeout?: number;
}

/**
 * Restart the server (stop + start)
 */
export async function restartServer(
  options: RestartOptions,
  startFn: () => Promise<void>
): Promise<{
  success: boolean;
  error?: string;
  stopped?: boolean;
  started?: boolean;
}> {
  const { serverDir, force = false, timeout = 10000 } = options;

  // Check if server is running
  const running = await isServerRunning(serverDir);

  if (running) {
    // Stop the server
    const stopResult = await stopServer({ serverDir, force, timeout });
    if (!stopResult.success) {
      return {
        success: false,
        error: `Failed to stop server: ${stopResult.error}`,
        stopped: false,
      };
    }
  }

  // Start the server
  try {
    await startFn();
    return {
      success: true,
      stopped: running,
      started: true,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to start server: ${(error as Error).message}`,
      stopped: running,
      started: false,
    };
  }
}

export default class Restart extends Command {
  static override description = 'Restart the WorldOS server or a specific plugin';

  static override examples = [
    '<%= config.bin %> restart',
    '<%= config.bin %> restart --plugin my-plugin',
    '<%= config.bin %> restart --force',
    '<%= config.bin %> restart ./my-server',
  ];

  static override flags = {
    plugin: Flags.string({
      char: 'p',
      description: 'Restart only a specific plugin',
    }),
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
    const { args, flags } = await this.parse(Restart);

    const serverDir = args.directory
      ? path.resolve(args.directory)
      : process.cwd();

    if (flags.plugin) {
      await this.restartPlugin(serverDir, flags.plugin, flags);
    } else {
      await this.restartServer(serverDir, flags);
    }
  }

  private async restartServer(
    serverDir: string,
    flags: { force?: boolean; timeout?: number; json?: boolean }
  ): Promise<void> {
    const running = await isServerRunning(serverDir);

    if (!flags.json) {
      if (running) {
        this.log('Stopping server...');
      }
    }

    // Stop if running
    if (running) {
      const stopResult = await stopServer({
        serverDir,
        force: flags.force,
        timeout: flags.timeout,
      });

      if (!stopResult.success) {
        if (flags.json) {
          this.log(JSON.stringify({
            success: false,
            error: `Failed to stop server: ${stopResult.error}`,
          }));
        } else {
          this.error(`Failed to stop server: ${stopResult.error}`);
        }
        return;
      }
    }

    // Start the server
    if (!flags.json) {
      this.log('Starting server...');
    }

    // Spawn the start command
    const { spawn } = await import('child_process');
    const cliPath = process.argv[1];

    const child = spawn(process.execPath, [cliPath, 'start', serverDir], {
      detached: true,
      stdio: 'ignore',
      cwd: serverDir,
    });

    child.unref();

    // Wait a moment for the process to start
    await new Promise(r => setTimeout(r, 500));

    const newPid = await readPidFile(serverDir);

    if (flags.json) {
      this.log(JSON.stringify({
        success: true,
        action: running ? 'restarted' : 'started',
        pid: newPid,
      }));
    } else {
      if (running) {
        this.log(`Server restarted (PID: ${newPid})`);
      } else {
        this.log(`Server started (PID: ${newPid})`);
      }
    }
  }

  private async restartPlugin(
    serverDir: string,
    pluginName: string,
    flags: { json?: boolean }
  ): Promise<void> {
    const running = await isServerRunning(serverDir);

    if (!running) {
      if (flags.json) {
        this.log(JSON.stringify({
          success: false,
          error: 'Server is not running',
        }));
      } else {
        this.error('Server is not running. Start the server first.');
      }
      return;
    }

    // Connect to the server via MQTT and send restart command
    // For now, we'll use a simpler approach via the status endpoint

    if (!flags.json) {
      this.log(`Restarting plugin: ${pluginName}...`);
    }

    try {
      // Dynamic import — mqtt is provided by wos-server at runtime
      // @ts-expect-error - mqtt resolved at runtime when wos-server is installed
      const mqtt = await import('mqtt');

      const client = mqtt.connect('mqtt://localhost:1883');

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.end();
          reject(new Error('Connection timeout'));
        }, 5000);

        client.on('connect', async () => {
          clearTimeout(timeout);

          // Send restart command
          const topic = `wos/server/command`;
          const message = JSON.stringify({
            action: 'restart-plugin',
            plugin: pluginName,
          });

          client.publish(topic, message, (error: Error | undefined) => {
            client.end();
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });

        client.on('error', (error: Error) => {
          clearTimeout(timeout);
          client.end();
          reject(error);
        });
      });

      if (flags.json) {
        this.log(JSON.stringify({
          success: true,
          plugin: pluginName,
          action: 'restart-requested',
        }));
      } else {
        this.log(`Restart requested for plugin: ${pluginName}`);
      }
    } catch (error) {
      if (flags.json) {
        this.log(JSON.stringify({
          success: false,
          error: (error as Error).message,
        }));
      } else {
        this.error(`Failed to restart plugin: ${(error as Error).message}`);
      }
    }
  }
}
