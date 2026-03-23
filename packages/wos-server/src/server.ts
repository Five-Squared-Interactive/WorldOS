/**
 * WorldOS Server
 *
 * Main server orchestrator that integrates all components:
 * - PluginLoader: Process isolation and lifecycle
 * - PluginRegistry: Plugin state management
 * - ConfigManager: Plugin configuration
 * - HealthMonitor: MQTT health checks
 * - WebhookManager: Event notifications
 * - LogAggregator: Centralized logging
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
// mqtt is loaded dynamically — see connectMqtt()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MqttClient = any;
import { PluginLoader } from './plugin-loader/plugin-loader.js';
import { PluginRegistry, PluginEntry } from './plugin-registry/plugin-registry.js';
import { ConfigManager } from './config/config-manager.js';
import { WebhookManager, WebhookEvent } from './webhooks/webhook-manager.js';
import { LogAggregator } from './logging/log-aggregator.js';
import { MosquittoBroker } from './mqtt/mosquitto-broker.js';
import type { PluginStatus, ServerStatus } from './plugin-loader/types.js';

/**
 * Server configuration
 */
export interface WorldOSServerConfig {
  serverDir: string;
  /** Use the bundled Mosquitto broker (default true) */
  mqttEmbedded?: boolean;
  mqttHost?: string;
  mqttPort?: number;
  mqttUsername?: string;
  mqttPassword?: string;
  /** WebSocket port for MQTT-over-WS (optional) */
  mqttWebsocketPort?: number;
  adminPort?: number;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Server state
 */
export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping';

/**
 * WorldOS Server events
 */
export interface WorldOSServerEvents {
  'server:starting': () => void;
  'server:started': () => void;
  'server:stopping': () => void;
  'server:stopped': () => void;
  'server:error': (error: Error) => void;
  'plugin:started': (status: PluginStatus) => void;
  'plugin:stopped': (status: PluginStatus) => void;
  'plugin:crashed': (status: PluginStatus, error: Error) => void;
  'plugin:health': (name: string, status: string) => void;
}

/**
 * Main WorldOS Server class
 */
export class WorldOSServer extends EventEmitter {
  private config: Required<Pick<WorldOSServerConfig, 'serverDir' | 'mqttEmbedded' | 'mqttHost' | 'mqttPort' | 'adminPort' | 'logLevel'>> & WorldOSServerConfig;
  private state: ServerState = 'stopped';
  private pluginLoader: PluginLoader;
  private pluginRegistry: PluginRegistry;
  private configManager: ConfigManager;
  private webhookManager: WebhookManager;
  private logAggregator: LogAggregator;
  private mosquittoBroker?: MosquittoBroker;
  private mqttClient?: MqttClient;
  private startedAt?: Date;

  constructor(config: WorldOSServerConfig) {
    super();

    this.config = {
      ...config,
      serverDir: config.serverDir,
      mqttEmbedded: config.mqttEmbedded ?? true,
      mqttHost: config.mqttHost ?? 'localhost',
      mqttPort: config.mqttPort ?? 1883,
      mqttUsername: config.mqttUsername ?? '',
      mqttPassword: config.mqttPassword ?? '',
      adminPort: config.adminPort ?? 3000,
      logLevel: config.logLevel ?? 'info',
    };

    // Initialize components
    this.pluginLoader = new PluginLoader({
      serverDir: this.config.serverDir,
      mqttHost: this.config.mqttHost,
      mqttPort: this.config.mqttPort,
      mqttUsername: this.config.mqttUsername,
      mqttPassword: this.config.mqttPassword,
      logLevel: this.config.logLevel,
    });

    this.pluginRegistry = new PluginRegistry(this.config.serverDir);
    this.configManager = new ConfigManager(this.config.serverDir);
    this.webhookManager = new WebhookManager();
    this.logAggregator = new LogAggregator(path.join(this.config.serverDir, 'logs'));

    this.setupEventHandlers();
  }

  /**
   * Get current server state
   */
  getState(): ServerState {
    return this.state;
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.state === 'running';
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    if (this.state !== 'stopped') {
      throw new Error(`Cannot start server in state '${this.state}'`);
    }

    this.state = 'starting';
    this.emit('server:starting');

    try {
      // Ensure logs directory exists
      await fs.mkdir(path.join(this.config.serverDir, 'logs'), { recursive: true });

      // Load registry
      await this.pluginRegistry.load();

      // Start embedded Mosquitto broker if configured
      if (this.config.mqttEmbedded) {
        this.mosquittoBroker = new MosquittoBroker({
          serverDir: this.config.serverDir,
          port: this.config.mqttPort,
          host: this.config.mqttHost,
          websocketPort: this.config.mqttWebsocketPort,
          username: this.config.mqttUsername || undefined,
          password: this.config.mqttPassword || undefined,
        });

        await this.mosquittoBroker.start();
      }

      // Connect to MQTT
      await this.connectMqtt();

      // Load and start all enabled plugins
      await this.pluginLoader.loadAll();

      this.state = 'running';
      this.startedAt = new Date();
      this.emit('server:started');

    } catch (error) {
      // Clean up broker if it was started
      if (this.mosquittoBroker) {
        await this.mosquittoBroker.stop().catch(() => {});
        this.mosquittoBroker = undefined;
      }
      this.state = 'stopped';
      this.emit('server:error', error as Error);
      throw error;
    }
  }

  /**
   * Stop the server gracefully
   */
  async stop(): Promise<void> {
    if (this.state !== 'running') {
      throw new Error(`Cannot stop server in state '${this.state}'`);
    }

    this.state = 'stopping';
    this.emit('server:stopping');

    try {
      // Stop all plugins
      await this.pluginLoader.stopAll();

      // Disconnect MQTT
      await this.disconnectMqtt();

      // Stop embedded Mosquitto broker
      if (this.mosquittoBroker) {
        await this.mosquittoBroker.stop();
        this.logAggregator.log('server', 'info', 'Embedded Mosquitto broker stopped');
        this.mosquittoBroker = undefined;
      }

      this.state = 'stopped';
      this.startedAt = undefined;
      this.emit('server:stopped');

    } catch (error) {
      this.state = 'stopped';
      this.emit('server:error', error as Error);
      throw error;
    }
  }

  /**
   * Restart the server
   */
  async restart(): Promise<void> {
    if (this.state === 'running') {
      await this.stop();
    }
    await this.start();
  }

  /**
   * Restart a specific plugin
   */
  async restartPlugin(name: string): Promise<void> {
    if (this.state !== 'running') {
      throw new Error('Server is not running');
    }
    await this.pluginLoader.restartPlugin(name);
  }

  /**
   * Get server status
   */
  getStatus(): ServerStatus & { state: ServerState; startedAt?: Date } {
    const pluginStatus = this.pluginLoader.getServerStatus();
    return {
      ...pluginStatus,
      state: this.state,
      startedAt: this.startedAt,
    };
  }

  /**
   * Get status of a specific plugin
   */
  getPluginStatus(name: string): PluginStatus | undefined {
    return this.pluginLoader.getPluginStatus(name);
  }

  /**
   * Get all plugin statuses
   */
  getAllPluginStatuses(): PluginStatus[] {
    return this.pluginLoader.getAllPluginStatuses();
  }

  /**
   * Get plugin registry
   */
  getRegistry(): PluginRegistry {
    return this.pluginRegistry;
  }

  /**
   * Get config manager
   */
  getConfigManager(): ConfigManager {
    return this.configManager;
  }

  /**
   * Get webhook manager
   */
  getWebhookManager(): WebhookManager {
    return this.webhookManager;
  }

  /**
   * Get log aggregator
   */
  getLogAggregator(): LogAggregator {
    return this.logAggregator;
  }

  /**
   * Get plugin loader (for direct access)
   */
  getPluginLoader(): PluginLoader {
    return this.pluginLoader;
  }

  /**
   * Get an MQTT client adapter suitable for the admin panel's MQTTBridge.
   * Returns undefined if MQTT is not connected.
   */
  getAdminMqttClient(): { subscribe: (topic: string, callback: (topic: string, payload: Buffer) => void) => void; unsubscribe: (topic: string) => void; publish: (topic: string, payload: string | Buffer) => void; connected: boolean } | undefined {
    if (!this.mqttClient) return undefined;
    const client = this.mqttClient;
    const handlers = new Map<string, Set<(topic: string, payload: Buffer) => void>>();

    // Route incoming messages to per-topic callbacks
    client.on('message', (topic: string, payload: Buffer) => {
      for (const [pattern, cbs] of handlers) {
        if (topic === pattern || (pattern.endsWith('#') && topic.startsWith(pattern.slice(0, -1)))) {
          for (const cb of cbs) cb(topic, payload);
        }
      }
    });

    return {
      get connected() { return client.connected; },
      subscribe(topic: string, callback: (topic: string, payload: Buffer) => void) {
        if (!handlers.has(topic)) {
          handlers.set(topic, new Set());
          client.subscribe(topic);
        }
        handlers.get(topic)!.add(callback);
      },
      unsubscribe(topic: string) {
        handlers.delete(topic);
        client.unsubscribe(topic);
      },
      publish(topic: string, payload: string | Buffer) {
        client.publish(topic, payload);
      },
    };
  }

  /**
   * Connect to MQTT broker
   */
  private async connectMqtt(): Promise<void> {
    const mqtt = await import('mqtt');
    const url = `mqtt://${this.config.mqttHost}:${this.config.mqttPort}`;

    const options: Record<string, unknown> = {
      reconnectPeriod: 0,    // Don't auto-reconnect during initial connection
      connectTimeout: 5000,  // 5s TCP connect timeout
    };
    if (this.config.mqttUsername) {
      options.username = this.config.mqttUsername;
      options.password = this.config.mqttPassword;
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      this.mqttClient = mqtt.connect(url, options);

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.mqttClient?.end(true);
          this.mqttClient = undefined;
          reject(new Error('MQTT connection timeout'));
        }
      }, 10000);

      this.mqttClient.on('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        // Set MQTT client on plugin loader
        if (this.mqttClient) {
          this.pluginLoader.setMqttClient(this.createMqttClientAdapter());
        }

        resolve();
      });

      this.mqttClient.on('error', (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.mqttClient?.end(true);
        this.mqttClient = undefined;
        reject(error);
      });

      // TCP connection failures often emit 'close' instead of 'error'
      this.mqttClient.on('close', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.mqttClient?.end(true);
        this.mqttClient = undefined;
        reject(new Error(`MQTT connection to ${url} failed`));
      });
    });
  }

  /**
   * Disconnect from MQTT broker
   */
  private async disconnectMqtt(): Promise<void> {
    if (this.mqttClient) {
      return new Promise((resolve) => {
        this.mqttClient!.end(false, {}, () => {
          this.mqttClient = undefined;
          resolve();
        });
      });
    }
  }

  /**
   * Create MQTT client adapter for PluginLoader
   */
  private createMqttClientAdapter() {
    const client = this.mqttClient!;
    return {
      connected: client.connected,
      publish: async (topic: string, message: string) => {
        return new Promise<void>((resolve, reject) => {
          client.publish(topic, message, (error: Error | undefined) => {
            if (error) reject(error);
            else resolve();
          });
        });
      },
      subscribe: async (topic: string) => {
        return new Promise<void>((resolve, reject) => {
          client.subscribe(topic, (error: Error | undefined) => {
            if (error) reject(error);
            else resolve();
          });
        });
      },
      unsubscribe: async (topic: string) => {
        return new Promise<void>((resolve, reject) => {
          client.unsubscribe(topic, (error: Error | undefined) => {
            if (error) reject(error);
            else resolve();
          });
        });
      },
      on: (event: 'message', handler: (topic: string, message: Buffer) => void) => {
        client.on(event, handler);
      },
      off: (event: 'message', handler: (topic: string, message: Buffer) => void) => {
        client.off(event, handler);
      },
    };
  }

  /**
   * Set up event handlers for plugin loader
   */
  private setupEventHandlers(): void {
    // Forward plugin events
    this.pluginLoader.on('plugin:started', (status: PluginStatus) => {
      this.emit('plugin:started', status);
      this.sendWebhookEvent('plugin.started', { plugin: status.name });
      this.logAggregator.log(status.name, 'info', `Plugin started (PID: ${status.pid})`);
    });

    this.pluginLoader.on('plugin:stopped', (status: PluginStatus) => {
      this.emit('plugin:stopped', status);
      this.sendWebhookEvent('plugin.stopped', { plugin: status.name });
      this.logAggregator.log(status.name, 'info', 'Plugin stopped');
    });

    this.pluginLoader.on('plugin:crashed', (status: PluginStatus, error: Error) => {
      this.emit('plugin:crashed', status, error);
      this.sendWebhookEvent('plugin.crashed', {
        plugin: status.name,
        error: error.message,
        restartCount: status.restartCount,
      });
      this.logAggregator.log(status.name, 'error', `Plugin crashed: ${error.message}`);
    });

    this.pluginLoader.on('plugin:health', (name: string, healthStatus: string) => {
      this.emit('plugin:health', name, healthStatus);
      if (healthStatus === 'unhealthy') {
        this.sendWebhookEvent('plugin.unhealthy', { plugin: name });
      }
    });

    this.pluginLoader.on('plugin:output', (name: string, data: string, stream: string) => {
      const level = stream === 'stderr' ? 'error' : 'info';
      for (const line of data.split('\n')) {
        const msg = line.trim();
        if (msg) this.logAggregator.log(name, level, msg);
      }
    });

    this.pluginLoader.on('plugin:failed', (status: PluginStatus) => {
      this.sendWebhookEvent('plugin.failed', {
        plugin: status.name,
        error: status.error,
      });
      this.logAggregator.log(status.name, 'error', `Plugin failed permanently: ${status.error}`);
    });
  }

  /**
   * Send webhook event
   */
  private sendWebhookEvent(type: string, data: Record<string, unknown>): void {
    const event: WebhookEvent = {
      type,
      timestamp: Date.now(),
      data,
    };
    this.webhookManager.sendEvent(event).catch((error) => {
      this.logAggregator.log('server', 'error', `Webhook send failed: ${error.message}`);
    });
  }
}

/**
 * Initialize a new WorldOS server directory
 */
export async function initServer(serverDir: string): Promise<void> {
  // Create directory structure
  await fs.mkdir(serverDir, { recursive: true });
  await fs.mkdir(path.join(serverDir, 'plugins'), { recursive: true });

  // Create default wos.yaml
  const defaultConfig = `# WorldOS Server Configuration
# Generated by wos init

# Server settings
server:
  name: my-worldos-server
  logLevel: info

# MQTT broker settings
mqtt:
  embedded: true
  host: localhost
  port: 1883
  # websocketPort: 9001
  # username: ''
  # password: ''

# Admin panel settings
admin:
  enabled: true
  port: 3000
  # username: admin
  # password: (set via wos config)

# Plugins configuration
plugins: {}

# Webhooks for event notifications
webhooks: []
`;

  const configPath = path.join(serverDir, 'wos.yaml');

  // Check if config already exists
  try {
    await fs.access(configPath);
    // Config exists, don't overwrite
  } catch {
    // Config doesn't exist, create it
    await fs.writeFile(configPath, defaultConfig, 'utf-8');
  }
}

/**
 * Load server configuration from wos.yaml
 */
export async function loadServerConfig(serverDir: string): Promise<WorldOSServerConfig> {
  const configPath = path.join(serverDir, 'wos.yaml');

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const yaml = await import('yaml');
    const config = yaml.parse(content) as Record<string, unknown>;

    const server = config.server as Record<string, unknown> | undefined;
    const mqttConfig = config.mqtt as Record<string, unknown> | undefined;
    const admin = config.admin as Record<string, unknown> | undefined;

    return {
      serverDir,
      mqttEmbedded: (mqttConfig?.embedded as boolean) ?? true,
      mqttHost: (mqttConfig?.host as string) ?? 'localhost',
      mqttPort: (mqttConfig?.port as number) ?? 1883,
      mqttUsername: mqttConfig?.username as string | undefined,
      mqttPassword: mqttConfig?.password as string | undefined,
      mqttWebsocketPort: mqttConfig?.websocketPort as number | undefined,
      adminPort: (admin?.port as number) ?? 3000,
      logLevel: (server?.logLevel as 'debug' | 'info' | 'warn' | 'error') ?? 'info',
    };
  } catch {
    // Return defaults if config doesn't exist
    return {
      serverDir,
      mqttEmbedded: true,
      mqttHost: 'localhost',
      mqttPort: 1883,
      adminPort: 3000,
      logLevel: 'info',
    };
  }
}
