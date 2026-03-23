# WorldOS Plugin SDK - TypeScript/JavaScript

TypeScript/JavaScript SDK for building WorldOS plugins with MQTT communication, lifecycle hooks, and health monitoring.

## Installation

```bash
npm install @worldos/plugin-sdk
```

## Quick Start

Create a simple plugin by extending the `WOSPlugin` base class:

```typescript
import { WOSPlugin, PluginContext, HealthCheckResult } from '@worldos/plugin-sdk';

class MyPlugin extends WOSPlugin {
  async onStart(context: PluginContext): Promise<void> {
    context.logger.info('Plugin started!');

    // Subscribe to events
    await context.mqtt.subscribeWithHandler('wos/events/+', (message) => {
      context.logger.info('Received event', { topic: message.topic });
    });
  }

  async onStop(): Promise<void> {
    this.context?.logger.info('Plugin stopped');
  }

  async onHealthCheck(): Promise<HealthCheckResult> {
    return { status: 'ok' };
  }
}

const plugin = new MyPlugin();
plugin.start();
```

For a plain JavaScript example without the SDK base class, see the `sample/plugins/hello-logger` directory.

## Plugin Manifest

Every plugin requires a `wos-plugin.yaml` manifest file in its root directory:

```yaml
name: my-plugin
displayName: My Plugin
version: 1.0.0
runtime: node                  # node | python | binary | docker
entrypoint: ./dist/index.js
description: A brief description of the plugin
author: Your Name

# Optional: declare MQTT topics this plugin uses
mqtt:
  subscriptions:
    - "wos/events/#"
  publications:
    - "wos/plugin/my-plugin/status"

# Optional: configuration schema
config:
  schema:
    type: object
    properties:
      myOption:
        type: string
        description: An example config option
        default: "hello"

# Optional: admin panel (see Admin Panels section)
admin:
  panel:
    title: My Plugin
    icon: settings
    route: /my-plugin
    entrypoint: ./admin/panel.js
  dashboard:
    card:
      title: My Plugin Status
      component: ./admin/card.js
      width: 1

# Optional: CLI commands
commands:
  - name: status
    description: Show plugin status
    usage: wos my-plugin status [--json]

# Optional: dependencies on other plugins
dependencies:
  - some-other-plugin

# Optional: lifecycle hook flags
hooks:
  onInstall: true
  onEnable: true
  onDisable: true
  onUninstall: true
```

### Required Fields

| Field          | Type   | Description                                |
|----------------|--------|--------------------------------------------|
| `name`         | string | Unique plugin identifier (kebab-case)      |
| `version`      | string | Semantic version                           |
| `runtime`      | string | One of `node`, `python`, `binary`, `docker`|
| `entrypoint`   | string | Path to the entry file                     |

### Optional Fields

| Field              | Type   | Description                                    |
|--------------------|--------|------------------------------------------------|
| `displayName`      | string | Human-readable name                            |
| `description`      | string | Brief description                              |
| `author`           | string | Author name                                    |
| `dependencies`     | array  | Other plugins this plugin depends on           |
| `environment`      | object | Environment variable defaults                  |
| `workingDirectory` | string | Working directory override                     |
| `mqtt`             | object | Declared MQTT subscriptions and publications   |
| `config`           | object | Configuration schema                           |
| `admin`            | object | Admin panel and dashboard card configuration   |
| `commands`         | array  | CLI commands the plugin provides               |
| `hooks`            | object | Lifecycle hook flags                           |

## API Reference

### WOSPlugin

Abstract base class for all plugins. Extend this class and implement three required methods:

```typescript
abstract onStart(context: PluginContext): Promise<void>;
abstract onStop(): Promise<void>;
abstract onHealthCheck(): Promise<HealthCheckResult>;
```

#### Constructor

```typescript
const plugin = new MyPlugin(options?: WOSPluginOptions);
```

`WOSPluginOptions`:

| Property       | Type             | Description                                   |
|----------------|------------------|-----------------------------------------------|
| `manifest`     | `PluginManifest` | Override manifest (defaults to env-based)      |
| `config`       | `Record<string, unknown>` | Plugin configuration key-value pairs |
| `mqttOptions`  | `{ url?, autoConnect? }` | MQTT connection overrides             |

#### Properties

| Property    | Type                    | Description                              |
|-------------|-------------------------|------------------------------------------|
| `isRunning` | `boolean`               | Whether the plugin is currently running  |
| `context`   | `PluginContext \| null`  | Context object (available after `start`) |
| `manifest`  | `PluginManifest`        | The plugin manifest                      |

#### Methods

| Method          | Returns                      | Description                    |
|-----------------|------------------------------|--------------------------------|
| `start()`       | `Promise<void>`              | Start the plugin               |
| `stop()`        | `Promise<void>`              | Stop the plugin                |
| `checkHealth()` | `Promise<HealthCheckResult>` | Run health check (catches errors) |

#### Events

`WOSPlugin` extends `EventEmitter` and emits:

- `started` -- after `onStart` completes
- `stopped` -- after `onStop` completes

### PluginContext

Context object passed to `onStart`. Available via `this.context` after start.

| Property   | Type               | Description                              |
|------------|--------------------|------------------------------------------|
| `logger`   | `Logger`           | Structured logger with plugin name prefix|
| `config`   | `Record<string, unknown>` | Plugin configuration              |
| `mqtt`     | `PluginMqttClient` | MQTT client for communication            |
| `manifest` | `PluginManifest`   | Plugin manifest                          |

### HealthCheckResult

```typescript
interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'unhealthy';
  details?: Record<string, unknown>;
  error?: string;
}
```

## Lifecycle Hooks

Plugin lifecycle follows this sequence:

1. **Construction** -- `new MyPlugin(options)` creates the plugin instance and builds the manifest.
2. **Start** (`plugin.start()`) -- Creates the MQTT client, connects to the broker, builds the `PluginContext`, then calls your `onStart(context)` method.
3. **Running** -- Plugin is active. Health checks call `onHealthCheck()` periodically. If `onHealthCheck` throws, the result is automatically wrapped as `{ status: 'unhealthy', error: '...' }`.
4. **Stop** (`plugin.stop()`) -- Calls your `onStop()` method, then disconnects the MQTT client and clears the context.

```
constructor -> start() -> onStart(ctx) -> [running] -> stop() -> onStop() -> [stopped]
                                             |
                                      onHealthCheck()
```

## MQTT Communication

The `PluginMqttClient` handles all pub/sub messaging. It is available as `context.mqtt` after start.

### Topic Namespacing

Methods like `subscribe()`, `unsubscribe()`, and `publish()` automatically prefix topics with `wos/plugin/<pluginName>/`. Use `subscribeRaw()` and `publishRaw()` to work with arbitrary topics.

```typescript
// Subscribes to "wos/plugin/my-plugin/events/click"
await context.mqtt.subscribe('events', 'click');

// Subscribes to the exact topic "wos/events/user-joined"
await context.mqtt.subscribeRaw('wos/events/user-joined');
```

### Publishing Messages

```typescript
// Publish within plugin namespace
await context.mqtt.publish(['status'], { online: true });

// Publish to arbitrary topic
await context.mqtt.publishRaw('wos/events/custom', { data: 'value' });
```

### Subscribing with Handlers

```typescript
await context.mqtt.subscribeWithHandler<MyPayload>(
  'wos/events/+',
  (message) => {
    console.log(message.topic);    // "wos/events/click"
    console.log(message.payload);  // MyPayload object
    console.log(message.timestamp); // number
  }
);
```

MQTT wildcard patterns (`+` for single level, `#` for multi-level) are supported in topic subscriptions.

### Request/Response Pattern

```typescript
const response = await context.mqtt.request<RequestPayload, ResponseData>(
  'wos/service/api',
  { action: 'getData' },
  { timeout: 5000 }  // optional, default 30000ms
);

if (response.success) {
  console.log(response.data);
} else {
  console.error(response.error?.message);
}
```

To respond to incoming requests:

```typescript
await context.mqtt.respond(responseTopic, correlationId, { result: 'ok' });
await context.mqtt.respondError(responseTopic, correlationId, 'NOT_FOUND', 'Item not found');
```

### Message Types

```typescript
interface PluginMessage<T = unknown> {
  topic: string;
  payload: T;
  timestamp: number;
}

interface ResponseMessage<T = unknown> {
  correlationId: string;
  timestamp: number;
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}
```

### MQTT Client Properties

| Property          | Type       | Description                    |
|-------------------|------------|--------------------------------|
| `isConnected`     | `boolean`  | Connection status              |
| `clientId`        | `string`   | MQTT client ID                 |
| `pluginName`      | `string`   | Plugin name from environment   |
| `url`             | `string`   | Broker URL                     |
| `subscribedTopics`| `string[]` | Currently subscribed topics    |

### MQTT Client Events

- `connected` -- Successfully connected to broker
- `disconnected` -- Disconnected from broker
- `reconnecting` -- Attempting to reconnect
- `message` -- Any incoming message (raw `PluginMessage`)
- `error` -- Connection or handler error

## Admin Panels

Plugins can declare admin panels in their manifest to appear in the WorldOS admin dashboard.

```yaml
admin:
  panel:
    title: My Plugin
    icon: settings           # Icon name for the sidebar
    route: /my-plugin        # URL route in the admin UI
    entrypoint: ./admin/panel.js  # Panel component entry file
  dashboard:
    card:
      title: Plugin Status
      component: ./admin/card.js  # Dashboard card component
      width: 1                    # Card width (grid units)
```

The `panel` section registers a full page in the admin sidebar. The `dashboard.card` section adds a summary card to the admin dashboard home page.

## Logging

The SDK provides structured logging with configurable levels.

```typescript
// Logger is available via context
context.logger.info('Something happened', { key: 'value' });
context.logger.debug('Debug details');
context.logger.warn('Warning message');
context.logger.error('Error occurred', { error: err });

// Create a child logger with a sub-prefix
const childLogger = context.logger.child('subsystem');
childLogger.info('From subsystem'); // [my-plugin:subsystem] From subsystem

// Set log level per-logger
context.logger.setLevel('debug');
```

Log output format:

```
2025-01-15T12:00:00.000Z INFO [my-plugin] Something happened {"key":"value"}
```

### Global Log Level

```typescript
import { setGlobalLogLevel, getGlobalLogLevel } from '@worldos/plugin-sdk';

setGlobalLogLevel('debug'); // 'debug' | 'info' | 'warn' | 'error' | 'silent'
```

### Standalone Logger

```typescript
import { createLogger } from '@worldos/plugin-sdk';

const logger = createLogger('my-module', { level: 'debug' });
logger.info('Hello');
```

## Error Handling

The SDK provides typed error classes for common failure modes:

| Class                | Code             | Use Case                      |
|----------------------|------------------|-------------------------------|
| `PluginError`        | (custom)         | Base class for all SDK errors |
| `ConfigurationError` | `ERR_CONFIG`     | Missing or invalid config     |
| `ConnectionError`    | `ERR_CONNECTION` | MQTT connection failures      |
| `TimeoutError`       | `ERR_TIMEOUT`    | Operation timeouts            |
| `ValidationError`    | `ERR_VALIDATION` | Input validation failures     |

### Utilities

```typescript
import { isPluginError, wrapError, PluginError } from '@worldos/plugin-sdk';

try {
  await riskyOperation();
} catch (err) {
  if (isPluginError(err)) {
    console.error(err.code, err.message);
  }

  // Wrap any error as a PluginError
  const wrapped = wrapError(err, 'ERR_CUSTOM');
  console.error(wrapped.toJSON());
}
```

## Environment Variables

The SDK reads the following environment variables, set automatically by the WorldOS server when launching plugins:

| Variable             | Description                        | Default              |
|----------------------|------------------------------------|----------------------|
| `WOS_PLUGIN_NAME`    | Plugin name (used for MQTT topics) | `unknown-plugin`     |
| `WOS_MQTT_URL`       | MQTT broker URL                    | *(required)*         |
| `WOS_MQTT_HOST`      | MQTT broker hostname               | `localhost`          |
| `WOS_MQTT_PORT`      | MQTT broker port                   | `1883`               |
| `WOS_PLUGIN_VERSION` | Plugin version                     | --                   |
| `WOS_SERVER_DIR`     | WorldOS server directory           | `.`                  |

Plugins can also define custom environment variables in the manifest `environment` field.

## Development

```bash
# Install dependencies
npm install

# Build (if using TypeScript)
npm run build

# Run tests
npm test

# Run the plugin locally (set required env vars)
WOS_PLUGIN_NAME=my-plugin WOS_MQTT_URL=mqtt://localhost:1883 node dist/index.js
```

### Project Structure

A typical plugin project looks like:

```
my-plugin/
  wos-plugin.yaml       # Plugin manifest (required)
  package.json
  tsconfig.json
  src/
    index.ts            # Plugin entry point
  admin/
    panel.js            # Admin panel component (optional)
    card.js             # Dashboard card component (optional)
  dist/                 # Compiled output
```

## License

MIT
