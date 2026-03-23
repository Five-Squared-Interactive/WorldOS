/**
 * Status Command
 *
 * Story 3.6: wos status Command
 * Story 6.3: Real-time Health Dashboard
 *
 * Displays the server and plugin status with optional watch mode.
 */

import { Command, Flags } from '@oclif/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';

/**
 * Check if a process with the given PID is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format uptime from milliseconds
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Status result structure
 */
interface StatusResult {
  server: {
    status: 'running' | 'stopped';
    pid?: number;
    uptime?: string;
    startedAt?: string;
  };
  config: {
    port: number;
    host: string;
    mqttPort: number;
    mqttEmbedded: boolean;
  };
  plugins: Array<{
    name: string;
    status: string;
    enabled: boolean;
    health?: string;
  }>;
  directory: string;
}

export default class Status extends Command {
  static override description = 'Show WorldOS server and plugin status';

  static override examples = [
    '<%= config.bin %> status',
    '<%= config.bin %> status --json',
    '<%= config.bin %> status --watch',
    '<%= config.bin %> status --watch --interval 5',
    '<%= config.bin %> status --directory ./my-server',
  ];

  static override flags = {
    directory: Flags.string({
      char: 'd',
      description: 'Server directory (default: current directory)',
      default: process.cwd(),
    }),
    json: Flags.boolean({
      description: 'Output in JSON format',
      default: false,
    }),
    watch: Flags.boolean({
      char: 'w',
      description: 'Watch mode - refresh status continuously',
      default: false,
    }),
    interval: Flags.integer({
      char: 'i',
      description: 'Refresh interval in seconds (default: 2)',
      default: 2,
    }),
    'no-color': Flags.boolean({
      description: 'Disable colored output',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Status);
    const serverDir = path.resolve(flags.directory);

    if (flags.watch) {
      await this.runWatchMode(serverDir, flags);
    } else {
      await this.runOnce(serverDir, flags);
    }
  }

  /**
   * Run status check once
   */
  private async runOnce(
    serverDir: string,
    flags: { json: boolean; 'no-color': boolean }
  ): Promise<void> {
    const result = await this.getStatus(serverDir);

    if ('error' in result) {
      if (flags.json) {
        this.log(JSON.stringify(result, null, 2));
      } else {
        this.log('WorldOS Server Status');
        this.log('---------------------');
        this.log('');
        this.log(`Status: Not initialized (no wos.yaml found in ${serverDir})`);
        this.log('');
        this.log("Run 'wos init' to initialize a new server.");
      }
      return;
    }

    if (flags.json) {
      this.log(JSON.stringify(result, null, 2));
    } else {
      this.outputText(result, !flags['no-color']);
    }
  }

  /**
   * Run in watch mode
   */
  private async runWatchMode(
    serverDir: string,
    flags: { json: boolean; interval: number; 'no-color': boolean }
  ): Promise<void> {
    this.log('Watching status... (Ctrl+C to stop)');
    this.log('');

    let previousResult: StatusResult | null = null;

    // Set up signal handlers for graceful exit
    const cleanup = () => {
      this.log('\nStopped watching.');
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Main watch loop
    while (true) {
      const result = await this.getStatus(serverDir);

      if ('error' in result) {
        this.log(`Status: Not initialized`);
      } else {
        // Clear screen for refresh (simple approach)
        if (previousResult !== null) {
          // Move cursor up and clear
          const lines = this.countOutputLines(result);
          process.stdout.write(`\x1B[${lines}A\x1B[J`);
        }

        if (flags.json) {
          this.log(JSON.stringify(result, null, 2));
        } else {
          this.outputText(result, !flags['no-color'], previousResult);
        }

        previousResult = result;
      }

      await this.sleep(flags.interval * 1000);
    }
  }

  /**
   * Get current status
   */
  private async getStatus(
    serverDir: string
  ): Promise<StatusResult | { error: string; message: string }> {
    const wosYamlPath = path.join(serverDir, 'wos.yaml');
    const pidFilePath = path.join(serverDir, '.wos.pid');

    // Check if wos.yaml exists
    const configExists = await fs.access(wosYamlPath).then(() => true).catch(() => false);
    if (!configExists) {
      return {
        error: 'not_initialized',
        message: `WorldOS not initialized in ${serverDir}. Run 'wos init' first.`,
      };
    }

    // Load config
    let config: Record<string, unknown>;
    try {
      const configContent = await fs.readFile(wosYamlPath, 'utf-8');
      config = yaml.parse(configContent) ?? {};
    } catch {
      config = {};
    }

    // Check server status via PID file
    let serverStatus: 'running' | 'stopped' = 'stopped';
    let pid: number | undefined;
    let startTime: number | undefined;

    const pidFileExists = await fs.access(pidFilePath).then(() => true).catch(() => false);
    if (pidFileExists) {
      try {
        const pidContent = await fs.readFile(pidFilePath, 'utf-8');

        // Try to parse as JSON (new format with timestamp)
        try {
          const pidData = JSON.parse(pidContent);
          pid = pidData.pid;
          startTime = pidData.startTime;
        } catch {
          // Fall back to plain PID format
          pid = parseInt(pidContent.trim(), 10);
        }

        if (pid && !isNaN(pid) && isProcessRunning(pid)) {
          serverStatus = 'running';
        } else {
          // Stale PID file
          pid = undefined;
          startTime = undefined;
          await fs.unlink(pidFilePath).catch(() => {});
        }
      } catch {
        // Invalid PID file
      }
    }

    // Build plugin list
    const serverConfig = config.server as Record<string, unknown> | undefined;
    const mqttConfig = config.mqtt as Record<string, unknown> | undefined;
    const pluginsConfig = config.plugins as Record<string, unknown> | undefined;

    const port = (serverConfig?.port as number) ?? 8080;
    const host = (serverConfig?.host as string) ?? '0.0.0.0';
    const mqttPort = (mqttConfig?.port as number) ?? 1883;
    const mqttEmbedded = (mqttConfig?.embedded as boolean) ?? true;

    const plugins: StatusResult['plugins'] = [];

    if (pluginsConfig) {
      for (const [name, value] of Object.entries(pluginsConfig)) {
        const pluginConfig = value as Record<string, unknown>;
        const enabled = pluginConfig.enabled !== false;

        plugins.push({
          name,
          status: serverStatus === 'running' && enabled ? 'running' : 'stopped',
          enabled,
          health: serverStatus === 'running' && enabled ? 'ok' : undefined,
        });
      }
    }

    return {
      server: {
        status: serverStatus,
        ...(pid !== undefined && { pid }),
        ...(startTime !== undefined && {
          uptime: formatUptime(Date.now() - startTime),
          startedAt: new Date(startTime).toISOString(),
        }),
      },
      config: {
        port,
        host,
        mqttPort,
        mqttEmbedded,
      },
      plugins,
      directory: serverDir,
    };
  }

  /**
   * Output status as text
   */
  private outputText(
    result: StatusResult,
    useColors: boolean,
    previousResult?: StatusResult | null
  ): void {
    const green = useColors ? '\x1b[32m' : '';
    const yellow = useColors ? '\x1b[33m' : '';
    const red = useColors ? '\x1b[31m' : '';
    const reset = useColors ? '\x1b[0m' : '';
    const bold = useColors ? '\x1b[1m' : '';

    this.log(`${bold}WorldOS Server Status${reset}`);
    this.log('=====================');
    this.log('');

    // Server status
    if (result.server.status === 'running') {
      this.log(`Server: ${green}Running${reset} (PID: ${result.server.pid})`);
      if (result.server.uptime) {
        this.log(`Uptime: ${result.server.uptime}`);
      }
      if (result.server.startedAt) {
        this.log(`Started: ${result.server.startedAt}`);
      }
    } else {
      this.log(`Server: ${red}Stopped${reset}`);
    }

    this.log('');

    // Configuration
    this.log('Configuration:');
    this.log(`  Port: ${result.config.port}`);
    this.log(`  Host: ${result.config.host}`);
    this.log(`  MQTT Port: ${result.config.mqttPort}`);
    this.log(`  MQTT Embedded: ${result.config.mqttEmbedded ? 'Yes' : 'No'}`);

    this.log('');

    // Plugins
    this.log('Plugins:');
    if (result.plugins.length === 0) {
      this.log('  (no plugins configured)');
    } else {
      for (const plugin of result.plugins) {
        let statusIcon: string;
        let statusColor: string;

        if (!plugin.enabled) {
          statusIcon = '○';
          statusColor = '';
        } else if (plugin.health === 'ok') {
          statusIcon = '●';
          statusColor = green;
        } else if (plugin.health === 'degraded') {
          statusIcon = '◐';
          statusColor = yellow;
        } else {
          statusIcon = '○';
          statusColor = red;
        }

        // Highlight changed plugins
        const changed = previousResult && this.pluginChanged(plugin, previousResult);
        const highlight = changed ? yellow : '';

        this.log(
          `  ${statusColor}${statusIcon}${reset} ${highlight}${plugin.name}${reset} [${plugin.enabled ? 'enabled' : 'disabled'}]`
        );
      }
    }

    this.log('');
    this.log(`Directory: ${result.directory}`);
  }

  /**
   * Check if plugin status changed
   */
  private pluginChanged(
    plugin: StatusResult['plugins'][0],
    previousResult: StatusResult
  ): boolean {
    const previous = previousResult.plugins.find(p => p.name === plugin.name);
    if (!previous) return true;
    return previous.status !== plugin.status || previous.health !== plugin.health;
  }

  /**
   * Count output lines for clearing
   */
  private countOutputLines(result: StatusResult): number {
    // Header + separator + blank + server status lines
    let lines = 5;
    if (result.server.uptime) lines++;
    if (result.server.startedAt) lines++;

    // Config section
    lines += 6;

    // Plugins section
    lines += 2; // Header + at least one line
    lines += Math.max(result.plugins.length, 1);

    // Directory line
    lines += 2;

    return lines;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
