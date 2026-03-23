/**
 * Plugin Protocol Definitions
 *
 * Story 10.4: Binary Plugin Protocol
 *
 * MQTT protocol definitions for multi-runtime plugin support.
 * This defines the contract that all plugin runtimes must implement.
 */

/**
 * Protocol version
 */
export const PROTOCOL_VERSION = '1.0';

/**
 * Graceful shutdown timeout in milliseconds
 */
export const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5000;

/**
 * Health check timeout in milliseconds
 */
export const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * Environment variables passed to plugins
 */
export interface PluginEnvironment {
  /** MQTT broker hostname */
  WOS_MQTT_HOST: string;
  /** MQTT broker port */
  WOS_MQTT_PORT: number;
  /** Plugin name */
  WOS_PLUGIN_NAME: string;
  /** Path to plugin configuration file */
  WOS_CONFIG_PATH: string;
  /** Optional: Log level */
  WOS_LOG_LEVEL?: string;
  /** Optional: MQTT username */
  WOS_MQTT_USERNAME?: string;
  /** Optional: MQTT password */
  WOS_MQTT_PASSWORD?: string;
  /** Optional: Server directory */
  WOS_SERVER_DIR?: string;
}

/**
 * Parse environment variables from process.env format
 */
export function parseEnvironment(env: Record<string, string | undefined>): PluginEnvironment {
  const host = env.WOS_MQTT_HOST;
  const port = env.WOS_MQTT_PORT;
  const name = env.WOS_PLUGIN_NAME;
  const configPath = env.WOS_CONFIG_PATH;

  if (!host || !port || !name || !configPath) {
    throw new Error(
      'Missing required environment variables: WOS_MQTT_HOST, WOS_MQTT_PORT, WOS_PLUGIN_NAME, WOS_CONFIG_PATH'
    );
  }

  return {
    WOS_MQTT_HOST: host,
    WOS_MQTT_PORT: parseInt(port, 10),
    WOS_PLUGIN_NAME: name,
    WOS_CONFIG_PATH: configPath,
    WOS_LOG_LEVEL: env.WOS_LOG_LEVEL,
    WOS_MQTT_USERNAME: env.WOS_MQTT_USERNAME,
    WOS_MQTT_PASSWORD: env.WOS_MQTT_PASSWORD,
    WOS_SERVER_DIR: env.WOS_SERVER_DIR,
  };
}

/**
 * MQTT Topic patterns
 */
export const TopicPatterns = {
  /** Health check request from loader */
  HEALTH_REQUEST: 'wos/plugin/{name}/health/request',
  /** Health check response from plugin */
  HEALTH_RESPONSE: 'wos/plugin/{name}/health/response',
  /** Configuration changed notification */
  CONFIG_CHANGED: 'wos/plugin/{name}/config/changed',
  /** Plugin log messages */
  LOG: 'wos/plugin/{name}/log',
  /** Lifecycle start signal */
  START: 'wos/plugin/{name}/lifecycle/start',
  /** Lifecycle stop signal */
  STOP: 'wos/plugin/{name}/lifecycle/stop',
} as const;

/**
 * Message types
 */
export const MessageTypes = {
  HEALTH_REQUEST: 'health.request',
  HEALTH_RESPONSE: 'health.response',
  CONFIG_CHANGED: 'config.changed',
  START: 'lifecycle.start',
  STOP: 'lifecycle.stop',
  LOG: 'log',
} as const;

/**
 * Build health request topic for a plugin
 */
export function buildHealthRequestTopic(pluginName: string): string {
  return TopicPatterns.HEALTH_REQUEST.replace('{name}', pluginName);
}

/**
 * Build health response topic for a plugin
 */
export function buildHealthResponseTopic(pluginName: string): string {
  return TopicPatterns.HEALTH_RESPONSE.replace('{name}', pluginName);
}

/**
 * Build config topic for a plugin
 */
export function buildConfigTopic(pluginName: string): string {
  return TopicPatterns.CONFIG_CHANGED.replace('{name}', pluginName);
}

/**
 * Build log topic for a plugin
 */
export function buildLogTopic(pluginName: string): string {
  return TopicPatterns.LOG.replace('{name}', pluginName);
}

/**
 * Build start topic for a plugin
 */
export function buildStartTopic(pluginName: string): string {
  return TopicPatterns.START.replace('{name}', pluginName);
}

/**
 * Build stop topic for a plugin
 */
export function buildStopTopic(pluginName: string): string {
  return TopicPatterns.STOP.replace('{name}', pluginName);
}

/**
 * Health check request message
 */
export interface HealthRequest {
  /** Correlation ID for request/response matching */
  correlationId: string;
  /** Request timestamp */
  timestamp: string;
}

/**
 * Health status values
 */
export type HealthStatus = 'healthy' | 'unhealthy' | 'degraded';

/**
 * Health check response message
 */
export interface HealthResponse {
  /** Correlation ID matching the request */
  correlationId: string;
  /** Plugin health status */
  status: HealthStatus;
  /** Response timestamp */
  timestamp: string;
  /** Optional details about the health status */
  details?: {
    memory?: string;
    connections?: number;
    [key: string]: unknown;
  };
}

/**
 * Validate a health response
 */
export function validateHealthResponse(response: unknown): response is HealthResponse {
  if (typeof response !== 'object' || response === null) {
    return false;
  }

  const r = response as Record<string, unknown>;

  if (typeof r.correlationId !== 'string' || r.correlationId.length === 0) {
    return false;
  }

  if (r.status !== 'healthy' && r.status !== 'unhealthy' && r.status !== 'degraded') {
    return false;
  }

  return true;
}

/**
 * Base plugin message structure
 */
export interface PluginMessage {
  /** Message type */
  type: string;
  /** Timestamp */
  timestamp: string;
  /** Plugin name */
  pluginName: string;
  /** Optional correlation ID */
  correlationId?: string;
  /** Optional payload */
  payload?: Record<string, unknown>;
}

/**
 * Log message
 */
export interface LogMessage extends PluginMessage {
  type: 'log';
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Config changed message
 */
export interface ConfigChangedMessage extends PluginMessage {
  type: 'config.changed';
  payload: {
    key: string;
    oldValue?: unknown;
    newValue: unknown;
  };
}

/**
 * Start message
 */
export interface StartMessage extends PluginMessage {
  type: 'lifecycle.start';
  payload: {
    configPath: string;
    serverDir?: string;
  };
}

/**
 * Stop message
 */
export interface StopMessage extends PluginMessage {
  type: 'lifecycle.stop';
  payload: {
    reason: 'shutdown' | 'restart' | 'disable' | 'error';
    gracefulTimeoutMs: number;
  };
}

/**
 * Create a correlation ID
 */
export function createCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Create a health request message
 */
export function createHealthRequest(): HealthRequest {
  return {
    correlationId: createCorrelationId(),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a health response message
 */
export function createHealthResponse(
  correlationId: string,
  status: HealthStatus,
  details?: HealthResponse['details']
): HealthResponse {
  return {
    correlationId,
    status,
    timestamp: new Date().toISOString(),
    details,
  };
}
