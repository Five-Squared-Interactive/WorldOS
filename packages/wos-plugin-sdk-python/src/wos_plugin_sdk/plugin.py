"""
WorldOS Plugin SDK - Plugin Base Class

Base class for WorldOS plugins with lifecycle hooks.
Plugin developers extend this class and implement:
- on_start: Called when plugin starts, receives context
- on_stop: Called when plugin stops, for cleanup
- on_health_check: Called for health status checks
"""

import os
import signal
import sys
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal, Optional

import yaml

from .errors import ConfigurationError, ValidationError
from .logger import Logger, create_logger
from .mqtt import PluginMqttClient, PluginMqttClientOptions


class HealthStatus(str, Enum):
    """Health check status values."""

    OK = "ok"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"


@dataclass
class HealthCheckResult:
    """Health check result from plugin."""

    status: Literal["ok", "degraded", "unhealthy"]
    details: Optional[dict[str, Any]] = None
    error: Optional[str] = None


@dataclass
class PluginManifest:
    """Plugin manifest definition."""

    name: str
    display_name: str
    version: str
    runtime: Literal["node", "python", "binary"]
    entrypoint: str
    description: Optional[str] = None
    author: Optional[str] = None
    dependencies: list[str] = field(default_factory=list)
    environment: dict[str, str] = field(default_factory=dict)
    working_directory: Optional[str] = None


@dataclass
class PluginContext:
    """Plugin context provided to lifecycle methods."""

    logger: Logger
    config: dict[str, Any]
    mqtt: PluginMqttClient
    manifest: PluginManifest


@dataclass
class WOSPluginOptions:
    """Options for WOSPlugin constructor."""

    manifest: Optional[PluginManifest] = None
    config: Optional[dict[str, Any]] = None
    mqtt_options: Optional[PluginMqttClientOptions] = None


class WOSPlugin(ABC):
    """
    WOSPlugin - Base class for WorldOS plugins.

    Extend this class to create a plugin:

    ```python
    class MyPlugin(WOSPlugin):
        async def on_start(self, context: PluginContext) -> None:
            context.logger.info("Plugin started")

        async def on_stop(self) -> None:
            # Cleanup
            pass

        async def on_health_check(self) -> HealthCheckResult:
            return HealthCheckResult(status="ok")

    if __name__ == "__main__":
        plugin = MyPlugin()
        plugin.run()
    ```
    """

    def __init__(self, options: Optional[WOSPluginOptions] = None) -> None:
        """
        Create a new plugin instance.

        Args:
            options: Plugin configuration options
        """
        opts = options or WOSPluginOptions()

        self._is_running = False
        self._context: Optional[PluginContext] = None
        self._manifest = opts.manifest or self._build_default_manifest()
        self._config = opts.config or self._load_config_from_wos_yaml() or {}
        self._mqtt_options = opts.mqtt_options

        # Set up signal handlers
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)

    def _build_default_manifest(self) -> PluginManifest:
        """Build default manifest from environment variables."""
        name = os.environ.get("WOS_PLUGIN_NAME", "unknown")
        version = os.environ.get("WOS_PLUGIN_VERSION", "0.0.0")

        # Try to load from wos-plugin.yaml if it exists
        manifest_path = os.path.join(os.getcwd(), "wos-plugin.yaml")
        if os.path.exists(manifest_path):
            try:
                with open(manifest_path, "r") as f:
                    data = yaml.safe_load(f)
                    return PluginManifest(
                        name=data.get("name", name),
                        display_name=data.get("displayName", data.get("name", name)),
                        version=data.get("version", version),
                        runtime=data.get("runtime", "python"),
                        entrypoint=data.get("entrypoint", "__main__.py"),
                        description=data.get("description"),
                        author=data.get("author"),
                        dependencies=data.get("dependencies", []),
                        environment=data.get("environment", {}),
                        working_directory=data.get("workingDirectory"),
                    )
            except Exception:
                pass  # Fall back to env vars

        return PluginManifest(
            name=name,
            display_name=name,
            version=version,
            runtime="python",
            entrypoint="__main__.py",
        )

    def _load_config_from_wos_yaml(self) -> Optional[dict[str, Any]]:
        """Load plugin config from wos.yaml using WOS_SERVER_DIR and WOS_PLUGIN_NAME."""
        server_dir = os.environ.get("WOS_SERVER_DIR")
        plugin_name = os.environ.get("WOS_PLUGIN_NAME")
        if not server_dir or not plugin_name:
            return None

        yaml_path = os.path.join(server_dir, "wos.yaml")
        if not os.path.isfile(yaml_path):
            return None

        try:
            with open(yaml_path, "r") as f:
                data = yaml.safe_load(f)
            plugins = data.get("plugins", {})
            plugin_entry = plugins.get(plugin_name, {})
            return plugin_entry.get("config", {})
        except Exception:
            return None

    def _handle_signal(self, signum: int, frame: Any) -> None:
        """Handle shutdown signals."""
        if self._is_running:
            self.stop()
            sys.exit(0)

    def start(self) -> None:
        """Start the plugin."""
        if self._is_running:
            return

        # Create logger
        logger = create_logger(self._manifest.name)

        # Create MQTT client
        mqtt_opts = self._mqtt_options or PluginMqttClientOptions(auto_connect=False)
        mqtt_client = PluginMqttClient(mqtt_opts)

        # Connect to MQTT if not auto-connected
        if not mqtt_client.is_connected:
            try:
                mqtt_client.connect()
            except Exception as e:
                logger.warn(f"MQTT connection failed: {e}")
                # Continue without MQTT - plugin may not need it

        # Create context
        self._context = PluginContext(
            logger=logger,
            config=self._config,
            mqtt=mqtt_client,
            manifest=self._manifest,
        )

        # Set up health check handler
        self._setup_health_check_handler()

        self._is_running = True
        logger.info("Plugin starting", {"name": self._manifest.name, "version": self._manifest.version})

        try:
            # Call plugin's onStart
            self.on_start(self._context)
            logger.info("Plugin started successfully")
        except Exception as e:
            logger.error("Plugin start failed", error=e)
            self._is_running = False
            raise

    def stop(self) -> None:
        """Stop the plugin."""
        if not self._is_running:
            return

        logger = self._context.logger if self._context else create_logger(self._manifest.name)
        logger.info("Plugin stopping")

        try:
            # Call plugin's onStop
            self.on_stop()
        except Exception as e:
            logger.error("Plugin stop failed", error=e)

        # Disconnect MQTT
        if self._context and self._context.mqtt:
            try:
                self._context.mqtt.disconnect()
            except Exception:
                pass

        self._is_running = False
        logger.info("Plugin stopped")

    def _setup_health_check_handler(self) -> None:
        """Set up MQTT handler for health checks."""
        if not self._context or not self._context.mqtt.is_connected:
            return

        health_topic = f"wos/plugin/{self._manifest.name}/health/request"
        response_topic = f"wos/plugin/{self._manifest.name}/health/response"

        def handle_health_request(message: Any) -> None:
            try:
                result = self.on_health_check()
                correlation_id = message.payload.get("correlationId", "") if isinstance(message.payload, dict) else ""

                # Use publish_raw instead of respond() so that status/details
                # appear at the top level — the server's HealthMonitor reads
                # response.status directly, not response.data.status.
                self._context.mqtt.publish_raw(
                    response_topic,
                    {
                        "correlationId": correlation_id,
                        "status": result.status,
                        "details": result.details,
                        "error": result.error,
                    },
                )
            except Exception as e:
                correlation_id = message.payload.get("correlationId", "") if isinstance(message.payload, dict) else ""
                self._context.mqtt.publish_raw(
                    response_topic,
                    {
                        "correlationId": correlation_id,
                        "status": "unhealthy",
                        "error": str(e),
                    },
                )

        try:
            self._context.mqtt.subscribe_with_handler(health_topic, handle_health_request)
        except Exception:
            pass  # May not be connected

    def check_health(self) -> HealthCheckResult:
        """Check plugin health."""
        try:
            return self.on_health_check()
        except Exception as e:
            return HealthCheckResult(
                status="unhealthy",
                error=str(e),
            )

    def run(self) -> None:
        """
        Run the plugin (blocking).

        This starts the plugin and keeps it running until a shutdown
        signal is received.
        """
        self.start()

        # Keep running until stopped
        try:
            while self._is_running:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        finally:
            self.stop()

    @property
    def is_running(self) -> bool:
        """Whether the plugin is currently running."""
        return self._is_running

    @property
    def context(self) -> Optional[PluginContext]:
        """Get the plugin context (only available after start)."""
        return self._context

    @property
    def manifest(self) -> PluginManifest:
        """Get the plugin manifest."""
        return self._manifest

    @abstractmethod
    def on_start(self, context: PluginContext) -> None:
        """
        Called when the plugin starts.

        Args:
            context: Plugin context with logger, config, mqtt, and manifest
        """
        ...

    @abstractmethod
    def on_stop(self) -> None:
        """Called when the plugin stops."""
        ...

    @abstractmethod
    def on_health_check(self) -> HealthCheckResult:
        """
        Called for health checks.

        Returns:
            Health check result
        """
        ...
