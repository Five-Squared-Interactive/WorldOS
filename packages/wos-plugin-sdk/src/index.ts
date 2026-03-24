/**
 * @worldos/plugin-sdk - WorldOS Plugin SDK
 *
 * Node.js SDK for building WorldOS plugins with MQTT communication,
 * lifecycle hooks, and world state access.
 */

export const VERSION = '0.1.0';

// Plugin base class and context
export {
  WOSPlugin,
  type PluginContext,
  type PluginManifest,
  type HealthCheckResult,
  type Logger,
  type WOSPluginOptions,
} from './plugin/index.js';

// MQTT client for plugin communication
export {
  PluginMqttClient,
  type PluginMqttClientOptions,
  type PluginMessage,
  type RequestMessage,
  type ResponseMessage,
  type MessageHandler,
  type RequestOptions,
} from './mqtt/index.js';

// Error handling
export {
  PluginError,
  ConfigurationError,
  ConnectionError,
  TimeoutError,
  ValidationError,
  isPluginError,
  wrapError,
  type ValidationErrorItem,
} from './errors/index.js';

// Logging
export {
  createLogger,
  setGlobalLogLevel,
  getGlobalLogLevel,
  type LogLevel,
  type LoggerOptions,
} from './logging/index.js';

export { VERSION as default };
