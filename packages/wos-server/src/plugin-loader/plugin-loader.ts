/**
 * Plugin Loader
 *
 * Stories 1.5, 1.7: Main Orchestrator
 *
 * Orchestrates plugin lifecycle including:
 * - Plugin discovery and validation
 * - Process spawning with PID tracking
 * - Health monitoring via MQTT
 * - Crash detection and automatic restart
 * - Graceful degradation and status aggregation
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import { PluginScanner } from './plugin-scanner.js';
import { ProcessSpawner, SpawnConfig } from './process-spawner.js';
import { RestartPolicy } from './restart-policy.js';
import { HealthMonitor, MqttClient } from './health-monitor.js';
import { DependencyResolver, PluginDependencies } from '../dependencies/dependency-resolver.js';
import {
  PluginLoaderConfig,
  PluginEntry,
  PluginStatus,
  PluginState,
  PluginManifest,
  DiscoveredPlugin,
  ServerStatus,
  ServerHealthStatus,
  HealthStatus,
  DEFAULT_RESTART_POLICY,
  DEFAULT_HEALTH_CHECK_CONFIG,
} from './types.js';

/**
 * Plugin loader events
 */
export interface PluginLoaderEvents {
  'plugin:discovered': (plugin: DiscoveredPlugin) => void;
  'plugin:starting': (name: string) => void;
  'plugin:started': (status: PluginStatus) => void;
  'plugin:stopping': (name: string) => void;
  'plugin:stopped': (status: PluginStatus) => void;
  'plugin:crashed': (status: PluginStatus, error: Error) => void;
  'plugin:failed': (status: PluginStatus) => void;
  'plugin:killed': (status: PluginStatus) => void;
  'plugin:restarting': (name: string, attempt: number, delay: number) => void;
  'plugin:health': (name: string, status: HealthStatus, details?: Record<string, unknown>) => void;
  'plugin:output': (name: string, data: string, stream: 'stdout' | 'stderr') => void;
  'loader:ready': () => void;
  'loader:error': (error: Error) => void;
}

/**
 * Main plugin loader class
 */
export class PluginLoader extends EventEmitter {
  private config: Required<PluginLoaderConfig>;
  private plugins: Map<string, PluginEntry> = new Map();
  private scanner: PluginScanner;
  private spawner: ProcessSpawner;
  private restartPolicy: RestartPolicy;
  private healthMonitor: HealthMonitor;
  private dependencyResolver: DependencyResolver;
  private mqttClient?: MqttClient;
  private isShuttingDown = false;

  constructor(config: PluginLoaderConfig) {
    super();

    this.config = {
      serverDir: config.serverDir,
      mqttHost: config.mqttHost,
      mqttPort: config.mqttPort,
      mqttUsername: config.mqttUsername ?? '',
      mqttPassword: config.mqttPassword ?? '',
      restartPolicy: { ...DEFAULT_RESTART_POLICY, ...config.restartPolicy },
      healthCheck: { ...DEFAULT_HEALTH_CHECK_CONFIG, ...config.healthCheck },
      logLevel: config.logLevel ?? 'info',
    };

    this.scanner = new PluginScanner();
    this.spawner = new ProcessSpawner();
    this.restartPolicy = new RestartPolicy(this.config.restartPolicy);
    this.healthMonitor = new HealthMonitor(this.config.healthCheck);
    this.dependencyResolver = new DependencyResolver();

    this.setupHealthMonitorEvents();
  }

  /**
   * Set the MQTT client for health monitoring
   */
  setMqttClient(client: MqttClient): void {
    this.mqttClient = client;
    this.healthMonitor.setMqttClient(client);
  }

  /**
   * Discover and load all enabled plugins
   */
  async loadAll(): Promise<void> {
    const pluginsDir = path.join(this.config.serverDir, 'plugins');

    // Scan for plugins
    const scanResult = await this.scanner.scan(pluginsDir);

    // Emit discovery events
    for (const plugin of scanResult.plugins) {
      this.emit('plugin:discovered', plugin);
    }

    // Log errors but continue
    for (const error of scanResult.errors) {
      this.emit('loader:error', new Error(`Plugin scan error in ${error.pluginDir}: ${error.message}`));
    }

    if (scanResult.plugins.length === 0) {
      this.emit('loader:ready');
      return;
    }

    // Resolve startup order based on dependencies
    const pluginDeps: PluginDependencies[] = scanResult.plugins.map(p => ({
      name: p.name,
      dependencies: p.manifest.dependencies,
    }));

    let startupOrder: string[];
    try {
      startupOrder = this.dependencyResolver.resolveOrder(pluginDeps);
    } catch (error) {
      this.emit('loader:error', error as Error);
      return;
    }

    // Start plugins in order
    for (const pluginName of startupOrder) {
      const plugin = scanResult.plugins.find(p => p.name === pluginName);
      if (plugin) {
        await this.loadPlugin(plugin);
      }
    }

    this.emit('loader:ready');
  }

  /**
   * Load a single plugin
   */
  async loadPlugin(discovered: DiscoveredPlugin): Promise<void> {
    const { name, pluginDir, manifest } = discovered;

    // Create plugin entry
    const entry: PluginEntry = {
      name,
      state: 'pending',
      restartCount: 0,
      consecutiveHealthFailures: 0,
      manifest,
      pluginDir,
    };

    this.plugins.set(name, entry);

    // Start the plugin
    await this.startPlugin(name);
  }

  /**
   * Start a plugin process
   */
  async startPlugin(name: string): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) {
      throw new Error(`Plugin '${name}' not found`);
    }

    if (entry.state === 'running') {
      return; // Already running
    }

    this.emit('plugin:starting', name);
    entry.state = 'starting';

    const spawnConfig: SpawnConfig = {
      manifest: entry.manifest,
      pluginDir: entry.pluginDir,
      mqttHost: this.config.mqttHost,
      mqttPort: this.config.mqttPort,
      configPath: path.join(entry.pluginDir, 'config.yaml'),
      serverDir: this.config.serverDir,
      mqttUsername: this.config.mqttUsername,
      mqttPassword: this.config.mqttPassword,
      logLevel: this.config.logLevel,
    };

    try {
      const result = this.spawner.spawn(spawnConfig);

      entry.childProcess = result.process;
      entry.pid = result.pid;
      entry.startedAt = new Date();
      entry.state = 'running';
      entry.error = undefined;

      // Set up process event handlers
      this.setupProcessHandlers(entry);

      // Start health monitoring
      if (this.mqttClient) {
        await this.healthMonitor.startMonitoring(name, result.process);
      }

      this.emit('plugin:started', this.toPluginStatus(entry));

      // Record stability after successful start
      setTimeout(() => {
        if (entry.state === 'running') {
          this.restartPolicy.recordStable(name);
        }
      }, this.config.restartPolicy.stableThresholdMs);

    } catch (error) {
      entry.state = 'failed';
      entry.error = (error as Error).message;
      this.emit('plugin:crashed', this.toPluginStatus(entry), error as Error);
    }
  }

  /**
   * Stop a plugin gracefully
   */
  async stopPlugin(name: string): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) {
      throw new Error(`Plugin '${name}' not found`);
    }

    if (entry.state !== 'running' && entry.state !== 'starting' && entry.state !== 'degraded') {
      return; // Not running
    }

    this.emit('plugin:stopping', name);
    entry.state = 'stopping';

    // Stop health monitoring
    await this.healthMonitor.stopMonitoring(name);

    // Clear restart timeout if any
    if (entry.restartTimeout) {
      clearTimeout(entry.restartTimeout);
      entry.restartTimeout = undefined;
    }

    // Kill the process gracefully
    if (entry.childProcess) {
      await this.spawner.killGracefully(
        entry.childProcess,
        this.config.healthCheck.gracefulShutdownMs
      );
    }

    entry.state = 'stopped';
    entry.stoppedAt = new Date();
    entry.childProcess = undefined;

    this.emit('plugin:stopped', this.toPluginStatus(entry));
  }

  /**
   * Stop all plugins
   */
  async stopAll(): Promise<void> {
    this.isShuttingDown = true;

    // Clear ALL pending restart timeouts first to prevent spawns during shutdown
    for (const entry of this.plugins.values()) {
      if (entry.restartTimeout) {
        clearTimeout(entry.restartTimeout);
        entry.restartTimeout = undefined;
      }
    }

    // Get shutdown order (reverse of startup)
    const pluginDeps: PluginDependencies[] = Array.from(this.plugins.values()).map(p => ({
      name: p.name,
      dependencies: p.manifest.dependencies,
    }));

    const shutdownOrder = this.dependencyResolver.getShutdownOrder(pluginDeps);

    // Stop plugins in order
    for (const name of shutdownOrder) {
      await this.stopPlugin(name);
    }

    // Stop health monitoring
    await this.healthMonitor.stopAll();

    this.isShuttingDown = false;
  }

  /**
   * Restart a plugin
   */
  async restartPlugin(name: string): Promise<void> {
    await this.stopPlugin(name);
    await this.startPlugin(name);
  }

  /**
   * Get status of a specific plugin
   */
  getPluginStatus(name: string): PluginStatus | undefined {
    const entry = this.plugins.get(name);
    return entry ? this.toPluginStatus(entry) : undefined;
  }

  /**
   * Get status of all plugins
   */
  getAllPluginStatuses(): PluginStatus[] {
    return Array.from(this.plugins.values()).map(e => this.toPluginStatus(e));
  }

  /**
   * Get aggregated server status for graceful degradation
   */
  getServerStatus(): ServerStatus {
    const plugins = this.getAllPluginStatuses();

    let runningPlugins = 0;
    let degradedPlugins = 0;
    let failedPlugins = 0;

    for (const plugin of plugins) {
      switch (plugin.state) {
        case 'running':
          runningPlugins++;
          break;
        case 'degraded':
          runningPlugins++;
          degradedPlugins++;
          break;
        case 'failed':
        case 'killed':
        case 'crashed':
          failedPlugins++;
          break;
      }
    }

    // Determine overall status
    let status: ServerHealthStatus;
    if (failedPlugins > 0) {
      status = degradedPlugins > 0 || runningPlugins < plugins.length ? 'unhealthy' : 'degraded';
    } else if (degradedPlugins > 0) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    return {
      status,
      totalPlugins: plugins.length,
      runningPlugins,
      degradedPlugins,
      failedPlugins,
      plugins,
    };
  }

  /**
   * Check if a plugin is running
   */
  isRunning(name: string): boolean {
    const entry = this.plugins.get(name);
    return entry?.state === 'running' || entry?.state === 'degraded';
  }

  /**
   * Reset circuit breaker for a plugin (manual recovery)
   */
  resetCircuitBreaker(name: string): void {
    this.restartPolicy.resetCircuitBreaker(name);

    const entry = this.plugins.get(name);
    if (entry && entry.state === 'failed') {
      entry.state = 'pending';
      entry.restartCount = 0;
      entry.error = undefined;
    }
  }

  /**
   * Set up process event handlers
   */
  private setupProcessHandlers(entry: PluginEntry): void {
    const childProcess = entry.childProcess;
    if (!childProcess) return;

    // Handle stdout
    childProcess.stdout?.on('data', (data: Buffer) => {
      this.emit('plugin:output', entry.name, data.toString(), 'stdout');
    });

    // Handle stderr
    childProcess.stderr?.on('data', (data: Buffer) => {
      this.emit('plugin:output', entry.name, data.toString(), 'stderr');
    });

    // Handle process exit
    childProcess.on('exit', (code, signal) => {
      this.handleProcessExit(entry, code, signal);
    });

    // Handle process error
    childProcess.on('error', (error) => {
      this.handleProcessError(entry, error);
    });
  }

  /**
   * Handle process exit event
   */
  private handleProcessExit(
    entry: PluginEntry,
    code: number | null,
    signal: string | null
  ): void {
    entry.exitCode = code ?? undefined;
    entry.exitSignal = signal ?? undefined;
    entry.stoppedAt = new Date();
    entry.childProcess = undefined;

    // Don't handle if we're shutting down gracefully
    if (entry.state === 'stopping' || this.isShuttingDown) {
      entry.state = 'stopped';
      this.emit('plugin:stopped', this.toPluginStatus(entry));
      return;
    }

    // Determine if this was a crash
    const isCrash = code !== 0 || signal !== null;

    if (isCrash) {
      entry.state = 'crashed';
      entry.error = signal
        ? `Process killed by signal ${signal}`
        : `Process exited with code ${code}`;

      this.emit('plugin:crashed', this.toPluginStatus(entry), new Error(entry.error));

      // Handle restart
      this.handleCrashRestart(entry);
    } else {
      entry.state = 'stopped';
      this.emit('plugin:stopped', this.toPluginStatus(entry));
    }
  }

  /**
   * Handle process error event
   */
  private handleProcessError(entry: PluginEntry, error: Error): void {
    entry.state = 'crashed';
    entry.error = error.message;
    entry.stoppedAt = new Date();
    entry.childProcess = undefined;

    this.emit('plugin:crashed', this.toPluginStatus(entry), error);

    // Handle restart
    this.handleCrashRestart(entry);
  }

  /**
   * Handle automatic restart on crash
   */
  private handleCrashRestart(entry: PluginEntry): void {
    // Stop health monitoring
    this.healthMonitor.stopMonitoring(entry.name);

    // Get restart decision
    const decision = this.restartPolicy.getRestartDecision(entry.name);

    if (!decision.shouldRestart) {
      entry.state = 'failed';
      entry.error = decision.reason;
      this.emit('plugin:failed', this.toPluginStatus(entry));
      return;
    }

    // Record restart
    this.restartPolicy.recordRestart(entry.name);
    entry.restartCount++;

    this.emit('plugin:restarting', entry.name, entry.restartCount, decision.delayMs);

    // Schedule restart with backoff
    entry.restartTimeout = setTimeout(() => {
      if (entry.state === 'crashed' && !this.isShuttingDown) {
        this.startPlugin(entry.name).catch((error) => {
          entry.state = 'failed';
          entry.error = error.message;
          this.emit('plugin:failed', this.toPluginStatus(entry));
        });
      }
    }, decision.delayMs);
  }

  /**
   * Set up health monitor event handlers
   */
  private setupHealthMonitorEvents(): void {
    this.healthMonitor.on('health:ok', (name: string, details?: Record<string, unknown>) => {
      const entry = this.plugins.get(name);
      if (entry) {
        entry.consecutiveHealthFailures = 0;
        entry.lastHealthStatus = 'ok';
        entry.lastHealthCheckAt = new Date();

        if (entry.state === 'degraded') {
          entry.state = 'running';
        }

        this.emit('plugin:health', name, 'ok', details);
        this.restartPolicy.recordStable(name);
      }
    });

    this.healthMonitor.on('health:degraded', (name: string, details?: Record<string, unknown>) => {
      const entry = this.plugins.get(name);
      if (entry) {
        entry.consecutiveHealthFailures = 0;
        entry.lastHealthStatus = 'degraded';
        entry.lastHealthCheckAt = new Date();
        entry.state = 'degraded';

        this.emit('plugin:health', name, 'degraded', details);
      }
    });

    this.healthMonitor.on('health:unhealthy', (name: string, failures: number) => {
      const entry = this.plugins.get(name);
      if (entry) {
        entry.consecutiveHealthFailures = failures;
        entry.lastHealthStatus = 'unhealthy';
        entry.lastHealthCheckAt = new Date();

        this.emit('plugin:health', name, 'unhealthy');
      }
    });

    this.healthMonitor.on('health:threshold', async (name: string, failures: number) => {
      const entry = this.plugins.get(name);
      if (entry && entry.state !== 'stopping' && !this.isShuttingDown) {
        entry.error = `Health check failed ${failures} times`;
        entry.state = 'killed';

        // Kill the unhealthy plugin
        await this.healthMonitor.killUnhealthyPlugin(name);

        this.emit('plugin:killed', this.toPluginStatus(entry));

        // Trigger crash restart handling
        entry.state = 'crashed';
        this.handleCrashRestart(entry);
      }
    });
  }

  /**
   * Convert internal entry to public status
   */
  private toPluginStatus(entry: PluginEntry): PluginStatus {
    return {
      name: entry.name,
      state: entry.state,
      pid: entry.pid,
      startedAt: entry.startedAt,
      stoppedAt: entry.stoppedAt,
      restartCount: entry.restartCount,
      consecutiveHealthFailures: entry.consecutiveHealthFailures,
      lastHealthStatus: entry.lastHealthStatus,
      lastHealthCheckAt: entry.lastHealthCheckAt,
      error: entry.error,
      exitCode: entry.exitCode,
      exitSignal: entry.exitSignal,
      manifest: entry.manifest,
      pluginDir: entry.pluginDir,
    };
  }
}
