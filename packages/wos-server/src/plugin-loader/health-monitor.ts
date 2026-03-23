/**
 * Health Monitor
 *
 * Stories 1.3, 1.4, 1.8: Plugin Health Checks
 *
 * Implements health check protocol with correlationId, timeout enforcement,
 * and failure tracking.
 *
 * Dual-channel: sends health checks via MQTT **and** stdin/stdout so plugins
 * can respond on whichever channel they support.  A response on either
 * channel clears the pending check.
 */

import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import {
  HealthCheckConfig,
  DEFAULT_HEALTH_CHECK_CONFIG,
  HealthStatus,
} from './types.js';

/**
 * Health check request
 */
export interface HealthRequest {
  correlationId: string;
  timestamp: string;
}

/**
 * Health check response
 */
export interface HealthResponse {
  correlationId: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  details?: Record<string, unknown>;
}

/**
 * MQTT topic patterns
 */
export const HealthTopics = {
  REQUEST: 'wos/plugin/{name}/health/request',
  RESPONSE: 'wos/plugin/{name}/health/response',
  CRASHED: 'wos/plugin/{name}/event/crashed',
  RESTARTING: 'wos/plugin/{name}/event/restarting',
};

/**
 * Build a health request topic
 */
export function buildHealthRequestTopic(pluginName: string): string {
  return HealthTopics.REQUEST.replace('{name}', pluginName);
}

/**
 * Build a health response topic
 */
export function buildHealthResponseTopic(pluginName: string): string {
  return HealthTopics.RESPONSE.replace('{name}', pluginName);
}

/**
 * MQTT client interface (subset needed for health monitoring)
 */
export interface MqttClient {
  publish(topic: string, message: string): Promise<void>;
  subscribe(topic: string): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
  on(event: 'message', handler: (topic: string, message: Buffer) => void): void;
  off(event: 'message', handler: (topic: string, message: Buffer) => void): void;
  connected: boolean;
}

/**
 * Plugin health state
 */
interface PluginHealthState {
  /** Plugin name */
  name: string;
  /** Consecutive health check failures */
  consecutiveFailures: number;
  /** Last health check status */
  lastStatus?: HealthStatus;
  /** Last health check time */
  lastCheckAt?: Date;
  /** Pending health check correlation ID */
  pendingCorrelationId?: string;
  /** Pending health check timeout */
  pendingTimeout?: ReturnType<typeof setTimeout>;
  /** Health check interval */
  checkInterval?: ReturnType<typeof setInterval>;
  /** Child process reference for kill */
  process?: ChildProcess;
  /** stdout listener for stdin/stdout health responses */
  stdoutHandler?: (data: Buffer) => void;
  /** Buffered partial line from stdout */
  stdoutBuffer?: string;
}

/**
 * Health monitor events
 */
export interface HealthMonitorEvents {
  'health:ok': (name: string, details?: Record<string, unknown>) => void;
  'health:degraded': (name: string, details?: Record<string, unknown>) => void;
  'health:unhealthy': (name: string, consecutiveFailures: number) => void;
  'health:timeout': (name: string, consecutiveFailures: number) => void;
  'health:threshold': (name: string, consecutiveFailures: number) => void;
}

/**
 * Monitors plugin health via MQTT and stdin/stdout
 */
export class HealthMonitor extends EventEmitter {
  private config: HealthCheckConfig;
  private mqttClient?: MqttClient;
  private plugins: Map<string, PluginHealthState> = new Map();
  private messageHandler?: (topic: string, message: Buffer) => void;

  constructor(config?: Partial<HealthCheckConfig>) {
    super();
    this.config = {
      ...DEFAULT_HEALTH_CHECK_CONFIG,
      ...config,
    };
  }

  /**
   * Set the MQTT client
   */
  setMqttClient(client: MqttClient): void {
    // Remove old handler if exists
    if (this.mqttClient && this.messageHandler) {
      this.mqttClient.off('message', this.messageHandler);
    }

    this.mqttClient = client;

    // Set up message handler
    this.messageHandler = (topic: string, message: Buffer) => {
      this.handleMessage(topic, message);
    };
    this.mqttClient.on('message', this.messageHandler);
  }

  /**
   * Start monitoring a plugin
   */
  async startMonitoring(
    pluginName: string,
    childProcess: ChildProcess
  ): Promise<void> {
    // Stop any existing monitoring
    await this.stopMonitoring(pluginName);

    const state: PluginHealthState = {
      name: pluginName,
      consecutiveFailures: 0,
      process: childProcess,
      stdoutBuffer: '',
    };

    this.plugins.set(pluginName, state);

    // Subscribe to MQTT health response topic (if MQTT is available)
    if (this.mqttClient) {
      const responseTopic = buildHealthResponseTopic(pluginName);
      await this.mqttClient.subscribe(responseTopic);
    }

    // Listen for stdin/stdout health responses from the child process
    if (childProcess.stdout) {
      state.stdoutHandler = (data: Buffer) => {
        this.handleStdoutData(pluginName, state, data);
      };
      childProcess.stdout.on('data', state.stdoutHandler);
    }

    // Start periodic health checks
    state.checkInterval = setInterval(() => {
      this.sendHealthCheck(pluginName);
    }, this.config.intervalMs);

    // Send initial health check
    this.sendHealthCheck(pluginName);
  }

  /**
   * Stop monitoring a plugin
   */
  async stopMonitoring(pluginName: string): Promise<void> {
    const state = this.plugins.get(pluginName);
    if (!state) return;

    // Clear intervals and timeouts
    if (state.checkInterval) {
      clearInterval(state.checkInterval);
    }
    if (state.pendingTimeout) {
      clearTimeout(state.pendingTimeout);
    }

    // Remove stdout listener
    if (state.stdoutHandler && state.process?.stdout) {
      state.process.stdout.removeListener('data', state.stdoutHandler);
    }

    // Unsubscribe from health topic
    if (this.mqttClient) {
      const responseTopic = buildHealthResponseTopic(pluginName);
      try {
        await this.mqttClient.unsubscribe(responseTopic);
      } catch {
        // Ignore unsubscribe errors
      }
    }

    this.plugins.delete(pluginName);
  }

  /**
   * Stop all monitoring
   */
  async stopAll(): Promise<void> {
    const plugins = Array.from(this.plugins.keys());
    await Promise.all(plugins.map(name => this.stopMonitoring(name)));
  }

  /**
   * Get health state for a plugin
   */
  getHealthState(pluginName: string): {
    consecutiveFailures: number;
    lastStatus?: HealthStatus;
    lastCheckAt?: Date;
  } | undefined {
    const state = this.plugins.get(pluginName);
    if (!state) return undefined;

    return {
      consecutiveFailures: state.consecutiveFailures,
      lastStatus: state.lastStatus,
      lastCheckAt: state.lastCheckAt,
    };
  }

  /**
   * Send a health check request via both MQTT and stdin
   */
  private sendHealthCheck(pluginName: string): void {
    const state = this.plugins.get(pluginName);
    if (!state) return;

    // Generate correlation ID
    const correlationId = this.createCorrelationId();
    state.pendingCorrelationId = correlationId;

    // Set timeout for response
    state.pendingTimeout = setTimeout(() => {
      this.handleHealthTimeout(pluginName);
    }, this.config.timeoutMs);

    const request: HealthRequest = {
      correlationId,
      timestamp: new Date().toISOString(),
    };

    // Channel 1: Send via MQTT (for plugins that subscribe to MQTT topics)
    if (this.mqttClient) {
      const topic = buildHealthRequestTopic(pluginName);
      this.mqttClient.publish(topic, JSON.stringify(request)).catch(() => {
        // MQTT publish failed — stdin channel may still work
      });
    }

    // Channel 2: Send via stdin (for plugins that listen on stdin)
    if (state.process?.stdin && !state.process.stdin.destroyed) {
      const stdinMsg = JSON.stringify({
        type: 'health_check',
        correlationId,
        timestamp: request.timestamp,
      }) + '\n';
      try {
        state.process.stdin.write(stdinMsg);
      } catch {
        // stdin write failed — MQTT channel may still work
      }
    }
  }

  /**
   * Handle incoming MQTT message
   */
  private handleMessage(topic: string, message: Buffer): void {
    // Find matching plugin
    for (const [pluginName, state] of this.plugins) {
      const expectedTopic = buildHealthResponseTopic(pluginName);
      if (topic === expectedTopic) {
        this.handleHealthResponse(pluginName, state, message);
        return;
      }
    }
  }

  /**
   * Handle stdout data from a plugin process (stdin/stdout health channel)
   */
  private handleStdoutData(
    pluginName: string,
    state: PluginHealthState,
    data: Buffer
  ): void {
    // Buffer incoming data and split by newline
    const text = (state.stdoutBuffer || '') + data.toString();
    const lines = text.split('\n');
    // Keep the last (possibly incomplete) line in the buffer
    state.stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed);
        // Accept either "health_response" type (stdin protocol) or MQTT-style response
        if (msg.type === 'health_response' && msg.correlationId) {
          this.handleHealthResponse(pluginName, state, Buffer.from(trimmed));
        }
      } catch {
        // Not JSON or not a health response — ignore (it's regular plugin output)
      }
    }
  }

  /**
   * Handle health check response (from either MQTT or stdout)
   */
  private handleHealthResponse(
    pluginName: string,
    state: PluginHealthState,
    message: Buffer
  ): void {
    // Clear pending timeout
    if (state.pendingTimeout) {
      clearTimeout(state.pendingTimeout);
      state.pendingTimeout = undefined;
    }

    // Parse response
    let response: HealthResponse;
    try {
      response = JSON.parse(message.toString());
    } catch {
      // Invalid response - treat as unhealthy
      this.recordFailure(pluginName, state);
      return;
    }

    // Validate correlation ID
    if (response.correlationId !== state.pendingCorrelationId) {
      // Stale response - ignore
      return;
    }

    state.pendingCorrelationId = undefined;
    state.lastCheckAt = new Date();

    // Process health status — accept both MQTT-style ("healthy") and
    // stdin-style ("ok") status values
    const status = this.normalizeStatus(response.status);
    state.lastStatus = status;

    switch (status) {
      case 'ok':
        state.consecutiveFailures = 0;
        this.emit('health:ok', pluginName, response.details);
        break;

      case 'degraded':
        state.consecutiveFailures = 0;
        this.emit('health:degraded', pluginName, response.details);
        break;

      case 'unhealthy':
        this.recordFailure(pluginName, state);
        break;
    }
  }

  /**
   * Handle health check timeout
   */
  private handleHealthTimeout(pluginName: string): void {
    const state = this.plugins.get(pluginName);
    if (!state) return;

    state.pendingCorrelationId = undefined;
    state.pendingTimeout = undefined;
    state.lastCheckAt = new Date();
    state.lastStatus = 'unhealthy';

    this.recordFailure(pluginName, state);
    this.emit('health:timeout', pluginName, state.consecutiveFailures);
  }

  /**
   * Record a health check failure
   */
  private recordFailure(pluginName: string, state: PluginHealthState): void {
    state.consecutiveFailures++;

    this.emit('health:unhealthy', pluginName, state.consecutiveFailures);

    // Check if failure threshold exceeded
    if (state.consecutiveFailures >= this.config.failureThreshold) {
      this.emit('health:threshold', pluginName, state.consecutiveFailures);
    }
  }

  /**
   * Normalize health status to our enum
   */
  private normalizeStatus(status: string): HealthStatus {
    switch (status.toLowerCase()) {
      case 'healthy':
      case 'ok':
        return 'ok';
      case 'degraded':
        return 'degraded';
      default:
        return 'unhealthy';
    }
  }

  /**
   * Create a correlation ID
   */
  private createCorrelationId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Kill plugin process after health threshold exceeded
   *
   * @param pluginName - Name of the plugin to kill
   * @param gracefulMs - Time to wait before SIGKILL
   */
  async killUnhealthyPlugin(
    pluginName: string,
    gracefulMs = this.config.gracefulShutdownMs
  ): Promise<void> {
    const state = this.plugins.get(pluginName);
    if (!state?.process) return;

    const childProcess = state.process;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        try {
          if (process.platform === 'win32' && childProcess.pid) {
            spawn('taskkill', ['/pid', String(childProcess.pid), '/f', '/t'], {
              stdio: 'ignore',
              windowsHide: true,
            });
          } else {
            childProcess.kill('SIGKILL');
          }
        } catch {
          // Process may already be dead
        }
      }, gracefulMs);

      childProcess.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      try {
        if (process.platform === 'win32') {
          childProcess.kill();
        } else {
          childProcess.kill('SIGTERM');
        }
      } catch {
        clearTimeout(timeout);
        resolve();
      }
    });
  }
}

/**
 * Validate a health response message
 */
export function validateHealthResponse(response: unknown): response is HealthResponse {
  if (typeof response !== 'object' || response === null) {
    return false;
  }

  const r = response as Record<string, unknown>;

  if (typeof r.correlationId !== 'string' || r.correlationId.length === 0) {
    return false;
  }

  const validStatuses = ['healthy', 'unhealthy', 'degraded', 'ok'];
  if (!validStatuses.includes(r.status as string)) {
    return false;
  }

  return true;
}

/**
 * Create a health request message
 */
export function createHealthRequest(): HealthRequest {
  return {
    correlationId: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a health response message
 */
export function createHealthResponse(
  correlationId: string,
  status: 'healthy' | 'unhealthy' | 'degraded',
  details?: Record<string, unknown>
): HealthResponse {
  return {
    correlationId,
    status,
    timestamp: new Date().toISOString(),
    details,
  };
}
