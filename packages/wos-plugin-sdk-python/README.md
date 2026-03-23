# WorldOS Plugin SDK - Python

Python SDK for building WorldOS plugins with MQTT communication, lifecycle hooks, and health monitoring.

## Installation

```bash
pip install wos-plugin-sdk
```

## Quick Start

Create a simple plugin:

```python
from wos_plugin_sdk import WOSPlugin, PluginContext, HealthCheckResult

class MyPlugin(WOSPlugin):
    def on_start(self, context: PluginContext) -> None:
        context.logger.info("Plugin started!")

        # Subscribe to events
        context.mqtt.subscribe_with_handler(
            "wos/events/+",
            self.handle_event
        )

    def on_stop(self) -> None:
        self.context.logger.info("Plugin stopped")

    def on_health_check(self) -> HealthCheckResult:
        return HealthCheckResult(status="ok")

    def handle_event(self, message):
        self.context.logger.info(f"Received event: {message.topic}")

if __name__ == "__main__":
    plugin = MyPlugin()
    plugin.run()
```

## Plugin Manifest

Create a `wos-plugin.yaml` file in your plugin directory:

```yaml
name: my-plugin
displayName: My Plugin
version: 1.0.0
runtime: python
entrypoint: main.py
description: A simple WorldOS plugin
```

## API Reference

### WOSPlugin

Base class for all plugins. Extend this class and implement the abstract methods:

- `on_start(context: PluginContext)` - Called when plugin starts
- `on_stop()` - Called when plugin stops
- `on_health_check() -> HealthCheckResult` - Called for health checks

### PluginContext

Context provided to `on_start`:

- `logger: Logger` - Structured logger with plugin name prefix
- `config: dict` - Plugin configuration
- `mqtt: PluginMqttClient` - MQTT client for communication
- `manifest: PluginManifest` - Plugin manifest

### PluginMqttClient

MQTT client for pub/sub messaging:

```python
# Subscribe within plugin namespace
context.mqtt.subscribe("events", "click")

# Subscribe with handler
context.mqtt.subscribe_with_handler("wos/events/#", handler)

# Publish within plugin namespace
context.mqtt.publish(["status"], {"online": True})

# Request/response pattern
response = context.mqtt.request("wos/service/api", {"action": "get"})
```

### Logger

Structured JSON logging:

```python
context.logger.info("Message", {"key": "value"})
context.logger.debug("Debug info")
context.logger.warn("Warning message")
context.logger.error("Error occurred", error=exception)
```

### Error Types

- `PluginError` - Base error class
- `ConfigurationError` - Configuration errors
- `ConnectionError` - MQTT connection errors
- `TimeoutError` - Operation timeouts
- `ValidationError` - Validation failures

## Environment Variables

- `WOS_PLUGIN_NAME` - Plugin name (used for MQTT topics)
- `WOS_PLUGIN_VERSION` - Plugin version
- `WOS_MQTT_URL` - MQTT broker URL (default: `mqtt://localhost:1883`)

## Development

```bash
# Install development dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Type checking
mypy src

# Linting
ruff check src
```

## License

MIT
