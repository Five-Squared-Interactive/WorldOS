/**
 * Dashboard
 *
 * Story 7.4: Plugin Status Dashboard
 *
 * Provides aggregated server and plugin status data
 * for the web administration dashboard.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';

/**
 * Dashboard configuration options
 */
export interface DashboardOptions {
  serverDir: string;
  refreshInterval?: number;
}

/**
 * Plugin status in dashboard
 */
export interface PluginStatus {
  name: string;
  version: string;
  enabled: boolean;
  status: 'running' | 'stopped' | 'failed';
  description?: string;
  health?: {
    status: 'ok' | 'degraded' | 'unhealthy';
    message?: string;
  };
}

/**
 * Dashboard data structure
 */
export interface DashboardData {
  server: {
    status: 'running' | 'stopped';
    pid?: number;
    uptime?: number;
    startedAt?: string;
  };
  plugins: {
    total: number;
    running: number;
    stopped: number;
    failed: number;
    disabled: number;
    list: PluginStatus[];
  };
  config: {
    port: number;
    host: string;
    mqttPort: number;
    mqttEmbedded: boolean;
  };
  directory: string;
  timestamp: number;
  error?: string;
}

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
 * Dashboard - provides aggregated status data for web admin
 */
export class Dashboard extends EventEmitter {
  private serverDir: string;
  private refreshInterval: number;
  private intervalId?: ReturnType<typeof setInterval>;

  constructor(options: DashboardOptions) {
    super();
    this.serverDir = options.serverDir;
    this.refreshInterval = options.refreshInterval ?? 2000;
  }

  /**
   * Start automatic refresh and event emission
   */
  start(): void {
    if (this.intervalId) {
      return; // Already running
    }

    // Emit initial data
    this.emitUpdate();

    // Schedule periodic updates
    this.intervalId = setInterval(() => {
      this.emitUpdate();
    }, this.refreshInterval);
  }

  /**
   * Stop automatic refresh
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  /**
   * Emit update event with current data
   */
  private async emitUpdate(): Promise<void> {
    try {
      const data = await this.getData();
      this.emit('update', data);
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Get current dashboard data
   */
  async getData(): Promise<DashboardData> {
    const timestamp = Date.now();

    // Get server status
    const serverStatus = await this.getServerStatus();

    // Load config
    const config = await this.loadConfig();

    // Get plugin data
    const plugins = await this.getPluginData(config, serverStatus.status === 'running');

    return {
      server: serverStatus,
      plugins,
      config: {
        port: (config.admin as Record<string, unknown>)?.port as number ?? 3000,
        host: (config.server as Record<string, unknown>)?.host as string ?? '0.0.0.0',
        mqttPort: (config.mqtt as Record<string, unknown>)?.port as number ?? 1883,
        mqttEmbedded: (config.mqtt as Record<string, unknown>)?.embedded as boolean ?? true,
      },
      directory: this.serverDir,
      timestamp,
    };
  }

  /**
   * Get server status from PID file
   */
  private async getServerStatus(): Promise<DashboardData['server']> {
    const pidFilePath = path.join(this.serverDir, '.wos.pid');

    try {
      const pidContent = await fs.readFile(pidFilePath, 'utf-8');

      let pid: number;
      let startTime: number | undefined;

      try {
        // Try JSON format first
        const pidData = JSON.parse(pidContent);
        pid = pidData.pid;
        startTime = pidData.startTime;
      } catch {
        // Fall back to plain number
        pid = parseInt(pidContent.trim(), 10);
      }

      if (isNaN(pid) || !isProcessRunning(pid)) {
        return { status: 'stopped' };
      }

      return {
        status: 'running',
        pid,
        ...(startTime !== undefined && {
          uptime: Date.now() - startTime,
          startedAt: new Date(startTime).toISOString(),
        }),
      };
    } catch {
      return { status: 'stopped' };
    }
  }

  /**
   * Load configuration from wos.yaml
   */
  private async loadConfig(): Promise<Record<string, unknown>> {
    const configPath = path.join(this.serverDir, 'wos.yaml');

    try {
      const content = await fs.readFile(configPath, 'utf-8');
      return yaml.parse(content) ?? {};
    } catch {
      return {};
    }
  }

  /**
   * Get plugin data from config
   */
  private async getPluginData(
    config: Record<string, unknown>,
    serverRunning: boolean
  ): Promise<DashboardData['plugins']> {
    const pluginsConfig = config.plugins as Record<string, Record<string, unknown>> | undefined;

    if (!pluginsConfig || typeof pluginsConfig !== 'object') {
      return {
        total: 0,
        running: 0,
        stopped: 0,
        failed: 0,
        disabled: 0,
        list: [],
      };
    }

    const list: PluginStatus[] = [];
    let running = 0;
    let stopped = 0;
    let failed = 0;
    let disabled = 0;

    for (const [name, pluginConfig] of Object.entries(pluginsConfig)) {
      if (!pluginConfig || typeof pluginConfig !== 'object') {
        continue;
      }

      const enabled = pluginConfig.enabled !== false;
      let status: PluginStatus['status'];

      if (!enabled) {
        status = 'stopped';
        disabled++;
      } else if (!serverRunning) {
        status = 'stopped';
        stopped++;
      } else {
        // When server is running, assume enabled plugins are running
        // TODO: Integrate with actual health check system
        status = 'running';
        running++;
      }

      list.push({
        name,
        version: (pluginConfig.version as string) ?? '0.0.0',
        enabled,
        status,
        description: pluginConfig.description as string | undefined,
      });
    }

    return {
      total: list.length,
      running,
      stopped,
      failed,
      disabled,
      list,
    };
  }
}
