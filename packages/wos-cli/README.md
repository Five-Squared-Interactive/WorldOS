# @worldos/cli

Command-line interface for managing WorldOS servers and plugins. Built on [oclif](https://oclif.io/).

## Installation

```bash
npm install @worldos/cli
```

Once installed, the `wos` binary is available:

```bash
wos --help
```

## Commands

### Server Lifecycle

#### `wos init`

Initialize a new WorldOS server directory. Creates `wos.yaml`, a `plugins/` directory, and a `.gitignore`.

```bash
wos init                              # Initialize current directory
wos init my-server                    # Initialize a named directory
wos init ./servers/prod --name prod   # Specify server name explicitly
wos init --force                      # Overwrite existing config files
```

| Flag | Short | Description |
|------|-------|-------------|
| `--name` | `-n` | Server name (defaults to directory name) |
| `--force` | `-f` | Overwrite existing configuration files |
| `--json` | | Output in JSON format |

#### `wos start`

Start the WorldOS server and all enabled plugins. Runs as a background daemon by default.

```bash
wos start                        # Start as daemon
wos start --foreground           # Run in foreground (Ctrl+C to stop)
wos start --log-level debug      # Override log level
wos start ./my-server            # Start from a specific directory
```

| Flag | Short | Description |
|------|-------|-------------|
| `--foreground` | `-f` | Run in foreground (do not daemonize) |
| `--log-level` | `-l` | Log level: `debug`, `info`, `warn`, `error` |
| `--json` | | Output in JSON format |

When started in foreground mode, the server also launches the admin panel if `admin.enabled` is `true` in `wos.yaml`.

#### `wos stop`

Stop the WorldOS server gracefully via SIGTERM. Falls back to SIGKILL with `--force`.

```bash
wos stop                         # Graceful shutdown
wos stop --force                 # Force kill if graceful fails
wos stop --timeout 30000         # Wait up to 30 seconds
wos stop ./my-server             # Stop server in a specific directory
```

| Flag | Short | Description |
|------|-------|-------------|
| `--force` | `-f` | Force kill if graceful shutdown fails |
| `--timeout` | `-t` | Timeout in milliseconds for graceful shutdown (default: 10000) |
| `--json` | | Output in JSON format |

#### `wos restart`

Restart the entire server or a single plugin.

```bash
wos restart                      # Full server restart
wos restart --plugin my-plugin   # Restart only a specific plugin
wos restart --force              # Force kill before restarting
wos restart ./my-server          # Restart server in a specific directory
```

| Flag | Short | Description |
|------|-------|-------------|
| `--plugin` | `-p` | Restart only a specific plugin |
| `--force` | `-f` | Force kill if graceful shutdown fails |
| `--timeout` | `-t` | Timeout in milliseconds (default: 10000) |
| `--json` | | Output in JSON format |

#### `wos status`

Display server and plugin status. Supports continuous watch mode with auto-refresh.

```bash
wos status                           # One-shot status
wos status --json                    # JSON output
wos status --watch                   # Continuous refresh
wos status --watch --interval 5      # Refresh every 5 seconds
wos status --directory ./my-server   # Check a specific directory
```

| Flag | Short | Description |
|------|-------|-------------|
| `--directory` | `-d` | Server directory (default: current directory) |
| `--watch` | `-w` | Watch mode -- refresh continuously |
| `--interval` | `-i` | Refresh interval in seconds (default: 2) |
| `--no-color` | | Disable colored output |
| `--json` | | Output in JSON format |

---

### Plugin Management

#### `wos add`

Install a plugin from a local path, GitHub repository, Git URL, or npm.

```bash
wos add ./my-plugin                          # Local path
wos add ./my-plugin --enable                 # Install and enable immediately
wos add github:user/repo                     # GitHub shorthand
wos add github:user/repo#v1.0.0             # Pinned to a tag/branch
wos add git:https://github.com/user/repo.git
wos add npm:@worldos/plugin-example          # npm registry
```

| Flag | Short | Description |
|------|-------|-------------|
| `--directory` | `-d` | Server directory (default: current directory) |
| `--force` | `-f` | Overwrite existing plugin |
| `--enable` | `-e` | Enable plugin immediately after installation |
| `--json` | | Output in JSON format |

The plugin must contain a valid `wos-plugin.yaml` manifest with `name`, `version`, `runtime`, and `entrypoint` fields.

#### `wos remove`

Uninstall a plugin. Checks for dependents before removal.

```bash
wos remove my-plugin               # Remove plugin
wos remove my-plugin --force       # Remove even if other plugins depend on it
wos remove my-plugin --dry-run     # Preview without making changes
```

| Flag | Short | Description |
|------|-------|-------------|
| `--directory` | `-d` | Server directory (default: current directory) |
| `--force` | `-f` | Force removal even if other plugins depend on it |
| `--dry-run` | | Show what would happen without making changes |
| `--json` | | Output in JSON format |

#### `wos list`

List all installed plugins with version, status, and description.

```bash
wos list                  # All plugins
wos list --enabled        # Only enabled plugins
wos list --disabled       # Only disabled plugins
wos list --json           # JSON output
```

| Flag | Short | Description |
|------|-------|-------------|
| `--directory` | `-d` | Server directory (default: current directory) |
| `--enabled` | | Show only enabled plugins |
| `--disabled` | | Show only disabled plugins |
| `--json` | | Output in JSON format |

#### `wos enable`

Enable one or more plugins. Accepts multiple plugin names.

```bash
wos enable my-plugin
wos enable plugin-a plugin-b
```

| Flag | Short | Description |
|------|-------|-------------|
| `--directory` | `-d` | Server directory (default: current directory) |
| `--json` | | Output in JSON format |

#### `wos disable`

Disable one or more plugins. Accepts multiple plugin names.

```bash
wos disable my-plugin
wos disable plugin-a plugin-b
```

| Flag | Short | Description |
|------|-------|-------------|
| `--directory` | `-d` | Server directory (default: current directory) |
| `--json` | | Output in JSON format |

#### `wos validate`

Validate a plugin's `wos-plugin.yaml` manifest. Checks required fields, name format, semver version, runtime value, entrypoint existence, CLI handler paths, and MQTT topic structure.

```bash
wos validate                         # Validate in current directory
wos validate --directory ./my-plugin
wos validate --json
```

Valid runtimes: `node`, `python`, `binary`, `docker`.

| Flag | Short | Description |
|------|-------|-------------|
| `--directory` | `-d` | Plugin directory (default: current directory) |
| `--json` | | Output in JSON format |

#### `wos upgrade`

Check for and apply plugin upgrades. Plugins installed from GitHub or Git sources can be upgraded automatically; local-path plugins require manual re-installation.

```bash
wos upgrade                   # Upgrade all plugins
wos upgrade my-plugin         # Upgrade a specific plugin
wos upgrade --check           # Check for updates without applying
wos upgrade --json
```

| Flag | Short | Description |
|------|-------|-------------|
| `--directory` | `-d` | Server directory (default: current directory) |
| `--check` | `-c` | Check for available updates without applying them |
| `--json` | | Output in JSON format |

#### `wos rollback`

Restore a plugin from a previous backup. Backups are created automatically before plugin upgrades and stored in `.wos-backups/`.

```bash
wos rollback --list                  # List available backups
wos rollback my-plugin               # Restore latest backup for plugin
wos rollback my-plugin --id abc123   # Restore a specific backup
wos rollback --list --json
```

| Flag | Short | Description |
|------|-------|-------------|
| `--directory` | `-d` | Server directory (default: current directory) |
| `--list` | `-l` | List available backups |
| `--id` | | Specific backup ID to restore |
| `--json` | | Output in JSON format |

---

### Configuration

#### `wos config`

View, set, or reset plugin configuration values. Supports dot notation for nested keys with automatic type inference (booleans, numbers, null, strings).

```bash
wos config my-plugin                          # View all config for a plugin
wos config my-plugin port                     # Get a specific key
wos config my-plugin port 3000                # Set a value
wos config my-plugin storage.backend sqlite   # Set a nested value
wos config my-plugin --reset --yes            # Reset all config to defaults
wos config my-plugin port --reset --yes       # Reset a single key
```

| Flag | Short | Description |
|------|-------|-------------|
| `--directory` | `-d` | Server directory (default: current directory) |
| `--reset` | `-r` | Reset configuration to defaults |
| `--yes` | `-y` | Skip confirmation prompts |
| `--json` | | Output in JSON format |

---

### Logging and Monitoring

#### `wos logs`

View plugin logs with filtering and follow mode.

```bash
wos logs my-plugin                    # Last 100 entries
wos logs my-plugin --level error      # Only errors
wos logs my-plugin --since 1h         # Logs from the last hour
wos logs my-plugin --lines 50         # Last 50 entries
wos logs --all                        # Logs from all plugins
wos logs my-plugin --follow           # Tail logs in real-time
```

| Flag | Short | Description |
|------|-------|-------------|
| `--directory` | `-d` | Server directory (default: current directory) |
| `--level` | `-l` | Minimum log level: `debug`, `info`, `warn`, `error` |
| `--lines` | `-n` | Number of log entries to show (default: 100) |
| `--since` | `-s` | Time filter (e.g., `1h`, `30m`, `1d`, or ISO timestamp) |
| `--follow` | `-f` | Follow log output in real-time |
| `--all` | `-a` | Show logs from all plugins |
| `--json` | | Output in JSON format |

#### `wos webhook`

Manage webhook notifications for server and plugin events.

```bash
wos webhook list                              # List configured webhooks
wos webhook events                            # List available event types
wos webhook test https://example.com/hook     # Send a test event
```

Available event types: `plugin.crashed`, `plugin.unhealthy`, `plugin.recovered`, `plugin.started`, `plugin.stopped`, `server.started`, `server.stopped`, `config.changed`. Wildcards (`*`, `plugin.*`, `server.*`) are also supported.

| Flag | Short | Description |
|------|-------|-------------|
| `--directory` | `-d` | Server directory (default: current directory) |
| `--json` | | Output in JSON format |

---

### Plugin Development

#### `wos create`

Scaffold a new plugin from a template.

```bash
wos create my-plugin                              # TypeScript template (default)
wos create my-plugin --template python             # Python template
wos create my-plugin --template node               # Node.js template
wos create my-plugin --features cli,admin          # Include CLI and admin panel
wos create my-plugin --description "My plugin"     # Set description
```

| Flag | Short | Description |
|------|-------|-------------|
| `--template` | `-t` | Template: `typescript` (default), `node`, `python` |
| `--directory` | `-d` | Directory to create plugin in (default: current directory) |
| `--description` | | Plugin description |
| `--author` | | Plugin author |
| `--force` | `-f` | Overwrite existing directory |
| `--features` | | Comma-separated features to include: `cli`, `admin` |

#### `wos dev`

Run a plugin in development mode with file watching and automatic rebuilds.

```bash
wos dev                              # Dev mode in current directory
wos dev --no-reload                  # Disable hot-reload
wos dev --server ./my-server         # Connect to a running server
wos dev --debounce 500               # Custom debounce interval
```

| Flag | Short | Description |
|------|-------|-------------|
| `--directory` | `-d` | Plugin directory (default: current directory) |
| `--server` | `-s` | Server directory to connect to |
| `--no-reload` | | Disable hot-reload |
| `--debounce` | | Debounce time in ms (default: 300) |

#### `wos test`

Run plugin tests. Automatically detects the runtime from the manifest and invokes `npm test` (Node.js) or `pytest` (Python).

```bash
wos test                         # Run tests
wos test --watch                 # Watch mode
wos test --filter "unit"         # Filter by name pattern
```

| Flag | Short | Description |
|------|-------|-------------|
| `--directory` | `-d` | Plugin directory (default: current directory) |
| `--watch` | `-w` | Run tests in watch mode |
| `--filter` | `-f` | Filter tests by name pattern |

#### `wos pack`

Package a plugin into a `.wospkg` archive for distribution.

```bash
wos pack                             # Package current directory
wos pack --output ./releases         # Custom output directory
wos pack --dry-run                   # Preview without creating file
```

| Flag | Short | Description |
|------|-------|-------------|
| `--directory` | `-d` | Plugin directory (default: current directory) |
| `--output` | `-o` | Output directory for the package |
| `--filename` | `-f` | Custom filename for the package |
| `--dry-run` | | Show what would be packaged without creating the file |

#### `wos docs`

Generate API reference documentation from a plugin's manifest.

```bash
wos docs                             # Generate to ./docs
wos docs --output ./api-docs         # Custom output directory
wos docs --readme                    # Also generate README.md
wos docs --readme --force            # Overwrite existing README.md
```

| Flag | Short | Description |
|------|-------|-------------|
| `--directory` | `-d` | Plugin directory (default: current directory) |
| `--output` | `-o` | Output directory for documentation (default: `docs`) |
| `--readme` | | Generate README.md |
| `--force` | `-f` | Overwrite existing files |

---

### Shell Completion

#### `wos completion`

Generate shell completion scripts for bash, zsh, PowerShell, or fish.

```bash
wos completion bash
wos completion zsh
wos completion powershell
wos completion fish
```

To enable completions, add the appropriate line to your shell profile:

```bash
# Bash (~/.bashrc)
eval "$(wos completion bash)"

# Zsh (~/.zshrc)
eval "$(wos completion zsh)"

# PowerShell ($PROFILE)
wos completion powershell | Out-String | Invoke-Expression

# Fish (~/.config/fish/completions/wos.fish)
wos completion fish > ~/.config/fish/completions/wos.fish
```

---

## Configuration

The CLI reads and writes `wos.yaml` in the server directory. A default configuration is generated by `wos init`:

```yaml
# Server settings
server:
  name: my-server
  logLevel: info

# MQTT broker settings
mqtt:
  host: localhost
  port: 1883

# Admin panel settings
admin:
  enabled: true
  port: 3000

# Plugins configuration
plugins: {}

# Webhooks for event notifications
webhooks: []
```

### Key sections

| Section | Purpose |
|---------|---------|
| `server` | Server name and log level |
| `mqtt` | MQTT broker connection (host, port, credentials) |
| `admin` | Admin web panel toggle, port, and credentials |
| `plugins` | Installed plugins with enabled state, version, source, and per-plugin config |
| `webhooks` | Webhook URLs, event filters, and optional signing secrets |

Plugin-specific configuration is stored under `plugins.<name>.config` and managed with `wos config`.

### Plugin manifest (`wos-plugin.yaml`)

Each plugin must include a `wos-plugin.yaml` manifest with these required fields:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Plugin name (lowercase, hyphens allowed) |
| `version` | string | Semver version (e.g., `1.0.0`) |
| `runtime` | string | One of `node`, `python`, `binary`, `docker` |
| `entrypoint` | string | Path to the main entry file |

Optional sections: `description`, `dependencies`, `cli.commands`, `mqtt.subscriptions`, `mqtt.publications`, `admin.panel`.

---

## Development

### Prerequisites

- Node.js >= 18
- npm

### Build

```bash
npm run build
```

### Test

```bash
npm test           # Single run
npm run test:watch # Watch mode
```

Tests use [Vitest](https://vitest.dev/) and [@oclif/test](https://github.com/oclif/test).

### Project structure

```
wos-cli/
  bin/
    run.js            # CLI entrypoint
  src/
    commands/          # One file per command
      init.ts
      start.ts
      stop.ts
      restart.ts
      status.ts
      add.ts
      remove.ts
      list.ts
      enable.ts
      disable.ts
      validate.ts
      upgrade.ts
      rollback.ts
      config.ts
      logs.ts
      webhook.ts
      create.ts
      dev.ts
      test.ts
      pack.ts
      docs.ts
      completion.ts
  package.json
  tsconfig.json
```

## Global flags

All commands that operate on a server directory accept `--directory` (`-d`) to specify the target path. Most commands also accept `--json` for machine-readable output.
