/**
 * @worldos/server - WorldOS Core Server
 *
 * Core server with plugin loader, health monitoring, MQTT bus,
 * and embedded Mosquitto broker management.
 */

// Server
export { WorldOSServer, WorldOSServerConfig, WorldOSServerEvents, ServerState, initServer, loadServerConfig } from './server.js';

// Embedded MQTT broker
export { MosquittoBroker, MosquittoBrokerConfig } from './mqtt/mosquitto-broker.js';

// Plugin loader (excluding PluginEntry which is also in plugin-registry)
export {
  PluginLoader, PluginLoaderEvents,
  PluginScanner, scanPlugins, scanSinglePlugin,
  ProcessSpawner, spawnPlugin,
  HealthMonitor, buildHealthRequestTopic, buildHealthResponseTopic,
  validateHealthResponse, createHealthRequest, createHealthResponse,
  RestartPolicy, calculateBackoffDelay,
  PluginState, PluginStatus, PluginManifest, HealthStatus,
  PluginLoaderConfig, DiscoveredPlugin, PluginScanResult,
  RestartDecision, ServerStatus, ServerHealthStatus,
  DEFAULT_RESTART_POLICY, DEFAULT_HEALTH_CHECK_CONFIG,
} from './plugin-loader/index.js';

// Plugin registry
export * from './plugin-registry/index.js';

// Config manager
export * from './config/index.js';

// Logging
export * from './logging/index.js';

// Webhooks
export * from './webhooks/index.js';
