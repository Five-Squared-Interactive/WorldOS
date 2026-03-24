# WorldOS

WorldOS is a plugin-based server operating system for virtual worlds. It provides a managed runtime for plugins that communicate over MQTT, with an embedded Mosquitto broker, health monitoring, automatic restart policies, and a web-based admin dashboard.

## Prerequisites

- **Node.js 20+** (tested with Node 24)
- **Visual Studio Build Tools** with the **"Desktop development with C++"** workload (required by `better-sqlite3` on Windows). On macOS/Linux, `python3`, `make`, and a C++ compiler are sufficient.

## Quick Start

```bash
# Clone and enter the WorldOS directory
cd WorldHub/MyWorldsServer/src/WorldOS

# Install all dependencies (npm workspaces)
npm install

# Rebuild native modules (better-sqlite3, bcrypt)
npm rebuild

# Build every package (SDK → core → plugins)
npm run build

# Install the wos CLI globally
npm link --workspace=@worldos/cli

# Launch the demo server with 3 plugins + admin panel
wos start demo --foreground
```

The demo starts the WorldOS server with the **Identity**, **Messaging**, and **World Manager** plugins, plus the web admin dashboard at **http://localhost:3000**.

Press `Ctrl+C` to stop.

You can also run the demo via npm:
```bash
npm run demo
```

## Architecture

WorldOS is organized as an npm workspace monorepo under `packages/`:

### Core Packages

| Package | npm Name | Description |
|---------|----------|-------------|
| `wos-server` | `@worldos/server` | Core server: plugin loader, health monitor, MQTT bus, embedded Mosquitto broker, config manager, webhook dispatcher, and log aggregator. |
| `wos-admin` | `@worldos/admin` | Web administration panel (Fastify). Dashboard, plugin management, logs, settings, and plugin-contributed panels. |
| `wos-cli` | `@worldos/cli` | Command-line interface (oclif). Provides the `wos` binary. |
| `wos-protocol` | `@worldos/protocol` | Shared protocol definitions for plugin-to-server communication. |
| `wos-world` | `@worldos/world` | World State API — entities, templates, terrain, assets. |

### SDKs

| Package | Description |
|---------|-------------|
| `wos-plugin-sdk` | TypeScript SDK for authoring WorldOS plugins. Pre-built (no source compilation needed). |
| `wos-plugin-sdk-python` | Python SDK for authoring WorldOS plugins. |

### Plugins

| Package | npm Name | Description |
|---------|----------|-------------|
| `wos-plugin-identity` | `@worldos/plugin-identity` | User authentication, JWT tokens, RBAC permissions. Has admin panel. |
| `wos-plugin-messaging` | `@worldos/plugin-messaging` | Channels, DMs, message history. Has admin panel. |
| `wos-plugin-world-manager` | `@worldos/plugin-world-manager` | World metadata, entity CRUD, templates. Has admin panel. |
| `wos-plugin-presence` | `@worldos/plugin-presence` | Tracks online user presence. |
| `wos-plugin-asset-manager` | `@worldos/plugin-asset-manager` | Asset storage, metadata management, retrieval. |
| `wos-plugin-container-manager` | `@worldos/plugin-container-manager` | Docker container lifecycle, scaling, port allocation. |

## npm Scripts

Run these from the `WorldOS/` root directory:

| Script | Description |
|--------|-------------|
| `npm install` | Install all workspace dependencies. |
| `npm run build` | Build SDK, then core packages, then all plugins (in dependency order). |
| `npm run build:core` | Build only core packages (protocol, server, admin, cli, world). |
| `npm run build:plugins` | Build only plugins. |
| `npm run demo` | Start the demo server with Identity, Messaging, and World Manager plugins. |

## Configuration

Each server directory contains a `wos.yaml` file at its root:

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

# Admin panel (Fastify web UI)
admin:
  enabled: true
  port: 3000

# Plugins
# Each key matches a directory under ./plugins/.
plugins:
  identity:
    enabled: true
    source: ./plugins/identity
    config:
      allowRegistration: true
      jwtSecret: change-me

  messaging:
    enabled: true
    source: ./plugins/messaging

  world-manager:
    enabled: true
    source: ./plugins/world-manager

# Webhooks (optional)
webhooks:
  - url: https://hooks.example.com/worldos
    events: [plugin.started, plugin.stopped, plugin.crashed]
    secret: change-me-to-a-real-secret
```

## Plugin System

### Manifest

Every plugin contains a `wos-plugin.yaml` manifest:

```yaml
name: my-plugin
version: 1.0.0
runtime: node                 # node | python | binary | docker
entrypoint: ./dist/index.js
description: My custom plugin

mqtt:
  subscriptions:
    - "wos/my-plugin/#"
  publications:
    - "wos/my-plugin/events"

# Optional: admin panel
admin:
  panel:
    title: My Plugin
    icon: puzzle
    route: /my-plugin
    entrypoint: ./admin/panel.js

# Optional: config schema
config:
  schema:
    type: object
    properties:
      myOption:
        type: string
        default: hello
```

### Lifecycle

1. **Discovery** — On startup, the server scans `./plugins/` for directories containing a `wos-plugin.yaml`.
2. **Validation** — The manifest is validated (name, version, runtime, entrypoint are required).
3. **Spawn** — Each enabled plugin is spawned as a child process.
4. **Health monitoring** — Periodic health-check requests over MQTT. Plugins respond to confirm they are alive.
5. **Restart policy** — If a plugin crashes, it is automatically restarted with exponential backoff.
6. **Shutdown** — On server stop, all plugins receive a graceful shutdown signal.

### Writing a Plugin (TypeScript)

```typescript
import { WOSPlugin, PluginContext, HealthCheckResult } from '@worldos/plugin-sdk';

class MyPlugin extends WOSPlugin {
  async onStart(context: PluginContext) {
    context.logger.info('Plugin started');

    // Subscribe to MQTT topics
    await context.mqtt.subscribeWithHandler('wos/my-plugin/command', (msg) => {
      const payload = msg.payload;
      // Handle message...
      context.mqtt.publishRaw('wos/my-plugin/response', { result: 'ok' });
    });
  }

  async onStop() {
    // Cleanup resources
  }

  async onHealthCheck(): Promise<HealthCheckResult> {
    return { status: 'ok' };
  }
}

export const plugin = new MyPlugin();
```

## Admin Dashboard

The admin panel is served at `http://localhost:3000` (configurable). It includes:

- **Dashboard** — Server health, uptime, plugin status overview.
- **Plugins** — Start, stop, and inspect individual plugins.
- **Logs** — Live-streamed aggregated logs from all plugins.
- **Settings** — Server and plugin configuration management.
- **Plugin panels** — Plugins contribute their own admin panels (Identity, Messaging, World Manager each have one). These appear as additional navigation items.

Plugin panels communicate with their backend plugin processes over MQTT via a WebSocket bridge built into the admin server.

## CLI Commands

### Server Lifecycle

| Command | Description |
|---------|-------------|
| `wos init <directory>` | Scaffold a new server directory with default `wos.yaml` and `plugins/` folder. |
| `wos start [directory]` | Start the server. Daemon by default; `--foreground` for interactive mode. |
| `wos stop [directory]` | Stop a running server gracefully. `--force` for SIGKILL. |
| `wos restart [directory]` | Restart the server or an individual plugin. |
| `wos status` | Display server and per-plugin health. |
| `wos logs [plugin]` | View plugin logs. Supports `--level`, `--follow`. |

### Plugin Management

| Command | Description |
|---------|-------------|
| `wos add <source>` | Install a plugin from local path, GitHub, Git URL, or npm. |
| `wos remove <plugin>` | Uninstall a plugin. |
| `wos list` | List installed plugins. |
| `wos enable <plugin>` | Enable a plugin. |
| `wos disable <plugin>` | Disable a plugin. |
| `wos upgrade [plugin]` | Upgrade plugins. |
| `wos validate [directory]` | Validate a plugin manifest. |

### Configuration

| Command | Description |
|---------|-------------|
| `wos config <plugin>` | View plugin config. |
| `wos config <plugin> <key> <value>` | Set a config value. |
| `wos config --reset <plugin>` | Reset to defaults. |

### Development

| Command | Description |
|---------|-------------|
| `wos create plugin <name>` | Scaffold a new plugin from template. |
| `wos dev` | Dev mode with hot-reload. |
| `wos test` | Run plugin tests. |
| `wos pack` | Package a plugin for distribution. |

## Monorepo Structure

```
WorldOS/
  package.json              # Workspace root — npm scripts: build, demo
  packages/
    wos-server/             # Core server runtime
    wos-admin/              # Web admin panel (Fastify + vanilla JS SPA)
    wos-cli/                # CLI (bin: wos)
    wos-protocol/           # Shared protocol types
    wos-world/              # World State API
    wos-plugin-sdk/         # TypeScript plugin SDK (pre-built)
    wos-plugin-sdk-python/  # Python plugin SDK
    wos-plugin-identity/    # Identity plugin (auth, JWT, users)
    wos-plugin-messaging/   # Messaging plugin (channels, DMs)
    wos-plugin-world-manager/ # World Manager plugin (entities, templates)
    wos-plugin-presence/    # Presence plugin (online users)
    wos-plugin-asset-manager/ # Asset Manager plugin
    wos-plugin-container-manager/ # Container Manager plugin
  assets/                   # Logos and icons
  sample/                   # Example server configuration
  tests/                    # Cross-package integration tests
```

## Troubleshooting

### `better-sqlite3` fails to build

This native module requires C++ build tools:
- **Windows**: Install Visual Studio with the "Desktop development with C++" workload.
- **macOS**: `xcode-select --install`
- **Linux**: `sudo apt install build-essential python3`

Then run `npm rebuild better-sqlite3`.

### Mosquitto port conflict

If the demo fails with "Mosquitto exited with code 1", another process is using port 1884. Find and kill it:

```bash
# Check what's on port 1884
netstat -ano | grep 1884

# Kill the process (Windows)
taskkill /F /PID <pid>
```

### Stale PID file

If the server won't start because it thinks another instance is running, delete the `.wos.pid` file in the server directory.
