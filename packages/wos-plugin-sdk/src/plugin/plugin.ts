/**
 * WOSPlugin Base Class
 *
 * Story 2.1: WOSPlugin Base Class
 *
 * Base class for WorldOS plugins with lifecycle hooks.
 * Plugin developers extend this class and implement:
 * - onStart: Called when plugin starts, receives context
 * - onStop: Called when plugin stops, for cleanup
 * - onHealthCheck: Called for health status checks
 */
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PluginMqttClient, type PluginMqttClientOptions } from '../mqtt/client.js';
import { createLogger, type Logger } from '../logging/logger.js';

/**
 * Plugin manifest definition
 */
export interface PluginManifest {
  name: string;
  displayName: string;
  version: string;
  runtime: 'node' | 'python' | 'binary';
  entrypoint: string;
  description?: string;
  author?: string;
  dependencies?: string[];
  environment?: Record<string, string>;
  workingDirectory?: string;
}

export type { Logger } from '../logging/logger.js';

/**
 * Plugin context provided to lifecycle methods
 */
export interface PluginContext {
  /** Logger with plugin name prefix */
  logger: Logger;
  /** Plugin configuration */
  config: Record<string, unknown>;
  /** MQTT client for communication */
  mqtt: PluginMqttClient;
  /** Plugin manifest */
  manifest: PluginManifest;
  /** Server directory (from WOS_SERVER_DIR env var) */
  serverDir?: string;
  /** Plugin directory (from WOS_PLUGIN_DIR env var) */
  pluginDir?: string;
}

/**
 * Health check result from plugin
 */
export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'unhealthy';
  details?: Record<string, unknown>;
  error?: string;
}

/**
 * Options for WOSPlugin constructor
 */
export interface WOSPluginOptions {
  /** Plugin manifest (defaults to environment-based) */
  manifest?: PluginManifest;
  /** Plugin configuration */
  config?: Record<string, unknown>;
  /** MQTT client options */
  mqttOptions?: PluginMqttClientOptions;
}

/**
 * WOSPlugin - Base class for WorldOS plugins
 *
 * Extend this class to create a plugin:
 * ```typescript
 * class MyPlugin extends WOSPlugin {
 *   async onStart(context: PluginContext) {
 *     context.logger.info('Plugin started');
 *   }
 *
 *   async onStop() {
 *     // Cleanup
 *   }
 *
 *   async onHealthCheck(): Promise<HealthCheckResult> {
 *     return { status: 'ok' };
 *   }
 * }
 * ```
 */
export abstract class WOSPlugin extends EventEmitter {
  private _isRunning = false;
  private _context: PluginContext | null = null;
  private _manifest: PluginManifest;
  private _config: Record<string, unknown>;
  private _mqttOptions: PluginMqttClientOptions;

  constructor(options: WOSPluginOptions = {}) {
    super();

    // Build manifest from options or environment
    this._manifest = options.manifest ?? this.buildDefaultManifest();
    this._config = options.config ?? this._loadConfigFromWosYaml() ?? {};
    this._mqttOptions = options.mqttOptions ?? {};
  }

  /**
   * Load plugin config from wos.yaml using WOS_SERVER_DIR and WOS_PLUGIN_NAME env vars
   */
  private _loadConfigFromWosYaml(): Record<string, unknown> | null {
    try {
      const serverDir = process.env.WOS_SERVER_DIR;
      const pluginName = process.env.WOS_PLUGIN_NAME;
      if (!serverDir || !pluginName) return null;

      const yamlPath = join(serverDir, 'wos.yaml');
      const content = readFileSync(yamlPath, 'utf-8');

      // Simple YAML parser for the plugin config section
      // Find the plugin's config block
      const pluginPattern = new RegExp(`^  ${pluginName}:\\s*$`, 'm');
      const match = pluginPattern.exec(content);
      if (!match) return null;

      const afterPlugin = content.slice(match.index + match[0].length);

      // Find the config: line
      const configMatch = /^\s{4}config:\s*$/m.exec(afterPlugin);
      if (!configMatch) return null;

      const afterConfig = afterPlugin.slice(
        configMatch.index + configMatch[0].length,
      );

      // Parse indented key-value pairs (6 spaces indent)
      const config: Record<string, unknown> = {};
      for (const line of afterConfig.split('\n')) {
        if (line.trim() === '') continue;
        const kvMatch = line.match(/^\s{6}(\w+):\s*(.+)$/);
        if (!kvMatch) break;

        let val: unknown = kvMatch[2].trim();
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (/^\d+$/.test(val as string)) val = parseInt(val as string, 10);
        else if (/^\d+\.\d+$/.test(val as string)) val = parseFloat(val as string);

        config[kvMatch[1]] = val;
      }

      return Object.keys(config).length > 0 ? config : null;
    } catch {
      return null;
    }
  }

  /**
   * Build default manifest from environment variables
   */
  private buildDefaultManifest(): PluginManifest {
    const name = process.env.WOS_PLUGIN_NAME ?? 'unknown-plugin';
    return {
      name,
      displayName: name,
      version: '0.0.0',
      runtime: 'node',
      entrypoint: './dist/index.js',
    };
  }

  /**
   * Start the plugin
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      return;
    }

    // Create MQTT client
    const mqtt = new PluginMqttClient({
      autoConnect: false,
      ...this._mqttOptions,
    });
    await mqtt.connect();

    // Create context
    this._context = {
      logger: createLogger(this._manifest.name),
      config: this._config,
      mqtt,
      manifest: this._manifest,
      serverDir: process.env.WOS_SERVER_DIR || undefined,
      pluginDir: process.env.WOS_PLUGIN_DIR || undefined,
    };

    // Call user's onStart
    await this.onStart(this._context);

    this._isRunning = true;
    this.emit('started');
  }

  /**
   * Stop the plugin
   */
  async stop(): Promise<void> {
    if (!this._isRunning) {
      return;
    }

    // Call user's onStop
    await this.onStop();

    // Disconnect MQTT
    if (this._context?.mqtt) {
      await this._context.mqtt.disconnect();
    }

    this._isRunning = false;
    this._context = null;
    this.emit('stopped');
  }

  /**
   * Check plugin health
   */
  async checkHealth(): Promise<HealthCheckResult> {
    try {
      return await this.onHealthCheck();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return {
        status: 'unhealthy',
        error: message,
      };
    }
  }

  /**
   * Whether the plugin is currently running
   */
  get isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Get the plugin context (only available after start)
   */
  get context(): PluginContext | null {
    return this._context;
  }

  /**
   * Get the plugin manifest
   */
  get manifest(): PluginManifest {
    return this._manifest;
  }

  /**
   * Called when the plugin starts
   * @param context - Plugin context with logger, config, mqtt, and manifest
   */
  abstract onStart(context: PluginContext): Promise<void>;

  /**
   * Called when the plugin stops
   */
  abstract onStop(): Promise<void>;

  /**
   * Called for health checks
   * @returns Health check result
   */
  abstract onHealthCheck(): Promise<HealthCheckResult>;
}
