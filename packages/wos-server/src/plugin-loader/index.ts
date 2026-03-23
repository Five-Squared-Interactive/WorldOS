/**
 * Plugin Loader Module
 *
 * Epic 1: Plugin Process Isolation
 *
 * Provides plugin lifecycle management with:
 * - Directory discovery and manifest validation
 * - Process spawning with multi-runtime support
 * - Health monitoring via MQTT
 * - Automatic restart with exponential backoff
 * - Circuit breaker for failure protection
 * - Graceful degradation and status aggregation
 */

// Main orchestrator
export { PluginLoader, PluginLoaderEvents } from './plugin-loader.js';

// Plugin scanner
export {
  PluginScanner,
  PluginScannerOptions,
  scanPlugins,
  scanSinglePlugin,
} from './plugin-scanner.js';

// Process spawner
export {
  ProcessSpawner,
  SpawnConfig,
  SpawnResult,
  RuntimeType,
  spawnPlugin,
} from './process-spawner.js';

// Health monitoring
export {
  HealthMonitor,
  HealthMonitorEvents,
  HealthRequest,
  HealthResponse,
  HealthTopics,
  MqttClient,
  buildHealthRequestTopic,
  buildHealthResponseTopic,
  validateHealthResponse,
  createHealthRequest,
  createHealthResponse,
} from './health-monitor.js';

// Restart policy
export {
  RestartPolicy,
  calculateBackoffDelay,
} from './restart-policy.js';

// Types
export {
  PluginState,
  PluginStatus,
  PluginEntry,
  PluginManifest,
  HealthStatus,
  HealthCheckConfig,
  RestartPolicyConfig,
  PluginLoaderConfig,
  DiscoveredPlugin,
  PluginScanResult,
  PluginScanError,
  RestartDecision,
  ServerStatus,
  ServerHealthStatus,
  DEFAULT_RESTART_POLICY,
  DEFAULT_HEALTH_CHECK_CONFIG,
} from './types.js';
