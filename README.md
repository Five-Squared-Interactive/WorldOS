# WorldOS

WorldOS is a plugin-based server operating system for virtual worlds. It provides a managed runtime for plugins that communicate over MQTT, with an embedded Mosquitto broker, health monitoring, automatic restart policies, and a web-based admin dashboard.

## Architecture

WorldOS is organized as a monorepo of packages under `packages/`:

| Package | npm Name | Description |
|---------|----------|-------------|
| `wos-cli` | `@worldos/cli` | Command-line interface (built on oclif). Provides the `wos` binary. |
| `wos-server` | `@worldos/server` | Core server: plugin loader, health monitor, MQTT bus, embedded Mosquitto broker, config manager, webhook dispatcher, and log aggregator. |
| `wos-admin` | `@worldos/admin` | Web administration panel served by Fastify. Provides a dashboard, plugin management, log viewer, and settings UI. Supports plugin-contributed panels. |
| `wos-protocol` | `@worldos/protocol` | Shared protocol definitions for plugin-to-server communication. |
| `wos-plugin-sdk` | -- | TypeScript SDK for authoring WorldOS plugins. |
| `wos-plugin-sdk-python` | -- | Python SDK for authoring WorldOS plugins. |
| `wos-world` | -- | World State API. |
| `wos-plugin-presence` | -- | Reference plugin: tracks online user presence. |

## Quick Start

```bash
# 1. Scaffold a new server directory
wos init ./my-server

# 2. Start the server (daemon mode)
cd my-server
wos start

# 3. Or start in foreground with live log output
wos start --foreground

# 4. Check server health
wos status

# 5. Open the admin dashboard
#    (default: http://localhost:3000)
```

## Configuration

Each server directory contains a `wos.yaml` file at its root. Below is the full structure with all sections:

```yaml
# Server settings
server:
  name: my-worldos-server
  logLevel: info          # debug | info | warn | error

# MQTT broker
# When embedded is true (default), WorldOS starts and manages
# a bundled Mosquitto broker automatically.
mqtt:
  embedded: true
  host: localhost
  port: 1883
  # websocketPort: 9001  # optional MQTT-over-WebSocket listener
  # username: mqtt-user
  # password: mqtt-pass

# Admin panel (Fastify web UI)
admin:
  enabled: true
  port: 3000
  # username: admin
  # password: (set via `wos config admin.password <value>`)
  # logo: ./my-logo.png  # custom sidebar logo (png/jpg/svg/webp)

# Plugins
# Each key matches a directory under ./plugins/.
plugins:
  hello-logger:
    enabled: true
    version: 1.0.0
    source: ./plugins/hello-logger
    config:
      logFormat: json
      logLevel: info
      outputFile: stdout

# Webhooks
# HTTP callbacks on server/plugin events. Supports HMAC-SHA256 signatures.
webhooks:
  - url: https://hooks.example.com/worldos
    events:
      - plugin.started
      - plugin.stopped
      - plugin.crashed
      - plugin.unhealthy
    secret: change-me-to-a-real-secret
```

## Plugin System

### Manifest

Every plugin contains a `wos-plugin.yaml` manifest in its root directory:

```yaml
name: hello-logger
version: 1.0.0
runtime: node                 # node | python | binary | docker
entrypoint: ./index.js
description: Logs MQTT messages to stdout

mqtt:
  subscriptions:
    - "worldos/events/#"
  publications:
    - "worldos/logs/hello-logger"

# Optional: admin panel contributed by this plugin
admin:
  panel:
    title: Hello Logger
    icon: log
    route: /hello-logger
    entrypoint: ./admin/panel.js

# Optional: config schema for validation
config:
  schema:
    type: object
    properties:
      logFormat:
        type: string
        default: json

# Optional: CLI subcommands contributed by this plugin
commands:
  - name: list
    description: List items
    usage: wos <plugin> list [--json]

# Optional: lifecycle hooks
hooks:
  onInstall: true
  onEnable: true
  onDisable: true
  onUninstall: true

# Optional: dependencies on other plugins
dependencies:
  - some-other-plugin
```

### Lifecycle

1. **Discovery** -- On startup, the server scans `./plugins/` for directories containing a `wos-plugin.yaml`.
2. **Validation** -- The manifest is validated (name, version, runtime, entrypoint are required).
3. **Spawn** -- Each enabled plugin is spawned as a child process using the runtime specified in the manifest.
4. **Health monitoring** -- The server sends periodic health-check requests over MQTT. Plugins respond to confirm they are alive.
5. **Restart policy** -- If a plugin crashes, it is automatically restarted with exponential backoff.
6. **Shutdown** -- On server stop, all plugins receive a graceful shutdown signal before being terminated.

### SDKs

- **TypeScript/Node.js** -- Use the `wos-plugin-sdk` package. Located at `packages/wos-plugin-sdk/`.
- **Python** -- Use the `wos-plugin-sdk-python` package. Located at `packages/wos-plugin-sdk-python/`. Provides MQTT client helpers, structured logging, and a base plugin class.

## Admin Dashboard

The admin panel is a web UI served on the configured port (default `3000`). It includes:

- **Dashboard** -- Overview of server health, uptime, and plugin status.
- **Plugins** -- Start, stop, and inspect individual plugins.
- **Logs** -- Live-streamed aggregated logs from all plugins.
- **Settings** -- Server and plugin configuration management.
- **Plugin panels** -- Plugins can contribute their own admin panels (declared via `admin.panel` in the plugin manifest). These appear as additional navigation items in the sidebar.
- **Custom branding** -- Set `admin.logo` in `wos.yaml` to replace the default sidebar logo.
- **Authentication** -- Optional username/password authentication via `admin.username` and `admin.password`.

## CLI Commands

The `wos` CLI is the primary interface for managing WorldOS servers.

### Server Lifecycle

| Command | Description |
|---------|-------------|
| `wos init <directory>` | Scaffold a new server directory with a default `wos.yaml` and `plugins/` folder. |
| `wos start [directory]` | Start the server. Runs as a daemon by default; use `--foreground` for interactive mode. |
| `wos stop [directory]` | Stop a running server gracefully. Use `--force` to send SIGKILL. |
| `wos restart [directory]` | Restart the server or an individual plugin. |
| `wos status` | Display server and per-plugin health status. |
| `wos logs [plugin]` | View plugin logs with filtering by level, plugin name, and follow mode. |

### Plugin Management

| Command | Description |
|---------|-------------|
| `wos add <source>` | Install a plugin from a local path, GitHub URL, Git URL, or npm. |
| `wos remove <plugin>` | Uninstall a plugin and remove it from `wos.yaml`. |
| `wos list` | List all installed plugins with version and enabled status. |
| `wos enable <plugin>` | Enable one or more disabled plugins. |
| `wos disable <plugin>` | Disable one or more enabled plugins. |
| `wos upgrade [plugin]` | Upgrade plugins to newer versions. |
| `wos rollback <plugin>` | Roll back a plugin to a previous backup. |
| `wos validate [directory]` | Validate a plugin's `wos-plugin.yaml` manifest. |

### Configuration

| Command | Description |
|---------|-------------|
| `wos config <plugin>` | View plugin configuration. |
| `wos config <plugin> <key> <value>` | Set a configuration value. |
| `wos config --reset <plugin>` | Reset plugin configuration to defaults. |

### Development

| Command | Description |
|---------|-------------|
| `wos create plugin <name>` | Scaffold a new plugin from a template (Node.js, Python, etc.). |
| `wos dev` | Start the server in development mode with hot-reload for plugins. |
| `wos test` | Run plugin tests using the built-in test harness. |
| `wos pack` | Package a plugin for distribution (tarball). |
| `wos docs` | Generate documentation from a plugin manifest. |
| `wos completion <shell>` | Generate shell completion scripts (bash, zsh, PowerShell). |

### Webhooks

| Command | Description |
|---------|-------------|
| `wos webhook test` | Send a test event to configured webhook endpoints. |

## Development

### Prerequisites

- Node.js 20+
- pnpm (package manager)

### Building

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm -r build

# Run tests across all packages
pnpm -r test
```

### Testing

All packages use [Vitest](https://vitest.dev/) as the test runner. Tests are co-located alongside source files (e.g., `start.test.ts` next to `start.ts`).

```bash
# Run tests for a specific package
cd packages/wos-server
pnpm test

# Watch mode
pnpm test:watch
```

### Monorepo Structure

```
WorldOS/
  packages/
    wos-cli/              # CLI (bin: wos)
    wos-server/           # Core server runtime
    wos-admin/            # Web admin panel
    wos-protocol/         # Shared protocol types
    wos-plugin-sdk/       # TypeScript plugin SDK
    wos-plugin-sdk-python/# Python plugin SDK
    wos-world/            # World State API
    wos-plugin-presence/  # Reference plugin
  sample/
    wos.yaml              # Example server configuration
    plugins/
      hello-logger/       # Example plugin
      http-health/        # Example health-check plugin
```
