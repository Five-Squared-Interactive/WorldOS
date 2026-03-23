# @worldos/admin

Fastify-based web administration server for WorldOS. Provides a dashboard UI, plugin management, log viewing, settings, extensible plugin panels, authentication, and an MQTT-WebSocket bridge for real-time updates.

## Features

- **Dashboard** -- Aggregated server status, plugin health, and configuration summary.
- **Plugin Management** -- List, enable, disable, start, stop, and restart plugins. View per-plugin configuration.
- **Log Viewer** -- Query and filter logs by level, plugin, and time range. Merges file-based and in-memory log buffers.
- **Settings** -- View and update server and plugin configuration via REST.
- **Plugin Panels** -- Plugins can ship custom admin UI panels that are dynamically loaded into the SPA shell.
- **Authentication** -- Optional username/password auth with bcrypt-hashed credentials and session tokens. Falls back to open-access mode when no credentials are configured.
- **MQTT-WebSocket Bridge** -- Bridges MQTT topics to browser WebSocket connections so panels and the dashboard can receive real-time messages.
- **Custom Logo** -- Override the default WorldOS branding with your own image.

## Configuration

The admin server reads its settings from the `admin` section of `wos.yaml`:

```yaml
admin:
  port: 8080            # HTTP listen port (default: 8080)
  host: 0.0.0.0         # Bind address (default: 0.0.0.0)
  username: admin        # Admin username (omit for open-access mode)
  password: <bcrypt>     # Bcrypt-hashed password
  logo: /path/to/logo.png  # Absolute path to a custom logo image
```

When `username` and `password` are omitted, the server runs in **open-access mode** -- all requests are allowed without authentication.

## API Reference

### Public Endpoints (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check. Returns server status, auth mode, and feature flags. |
| `GET` | `/api/status` | Server status including PID, uptime, and version. |

### Auth Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/login` | Authenticate with `{ username, password }`. Returns a bearer token and expiry. |
| `POST` | `/api/auth/logout` | Invalidate the current session token. |
| `GET` | `/api/auth/session` | Return current session info (username, authenticated status). |

### Protected Endpoints (bearer token required)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/dashboard` | Aggregated dashboard data: server status, plugin counts, config summary. |
| `GET` | `/api/plugins` | List all registered plugins with merged runtime status. |
| `GET` | `/api/plugins/:name` | Get details and runtime state for a single plugin. |
| `POST` | `/api/plugins/:name/enable` | Enable a plugin in the registry. |
| `POST` | `/api/plugins/:name/disable` | Disable a plugin in the registry. |
| `POST` | `/api/plugins/:name/start` | Start a plugin process via the plugin loader. |
| `POST` | `/api/plugins/:name/stop` | Stop a running plugin process. |
| `POST` | `/api/plugins/:name/restart` | Restart a running plugin process. |
| `GET` | `/api/panels` | List registered plugin admin panels. |
| `GET` | `/api/config` | Server configuration (port, host). |
| `GET` | `/api/config/plugins/:name` | Get configuration for a specific plugin. |
| `PUT` | `/api/config/plugins/:name` | Update configuration for a specific plugin (JSON body). |
| `GET` | `/api/logs` | Query logs. Query params: `limit` (default 200), `level`, `since` (epoch ms). |

### WebSocket

| Path | Description |
|------|-------------|
| `GET /ws?token=<token>` | WebSocket endpoint for real-time updates. Requires a valid session token as a query parameter. |

WebSocket clients communicate with JSON messages:

```jsonc
// Subscribe to an MQTT topic
{ "action": "subscribe", "topic": "wos/some/topic" }

// Unsubscribe
{ "action": "unsubscribe", "topic": "wos/some/topic" }

// Publish a message
{ "action": "publish", "topic": "wos/some/topic", "payload": { ... } }

// Keepalive
{ "action": "ping" }
```

Topics must start with the configured prefix (default `wos/`).

## Plugin Panels

Plugins can declare a custom admin panel in their `wos-plugin.yaml` manifest:

```yaml
admin:
  panel:
    title: Hello Logger        # Display name shown in the sidebar
    icon: log                  # Icon identifier
    route: /hello-logger       # URL route within the admin SPA
    entrypoint: ./admin/panel.js  # Path to the panel JS module (relative to plugin root)
```

### Mount / Unmount Contract

A panel module must export a `mount` function and may optionally export an `unmount` function:

```js
// mount(container: HTMLElement, context: PanelContext): void | Promise<void>
export function mount(el, context) {
  // Render your panel UI into `el`.
  // Use `context` for API calls, MQTT pub/sub, and config access.
}

// unmount(): void | Promise<void>  (optional)
export function unmount() {
  // Clean up timers, subscriptions, and DOM references.
}
```

### PanelContext

The `context` object passed to `mount` provides:

| Property | Type | Description |
|----------|------|-------------|
| `context.mqtt.subscribe(topic, cb)` | Function | Subscribe to an MQTT topic. Callback receives the parsed payload. |
| `context.mqtt.unsubscribe(topic)` | Function | Unsubscribe from a topic. |
| `context.mqtt.publish(topic, payload)` | Function | Publish a message to an MQTT topic. |
| `context.api.get(url)` | Function | Authenticated GET request to the admin API. |
| `context.api.post(url, data)` | Function | Authenticated POST request. |
| `context.api.put(url, data)` | Function | Authenticated PUT request. |
| `context.api.delete(url)` | Function | Authenticated DELETE request. |
| `context.config` | Object | Plugin configuration key-value pairs. |

See `sample/plugins/hello-logger/admin/panel.js` for a complete working example.

## Custom Logo

To replace the default WorldOS logo in the admin sidebar, set the `customLogoPath` option (or the `admin.logo` field in `wos.yaml`) to an absolute path pointing to a PNG, JPEG, SVG, or WebP image. The server registers a `/logo.png` route that serves the custom file with the appropriate content type.

## Authentication

### Open-Access Mode

When no credentials are configured (`AuthManager.hasCredentials()` returns `false`), all protected endpoints are accessible without a token. Requests are implicitly assigned the username `admin`.

### Credential Mode

1. Configure a username and bcrypt-hashed password via `AuthManager.setCredentials()` or the `wos.yaml` admin section.
2. Call `POST /api/auth/login` with `{ username, password }` to obtain a bearer token.
3. Include the token in subsequent requests as `Authorization: Bearer <token>`.
4. Sessions expire after 24 hours by default (configurable via `sessionDurationMs`).
5. Call `POST /api/auth/logout` to invalidate a session early.

## Development

### Prerequisites

- Node.js 20+
- This package is part of the WorldOS monorepo.

### Scripts

```bash
npm run build        # Compile TypeScript (tsc)
npm run test         # Run tests with Vitest
npm run test:watch   # Run tests in watch mode
```

### Key Dependencies

- **fastify** -- HTTP server
- **@fastify/websocket** -- WebSocket support
- **@fastify/static** -- Static file serving and SPA fallback
- **@fastify/cors** -- Cross-origin request handling
- **@fastify/cookie** -- Cookie support
- **bcrypt** -- Password hashing
- **yaml** -- YAML config parsing

## Exports

The package exports the following for programmatic use:

### Server

- `createAdminServer(options?: AdminServerOptions): Promise<FastifyInstance>` -- Create and configure a Fastify instance without starting it.
- `startAdminServer(options?: AdminServerOptions): Promise<FastifyInstance>` -- Create and start the server on the configured port.
- `AdminServerOptions` -- Configuration interface (port, host, CORS, auth manager, MQTT client, panels, custom logo path, and integration hooks for plugin registry / config manager / plugin loader / log aggregator).

### Auth

- `AuthManager` -- Manages credentials and sessions.
- `AuthManagerOptions` -- Constructor options (session duration, salt rounds).
- `Session` -- Session data interface (token, username, timestamps).
- `hashPassword(password, saltRounds?)` -- Hash a plaintext password with bcrypt.
- `verifyPassword(password, hash)` -- Verify a password against a bcrypt hash.
- `generateSessionToken()` -- Generate a cryptographically secure 64-character hex token.

### Dashboard

- `Dashboard` -- Aggregates server/plugin status from the filesystem and config.
- `DashboardOptions` -- Constructor options (serverDir, refreshInterval).
- `DashboardData` -- Full dashboard payload type.
- `PluginStatus` -- Per-plugin status type.

### MQTT Bridge

- `MQTTBridge` -- Bridges MQTT messages to/from WebSocket clients.
- `MQTTBridgeOptions` -- Constructor options (mqttClient, topicPrefix).
- `MQTTClient` -- Minimal MQTT client interface the bridge expects.
- `WebSocketClient` -- WebSocket client interface.

### Panel Loader

- `PanelLoader` -- Dynamically loads and manages plugin admin panels in the browser.
- `PanelLoaderOptions` -- Constructor options (PanelContext).
- `PanelContext` -- Context provided to panel mount functions (MQTT, API, config).
- `PanelModule` -- Panel module interface (mount, unmount).
- `PanelInfo` -- Panel registration metadata (name, displayName, entryPoint, icon, route).
