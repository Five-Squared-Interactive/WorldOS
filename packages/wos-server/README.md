# @worldos/server

Core server runtime for WorldOS. Manages the full plugin lifecycle -- discovery, process spawning, health monitoring, configuration, and inter-plugin messaging -- backed by an embedded Mosquitto MQTT broker.

## Architecture

The server is composed of several cooperating subsystems, all orchestrated by `WorldOSServer`:

```
WorldOSServer
  |-- MosquittoBroker        Embedded MQTT broker (Mosquitto child process)
  |-- PluginLoader            Plugin discovery, spawning, restart, health
  |     |-- PluginScanner     Scans plugins/ for wos-plugin.yaml manifests
  |     |-- ProcessSpawner    Spawns child processes (node, python, binary, docker)
  |     |-- HealthMonitor     MQTT-based health check protocol
  |     |-- RestartPolicy     Exponential backoff + circuit breaker
  |     '-- DependencyResolver  Topological sort for startup/shutdown order
  |-- PluginRegistry          Persists installed-plugin state in wos.yaml
  |-- ConfigManager           Loads plugin config with env-var overrides + schema validation
  |-- ConfigNotifier          Publishes config-change events to MQTT for hot-reload
  |-- SecretManager           Resolves secret references (env:, file:, vault:)
  |-- LogAggregator           Centralized file-based logging with rotation
  |-- WebhookManager          HTTP webhook notifications with HMAC + retry
  |-- BackupManager           Plugin backup/rollback support
  |-- StartupAppManager       Long-running sidecar processes
  '-- MessageAppManager       MQTT-triggered on-demand processes
```

### Plugin state machine

```
pending -> starting -> running -> stopping -> stopped
                    -> degraded (health issues, auto-recoverable)
                    -> crashed  -> (restart w/ backoff) -> starting
                    -> failed   (circuit breaker tripped)
                    -> killed   (health threshold exceeded)
```

## Configuration

All configuration lives in `wos.yaml` at the server directory root. Running `initServer(dir)` generates a default file.

### Server section

```yaml
server:
  name: my-worldos-server
  logLevel: info          # debug | info | warn | error
```

### MQTT section

```yaml
mqtt:
  embedded: true          # Start bundled Mosquitto (default true)
  host: localhost
  port: 1883
  websocketPort: 9001     # Optional MQTT-over-WebSocket listener
  username: ""            # Optional credentials
  password: ""
```

When `embedded: true`, the server spawns a Mosquitto child process, generates `mosquitto.conf` in `<serverDir>/.mosquitto/`, and waits for it to accept connections before proceeding.

### Admin section

```yaml
admin:
  enabled: true
  port: 3000
```

### Plugins section

Each installed plugin gets an entry under `plugins`:

```yaml
plugins:
  my-plugin:
    enabled: true
    version: 1.0.0
    source: github:user/repo         # or ./local/path or git:url
    config:
      apiKey: env:MY_API_KEY          # Secret reference resolved at runtime
      retries: 3
```

### Webhooks

```yaml
webhooks:
  - url: https://hooks.example.com/worldos
    events: ["plugin.*"]              # Wildcard or exact event types
    secret: my-hmac-secret            # Optional; adds X-WOS-Signature header
```

## Plugin Lifecycle

1. **Discovery** -- `PluginScanner` reads each subdirectory of `plugins/` looking for a `wos-plugin.yaml` manifest. Manifests are validated by `ManifestValidator` (required fields: `name`, `version`, `runtime`, `entrypoint`).

2. **Dependency resolution** -- `DependencyResolver` performs a topological sort (Kahn's algorithm) across plugin dependency graphs. Circular dependencies are detected and rejected.

3. **Spawning** -- `ProcessSpawner` launches each plugin as an isolated child process. Supported runtimes: `node`, `python`, `binary`, `docker`. Environment variables injected into every plugin process:

   | Variable | Description |
   |---|---|
   | `WOS_MQTT_HOST` | Broker hostname |
   | `WOS_MQTT_PORT` | Broker port |
   | `WOS_PLUGIN_NAME` | Plugin name from manifest |
   | `WOS_CONFIG_PATH` | Path to the plugin's config.yaml |
   | `WOS_SERVER_DIR` | Server root directory |
   | `WOS_PLUGIN_DIR` | Plugin installation directory |
   | `WOS_MQTT_USERNAME` | Broker credentials (if set) |
   | `WOS_MQTT_PASSWORD` | Broker credentials (if set) |
   | `WOS_LOG_LEVEL` | Log level |

4. **Health monitoring** -- `HealthMonitor` periodically publishes a JSON health request to `wos/plugin/{name}/health/request` and expects a response on `wos/plugin/{name}/health/response` within the configured timeout. Responses must include the matching `correlationId`. Consecutive failures beyond `failureThreshold` trigger a forced kill and restart cycle.

5. **Restart with backoff** -- `RestartPolicy` applies exponential backoff (default 1 s initial, 2x multiplier, 30 s cap). A circuit breaker trips after 5 failures within 5 minutes, moving the plugin to the `failed` state. Circuit breakers can be manually reset via `resetCircuitBreaker(name)`.

6. **Shutdown** -- Plugins stop in reverse dependency order. Each receives a graceful shutdown signal (SIGTERM), with a configurable timeout before SIGKILL.

### Plugin manifest (`wos-plugin.yaml`)

```yaml
name: my-plugin
version: 1.0.0
runtime: node                   # node | python | binary | docker
entrypoint: dist/index.js
description: Example plugin
dependencies:
  - other-plugin
mqtt:
  subscriptions:
    - my-plugin/events/#
  publications:
    - my-plugin/status
cli:
  commands:
    - name: greet
      handler: cli/greet.js
admin:
  panels:
    - name: Dashboard
      component: admin/dashboard.js
```

## MQTT

### Embedded broker

`MosquittoBroker` manages a Mosquitto child process. It auto-generates `mosquitto.conf`, optionally sets up password authentication (hashed with `mosquitto_passwd` when available), and supports both TCP and WebSocket listeners. The binary is resolved in order: bundled at `wos-server/mosquitto/bin/`, then system PATH, then common install locations.

### Topic conventions

| Pattern | Purpose |
|---|---|
| `wos/plugin/{name}/health/request` | Server-to-plugin health check |
| `wos/plugin/{name}/health/response` | Plugin-to-server health response |
| `wos/plugin/{name}/event/crashed` | Crash notification |
| `wos/plugin/{name}/event/restarting` | Restart notification |
| `wos/plugin/{name}/config/changed` | Config hot-reload notification |
| `wos/plugin/{name}/config/reset` | Config reset notification |

### Health check protocol

Request (server publishes):
```json
{ "correlationId": "1700000000000-abc123def", "timestamp": "2025-01-01T00:00:00.000Z" }
```

Response (plugin publishes):
```json
{ "correlationId": "1700000000000-abc123def", "status": "healthy", "timestamp": "...", "details": {} }
```

Valid status values: `healthy` / `ok`, `degraded`, `unhealthy`.

### Default health check timing

| Parameter | Default |
|---|---|
| `intervalMs` | 30 000 (30 s) |
| `timeoutMs` | 5 000 (5 s) |
| `failureThreshold` | 3 |
| `gracefulShutdownMs` | 5 000 (5 s) |

## Programmatic API

### WorldOSServer

Main entry point. Extends `EventEmitter`.

```ts
import { WorldOSServer, loadServerConfig, initServer } from '@worldos/server';

// Initialize a new server directory
await initServer('/path/to/server');

// Load config from wos.yaml
const config = await loadServerConfig('/path/to/server');

// Create and start
const server = new WorldOSServer(config);
await server.start();

// Runtime operations
server.getState();                    // 'stopped' | 'starting' | 'running' | 'stopping'
server.getStatus();                   // Aggregated ServerStatus
server.getPluginStatus('my-plugin');  // PluginStatus | undefined
server.getAllPluginStatuses();        // PluginStatus[]
await server.restartPlugin('my-plugin');
await server.restart();
await server.stop();

// Access subsystems
server.getRegistry();       // PluginRegistry
server.getConfigManager();  // ConfigManager
server.getWebhookManager(); // WebhookManager
server.getLogAggregator();  // LogAggregator
server.getPluginLoader();   // PluginLoader
```

**Events:**

| Event | Payload |
|---|---|
| `server:starting` | -- |
| `server:started` | -- |
| `server:stopping` | -- |
| `server:stopped` | -- |
| `server:error` | `(error: Error)` |
| `plugin:started` | `(status: PluginStatus)` |
| `plugin:stopped` | `(status: PluginStatus)` |
| `plugin:crashed` | `(status: PluginStatus, error: Error)` |
| `plugin:health` | `(name: string, status: string)` |

### PluginRegistry

Manages installed-plugin metadata in `wos.yaml`.

```ts
const registry = server.getRegistry();
await registry.load();
await registry.register(entry);       // Add plugin
await registry.enable('my-plugin');
await registry.disable('my-plugin');
await registry.unregister('my-plugin');
registry.getAll();                     // PluginEntry[]
registry.getEnabled();                 // Enabled plugins only
registry.isEnabled('my-plugin');       // boolean
```

### ConfigManager

Loads plugin configuration from `wos.yaml` with environment variable overrides.

```ts
const configMgr = server.getConfigManager();
const config = await configMgr.loadConfig('my-plugin');
const validated = await configMgr.validateConfig('my-plugin', schema);
await configMgr.saveConfig('my-plugin', { key: 'value' });
```

Environment variable override convention: `WOS_PLUGIN_MY_PLUGIN_KEY=value` sets `config.key`. Use double underscores for nesting: `WOS_PLUGIN_MY_PLUGIN_DB__HOST=localhost` sets `config.db.host`.

### SecretManager

Resolves secret references in configuration values.

```ts
import { SecretManager } from '@worldos/server';

const secrets = new SecretManager('/path/to/server');
await secrets.resolveSecret('env:MY_API_KEY');      // reads process.env.MY_API_KEY
await secrets.resolveSecret('file:./secrets/token'); // reads file contents
const resolved = await secrets.resolveConfigSecrets(config);
```

### LogAggregator

Centralized logging with file rotation (default 10 MB, 5 rotations).

```ts
const logs = server.getLogAggregator();
logs.log('my-plugin', 'info', 'Server started');
const entries = await logs.readLogs('my-plugin', { limit: 50, level: 'error' });
const unsubscribe = logs.streamLogs('my-plugin', (entry) => { /* ... */ });
```

### WebhookManager

Sends HTTP POST notifications with optional HMAC-SHA256 signatures and retry with exponential backoff.

```ts
const webhooks = server.getWebhookManager();
webhooks.registerWebhook({ url: 'https://...', events: ['plugin.*'], secret: '...' });
```

Webhook event types: `plugin.started`, `plugin.stopped`, `plugin.crashed`, `plugin.unhealthy`, `plugin.failed`, `test`.

### Other exports

| Export | Purpose |
|---|---|
| `MosquittoBroker` | Standalone embedded broker management |
| `PluginLoader` | Direct plugin lifecycle control |
| `PluginScanner`, `scanPlugins`, `scanSinglePlugin` | Plugin directory scanning |
| `ProcessSpawner`, `spawnPlugin` | Process spawning |
| `HealthMonitor` | MQTT health check protocol |
| `RestartPolicy`, `calculateBackoffDelay` | Restart decision logic |
| `DependencyResolver` | Topological dependency sorting |
| `ManifestValidator` | `wos-plugin.yaml` validation |
| `BackupManager` | Plugin backup and rollback |
| `ConfigNotifier` | MQTT config-change notifications |
| `StartupAppManager` | Long-running sidecar app management |
| `MessageAppManager` | MQTT-triggered on-demand app management |

## Development

### Prerequisites

- Node.js >= 20
- Mosquitto installed or bundled at `mosquitto/bin/`

### Building

```bash
npm run build     # tsc
```

### Testing

```bash
npm test          # vitest run
npm run test:watch
```

### Project structure

```
src/
  server.ts                  Main WorldOSServer orchestrator
  index.ts                   Public exports
  mqtt/
    mosquitto-broker.ts      Embedded Mosquitto management
  plugin-loader/
    plugin-loader.ts         Plugin lifecycle orchestrator
    plugin-scanner.ts        Directory scanning for manifests
    process-spawner.ts       Child process spawning (node/python/binary/docker)
    health-monitor.ts        MQTT health check protocol
    restart-policy.ts        Exponential backoff + circuit breaker
    types.ts                 Shared type definitions
  plugin-registry/
    plugin-registry.ts       wos.yaml plugin state persistence
  config/
    config-manager.ts        Config loading, env overrides, schema validation
    config-notifier.ts       MQTT config change notifications
    secret-manager.ts        Secret reference resolution (env/file/vault)
  dependencies/
    dependency-resolver.ts   Topological sort for plugin ordering
  manifest/
    manifest-validator.ts    wos-plugin.yaml schema validation
  logging/
    log-aggregator.ts        Centralized logging with rotation
  webhooks/
    webhook-manager.ts       HTTP webhook dispatch with HMAC + retry
  backup/
    backup-manager.ts        Plugin backup/restore
  startup-apps/
    startup-apps.ts          Long-running sidecar process manager
  message-apps/
    message-apps.ts          MQTT-triggered on-demand process manager
```
