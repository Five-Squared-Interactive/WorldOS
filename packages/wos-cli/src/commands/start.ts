/**
 * Start Command
 *
 * Story 3.2: `wos start` Command
 *
 * Starts the WorldOS server and all configured plugins.
 */

import { Command, Flags, Args } from '@oclif/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';

/**
 * Server start options
 */
export interface StartOptions {
  serverDir: string;
  foreground?: boolean;
  logLevel?: string;
}

/**
 * Load server configuration
 */
export async function loadServerConfig(serverDir: string): Promise<Record<string, unknown>> {
  const configPath = path.join(serverDir, 'wos.yaml');

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return yaml.parse(content) ?? {};
  } catch {
    throw new Error(`No wos.yaml found in ${serverDir}. Run 'wos init' first.`);
  }
}

/**
 * Get enabled plugins from config
 */
export function getEnabledPlugins(config: Record<string, unknown>): string[] {
  const plugins = config.plugins as Record<string, unknown> | undefined;
  if (!plugins) return [];

  return Object.entries(plugins)
    .filter(([, entry]) => {
      const pluginEntry = entry as Record<string, unknown>;
      return pluginEntry.enabled !== false;
    })
    .map(([name]) => name);
}

/**
 * Write PID file for daemon mode
 */
export async function writePidFile(serverDir: string, pid: number): Promise<void> {
  const pidPath = path.join(serverDir, '.wos.pid');
  await fs.writeFile(pidPath, pid.toString(), 'utf-8');
}

/**
 * Read PID file
 */
export async function readPidFile(serverDir: string): Promise<number | null> {
  const pidPath = path.join(serverDir, '.wos.pid');

  try {
    const content = await fs.readFile(pidPath, 'utf-8');
    const pid = parseInt(content.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Remove PID file
 */
export async function removePidFile(serverDir: string): Promise<void> {
  const pidPath = path.join(serverDir, '.wos.pid');

  try {
    await fs.unlink(pidPath);
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Check if server is already running
 */
export async function isServerRunning(serverDir: string): Promise<boolean> {
  const pid = await readPidFile(serverDir);
  if (pid === null) return false;

  try {
    // Check if process exists (signal 0 doesn't kill, just checks)
    process.kill(pid, 0);
    return true;
  } catch {
    // Process doesn't exist, clean up stale PID file
    await removePidFile(serverDir);
    return false;
  }
}

/**
 * Format a timestamp for console output: YYYY-MM-DD HH:MM:SS.mmm
 */
function ts(): string {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${y}-${mo}-${d} ${h}:${m}:${s}.${ms}`;
}

export default class Start extends Command {
  static override description = 'Start the WorldOS server and all configured plugins';

  static override examples = [
    '<%= config.bin %> start',
    '<%= config.bin %> start --foreground',
    '<%= config.bin %> start --log-level debug',
    '<%= config.bin %> start ./my-server',
  ];

  static override flags = {
    foreground: Flags.boolean({
      char: 'f',
      description: 'Run in foreground (do not daemonize)',
      default: false,
    }),
    'log-level': Flags.string({
      char: 'l',
      description: 'Log level (debug, info, warn, error)',
      options: ['debug', 'info', 'warn', 'error'],
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
    const { args, flags } = await this.parse(Start);

    const serverDir = args.directory
      ? path.resolve(args.directory)
      : process.cwd();

    // Check if wos.yaml exists
    try {
      await fs.access(path.join(serverDir, 'wos.yaml'));
    } catch {
      if (flags.json) {
        this.log(JSON.stringify({
          success: false,
          error: `No wos.yaml found in ${serverDir}. Run 'wos init' first.`,
        }));
      } else {
        this.error(`No wos.yaml found in ${serverDir}. Run 'wos init' first.`);
      }
      return;
    }

    // Check if already running
    const running = await isServerRunning(serverDir);
    if (running) {
      const pid = await readPidFile(serverDir);
      if (flags.json) {
        this.log(JSON.stringify({
          success: false,
          error: 'Server is already running',
          pid,
        }));
      } else {
        this.error(`Server is already running (PID: ${pid})`);
      }
      return;
    }

    try {
      // Load config
      const config = await loadServerConfig(serverDir);
      const enabledPlugins = getEnabledPlugins(config);

      if (flags.foreground) {
        // Run in foreground
        await this.runForeground(serverDir, config, enabledPlugins, flags);
      } else {
        // Run as daemon
        await this.runDaemon(serverDir, config, enabledPlugins, flags);
      }
    } catch (error) {
      if (flags.json) {
        this.log(JSON.stringify({
          success: false,
          error: (error as Error).message,
        }));
      } else {
        this.error((error as Error).message);
      }
    }
  }

  private async runForeground(
    serverDir: string,
    config: Record<string, unknown>,
    enabledPlugins: string[],
    flags: { json?: boolean; 'log-level'?: string }
  ): Promise<void> {
    // Write PID file
    await writePidFile(serverDir, process.pid);

    if (!flags.json) {
      this.log(`${ts()} [server] Starting WorldOS server in foreground mode...`);
      this.log(`${ts()} [server] Server directory: ${serverDir}`);
      this.log(`${ts()} [server] Enabled plugins: ${enabledPlugins.length > 0 ? enabledPlugins.join(', ') : '(none)'}`);
      this.log('');
      this.log(`${ts()} [server] Press Ctrl+C to stop the server.`);
      this.log('');
    }

    // Import and start the server
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let server: any = null;
    let shuttingDown = false;

    // Set up signal handlers — need access to `server` for graceful shutdown
    const cleanup = async () => {
      if (shuttingDown) return; // prevent double-shutdown
      shuttingDown = true;

      if (!flags.json) {
        this.log(`\n${ts()} [server] Shutting down...`);
      }

      // Gracefully stop the server (stops all plugins first)
      if (server) {
        try {
          await server.stop();
        } catch (err) {
          if (!flags.json) {
            this.log(`${ts()} [server] Error during shutdown: ${(err as Error).message}`);
          }
        }
      }

      await removePidFile(serverDir);
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    try {
      const { WorldOSServer, loadServerConfig: loadConfig } = await import('@worldos/server');
      const serverConfig = await loadConfig(serverDir);

      if (flags['log-level']) {
        serverConfig.logLevel = flags['log-level'] as 'debug' | 'info' | 'warn' | 'error';
      }

      server = new WorldOSServer(serverConfig);

      // Set up event handlers
      server.on('plugin:started', (status: { name: string; pid?: number }) => {
        if (!flags.json) {
          this.log(`${ts()} [${status.name}] Started (PID: ${status.pid})`);
        }
      });

      server.on('plugin:stopped', (status: { name: string }) => {
        if (!flags.json) {
          this.log(`${ts()} [${status.name}] Stopped`);
        }
      });

      server.on('plugin:crashed', (status: { name: string }, error: Error) => {
        if (!flags.json) {
          this.log(`${ts()} [${status.name}] Crashed: ${error.message}`);
        }
      });

      // Stream plugin output to console
      const logAggregator = server.getLogAggregator();
      logAggregator.streamAllLogs((entry: { plugin: string; level: string; message: string }) => {
        if (!flags.json) {
          this.log(`${ts()} [${entry.plugin}] ${entry.message}`);
        }
      });

      await server.start();

      // Start admin panel if enabled
      const adminConfig = config.admin as Record<string, unknown> | undefined;
      if (adminConfig?.enabled !== false) {
        try {
          // Resolve wos-admin relative to wos-server (sibling package in monorepo)
          const { createRequire } = await import('module');
          const require = createRequire(import.meta.url);
          const serverEntry = require.resolve('@worldos/server');
          // serverEntry is .../wos-server/dist/index.js — go up to package root
          const serverPkgPath = path.resolve(path.dirname(serverEntry), '..');
          const adminPkgPath = path.resolve(serverPkgPath, '..', 'wos-admin');
          const { pathToFileURL } = await import('url');
          const { startAdminServer, AuthManager } = await import(
            pathToFileURL(path.join(adminPkgPath, 'dist', 'index.js')).href
          );

          const adminPort = (adminConfig?.port as number) ?? serverConfig.adminPort ?? 3000;

          const authManager = new AuthManager();
          if (adminConfig?.username && adminConfig?.password) {
            await authManager.setCredentials(
              adminConfig.username as string,
              adminConfig.password as string,
            );
          }

          const staticDir = path.join(adminPkgPath, 'public');

          // Scan plugin manifests for admin panels
          const panels: { name: string; displayName: string; entryPoint: string; icon?: string; route?: string }[] = [];
          const pluginsConfig = config.plugins as Record<string, Record<string, unknown>> | undefined;
          if (pluginsConfig) {
            for (const [pluginName, pluginConf] of Object.entries(pluginsConfig)) {
              if (!pluginConf || typeof pluginConf !== 'object') continue;
              const source = (pluginConf.source as string) ?? `./plugins/${pluginName}`;
              const pluginDir = path.resolve(serverDir, source);
              try {
                const manifestPath = path.join(pluginDir, 'wos-plugin.yaml');
                const manifestContent = await fs.readFile(manifestPath, 'utf-8');
                const manifest = yaml.parse(manifestContent);
                if (manifest?.admin?.panel) {
                  const panel = manifest.admin.panel;
                  panels.push({
                    name: pluginName,
                    displayName: panel.title || pluginName,
                    entryPoint: `/plugins/${pluginName}/admin/panel.js`,
                    icon: panel.icon,
                    route: panel.route,
                  });
                }
              } catch {
                // No manifest or no admin panel — skip
              }
            }
          }

          // Resolve custom logo/favicon if configured
          const customLogoPath = adminConfig?.logo
            ? path.resolve(serverDir, adminConfig.logo as string)
            : undefined;
          const customFaviconPath = adminConfig?.favicon
            ? path.resolve(serverDir, adminConfig.favicon as string)
            : undefined;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (startAdminServer as any)({
            port: adminPort,
            serverDir,
            authManager,
            staticDir,
            mqttClient: server.getAdminMqttClient(),
            pluginRegistry: server.getRegistry(),
            configManager: server.getConfigManager(),
            pluginLoader: server.getPluginLoader(),
            logAggregator: server.getLogAggregator(),
            panels,
            customLogoPath,
            customFaviconPath,
          });

          if (!flags.json) {
            this.log(`${ts()} [admin] Web admin panel listening on http://localhost:${adminPort}`);
            if (panels.length > 0) {
              this.log(`${ts()} [admin] Plugin panels: ${panels.map(p => p.displayName).join(', ')}`);
            }
          }
        } catch (error) {
          if (!flags.json) {
            this.log(`${ts()} [admin] Failed to start admin panel: ${(error as Error).message}`);
          }
        }
      }

      if (flags.json) {
        this.log(JSON.stringify({
          success: true,
          pid: process.pid,
          plugins: enabledPlugins,
        }));
      } else {
        this.log(`${ts()} [server] Server started successfully.`);
      }

      // Keep process running
      await new Promise(() => {});
    } catch (error) {
      await removePidFile(serverDir);
      throw error;
    }
  }

  private async runDaemon(
    serverDir: string,
    config: Record<string, unknown>,
    enabledPlugins: string[],
    flags: { json?: boolean; 'log-level'?: string }
  ): Promise<void> {
    // For daemon mode, we spawn a detached child process
    const { spawn } = await import('child_process');

    const args = ['start', serverDir, '--foreground'];
    if (flags['log-level']) {
      args.push('--log-level', flags['log-level']);
    }

    // Get the path to this CLI
    const cliPath = process.argv[1];

    const child = spawn(process.execPath, [cliPath, ...args], {
      detached: true,
      stdio: 'ignore',
      cwd: serverDir,
    });

    child.unref();

    const pid = child.pid;

    if (flags.json) {
      this.log(JSON.stringify({
        success: true,
        pid,
        plugins: enabledPlugins,
        mode: 'daemon',
      }));
    } else {
      this.log(`WorldOS server started (PID: ${pid})`);
      this.log(`Enabled plugins: ${enabledPlugins.length > 0 ? enabledPlugins.join(', ') : '(none)'}`);
      this.log('');
      this.log('Use "wos status" to check server health.');
      this.log('Use "wos stop" to stop the server.');
    }
  }
}
