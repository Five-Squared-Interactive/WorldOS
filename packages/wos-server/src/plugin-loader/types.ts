/**
 * Plugin Loader Types
 *
 * Story 1.1: Plugin Process Isolation
 *
 * Type definitions for the plugin loader system including plugin states,
 * status tracking, restart policies, and internal/external interfaces.
 */

import type { ChildProcess } from 'child_process';
import type { PluginManifest } from '../manifest/manifest-validator.js';

/**
 * Plugin lifecycle states
 *
 * State machine:
 * pending -> starting -> running -> stopping -> stopped
 *                     -> degraded (health issues)
 *                     -> crashed -> (restart) -> starting
 *                     -> failed (circuit breaker tripped)
 *                     -> killed (timeout enforcement)
 */
export type PluginState =
  | 'pending'   // Registered but not started
  | 'starting'  // Process spawn in progress
  | 'running'   // Process running and healthy
  | 'degraded'  // Running but health check returns degraded
  | 'stopping'  // Graceful shutdown in progress
  | 'stopped'   // Gracefully stopped
  | 'crashed'   // Process exited unexpectedly
  | 'failed'    // Circuit breaker tripped, won't restart
  | 'killed';   // Forcefully terminated (timeout)

/**
 * Health check status values
 */
export type HealthStatus = 'ok' | 'degraded' | 'unhealthy';

/**
 * Public plugin status (hides ChildProcess)
 */
export interface PluginStatus {
  /** Plugin name */
  name: string;
  /** Current state */
  state: PluginState;
  /** Process ID if running */
  pid?: number;
  /** When the plugin started */
  startedAt?: Date;
  /** When the plugin stopped */
  stoppedAt?: Date;
  /** Number of restart attempts */
  restartCount: number;
  /** Consecutive health check failures */
  consecutiveHealthFailures: number;
  /** Last health check result */
  lastHealthStatus?: HealthStatus;
  /** Last health check time */
  lastHealthCheckAt?: Date;
  /** Error message if crashed/failed */
  error?: string;
  /** Exit code if exited */
  exitCode?: number;
  /** Exit signal if killed */
  exitSignal?: string;
  /** Plugin manifest */
  manifest: PluginManifest;
  /** Plugin directory path */
  pluginDir: string;
}

/**
 * Internal plugin entry with ChildProcess reference
 * Used internally, not exposed to consumers
 */
export interface PluginEntry extends PluginStatus {
  /** Child process reference (internal only) */
  childProcess?: ChildProcess;
  /** Scheduled restart timeout */
  restartTimeout?: ReturnType<typeof setTimeout>;
  /** Health check interval */
  healthCheckInterval?: ReturnType<typeof setInterval>;
}

/**
 * Restart policy configuration
 */
export interface RestartPolicyConfig {
  /** Initial backoff delay in milliseconds (default: 1000) */
  initialBackoffMs: number;
  /** Maximum backoff delay in milliseconds (default: 30000) */
  maxBackoffMs: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier: number;
  /** Time after which restart count resets (default: 60000) */
  stableThresholdMs: number;
  /** Number of failures that trips circuit breaker (default: 5) */
  circuitBreakerThreshold: number;
  /** Window for circuit breaker failures in milliseconds (default: 300000) */
  circuitBreakerWindowMs: number;
}

/**
 * Default restart policy
 */
export const DEFAULT_RESTART_POLICY: RestartPolicyConfig = {
  initialBackoffMs: 1000,       // 1 second
  maxBackoffMs: 30000,          // 30 seconds
  backoffMultiplier: 2,         // doubles each failure
  stableThresholdMs: 60000,     // 60 seconds to reset
  circuitBreakerThreshold: 5,   // 5 failures
  circuitBreakerWindowMs: 300000, // 5 minutes
};

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  /** Interval between health checks in milliseconds (default: 30000) */
  intervalMs: number;
  /** Timeout for health check response in milliseconds (default: 5000) */
  timeoutMs: number;
  /** Number of failures before marking unhealthy (default: 3) */
  failureThreshold: number;
  /** Graceful shutdown timeout before SIGKILL (default: 5000) */
  gracefulShutdownMs: number;
}

/**
 * Default health check configuration
 */
export const DEFAULT_HEALTH_CHECK_CONFIG: HealthCheckConfig = {
  intervalMs: 30000,          // 30 seconds
  timeoutMs: 5000,            // 5 seconds
  failureThreshold: 3,        // 3 failures
  gracefulShutdownMs: 5000,   // 5 seconds
};

/**
 * Plugin loader configuration
 */
export interface PluginLoaderConfig {
  /** Server directory (contains plugins/, wos.yaml) */
  serverDir: string;
  /** MQTT broker host */
  mqttHost: string;
  /** MQTT broker port */
  mqttPort: number;
  /** Optional MQTT username */
  mqttUsername?: string;
  /** Optional MQTT password */
  mqttPassword?: string;
  /** Restart policy config */
  restartPolicy?: Partial<RestartPolicyConfig>;
  /** Health check config */
  healthCheck?: Partial<HealthCheckConfig>;
  /** Log level for plugins */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Discovered plugin info from scanner
 */
export interface DiscoveredPlugin {
  /** Plugin name from manifest */
  name: string;
  /** Absolute path to plugin directory */
  pluginDir: string;
  /** Parsed manifest */
  manifest: PluginManifest;
}

/**
 * Plugin scan result
 */
export interface PluginScanResult {
  /** Successfully discovered plugins */
  plugins: DiscoveredPlugin[];
  /** Errors encountered during scanning */
  errors: PluginScanError[];
}

/**
 * Error during plugin scanning
 */
export interface PluginScanError {
  /** Plugin directory path */
  pluginDir: string;
  /** Error message */
  message: string;
  /** Validation errors if manifest was invalid */
  validationErrors?: Array<{
    field: string;
    message: string;
    suggestion?: string;
  }>;
}

/**
 * Restart calculation result
 */
export interface RestartDecision {
  /** Whether to restart */
  shouldRestart: boolean;
  /** Delay before restart in milliseconds */
  delayMs: number;
  /** Reason for decision */
  reason: string;
}

/**
 * Events emitted by PluginLoader
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
 * Aggregated server status
 */
export type ServerHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Server status for graceful degradation
 */
export interface ServerStatus {
  /** Overall health status */
  status: ServerHealthStatus;
  /** Total plugin count */
  totalPlugins: number;
  /** Running plugins */
  runningPlugins: number;
  /** Degraded plugins */
  degradedPlugins: number;
  /** Failed plugins */
  failedPlugins: number;
  /** Individual plugin statuses */
  plugins: PluginStatus[];
}

// Re-export PluginManifest for convenience
export type { PluginManifest };
