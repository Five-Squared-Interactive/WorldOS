"""Tests for plugin base class."""

import os
from unittest.mock import MagicMock, patch

import pytest

from wos_plugin_sdk.plugin import (
    HealthCheckResult,
    PluginContext,
    PluginManifest,
    WOSPlugin,
    WOSPluginOptions,
)


class MockPlugin(WOSPlugin):
    """Mock plugin for testing."""

    def __init__(self, options=None):
        super().__init__(options)
        self.start_called = False
        self.stop_called = False
        self.health_check_called = False

    def on_start(self, context: PluginContext) -> None:
        self.start_called = True

    def on_stop(self) -> None:
        self.stop_called = True

    def on_health_check(self) -> HealthCheckResult:
        self.health_check_called = True
        return HealthCheckResult(status="ok")


class TestPluginManifest:
    def test_create_manifest(self):
        manifest = PluginManifest(
            name="test-plugin",
            display_name="Test Plugin",
            version="1.0.0",
            runtime="python",
            entrypoint="main.py",
        )
        assert manifest.name == "test-plugin"
        assert manifest.version == "1.0.0"
        assert manifest.runtime == "python"

    def test_optional_fields_default(self):
        manifest = PluginManifest(
            name="test",
            display_name="Test",
            version="1.0.0",
            runtime="python",
            entrypoint="main.py",
        )
        assert manifest.description is None
        assert manifest.dependencies == []
        assert manifest.environment == {}


class TestHealthCheckResult:
    def test_create_ok_result(self):
        result = HealthCheckResult(status="ok")
        assert result.status == "ok"
        assert result.details is None
        assert result.error is None

    def test_create_degraded_result(self):
        result = HealthCheckResult(
            status="degraded",
            details={"connections": 5},
        )
        assert result.status == "degraded"
        assert result.details == {"connections": 5}

    def test_create_unhealthy_result(self):
        result = HealthCheckResult(
            status="unhealthy",
            error="Database connection failed",
        )
        assert result.status == "unhealthy"
        assert result.error == "Database connection failed"


class TestWOSPlugin:
    def test_creates_with_default_manifest(self):
        with patch.dict(os.environ, {"WOS_PLUGIN_NAME": "test-plugin"}):
            plugin = MockPlugin()
            assert plugin.manifest.name == "test-plugin"

    def test_creates_with_custom_manifest(self):
        manifest = PluginManifest(
            name="custom",
            display_name="Custom",
            version="2.0.0",
            runtime="python",
            entrypoint="main.py",
        )
        plugin = MockPlugin(WOSPluginOptions(manifest=manifest))
        assert plugin.manifest.name == "custom"
        assert plugin.manifest.version == "2.0.0"

    def test_is_not_running_initially(self):
        plugin = MockPlugin()
        assert not plugin.is_running

    def test_context_is_none_before_start(self):
        plugin = MockPlugin()
        assert plugin.context is None

    @patch("wos_plugin_sdk.plugin.PluginMqttClient")
    def test_start_calls_on_start(self, mock_mqtt_class):
        mock_mqtt = MagicMock()
        mock_mqtt.is_connected = True
        mock_mqtt_class.return_value = mock_mqtt

        plugin = MockPlugin()
        plugin.start()

        assert plugin.start_called
        assert plugin.is_running
        assert plugin.context is not None

        plugin.stop()

    @patch("wos_plugin_sdk.plugin.PluginMqttClient")
    def test_stop_calls_on_stop(self, mock_mqtt_class):
        mock_mqtt = MagicMock()
        mock_mqtt.is_connected = True
        mock_mqtt_class.return_value = mock_mqtt

        plugin = MockPlugin()
        plugin.start()
        plugin.stop()

        assert plugin.stop_called
        assert not plugin.is_running

    @patch("wos_plugin_sdk.plugin.PluginMqttClient")
    def test_check_health_calls_on_health_check(self, mock_mqtt_class):
        mock_mqtt = MagicMock()
        mock_mqtt.is_connected = True
        mock_mqtt_class.return_value = mock_mqtt

        plugin = MockPlugin()
        result = plugin.check_health()

        assert plugin.health_check_called
        assert result.status == "ok"

    @patch("wos_plugin_sdk.plugin.PluginMqttClient")
    def test_context_has_all_fields(self, mock_mqtt_class):
        mock_mqtt = MagicMock()
        mock_mqtt.is_connected = True
        mock_mqtt_class.return_value = mock_mqtt

        plugin = MockPlugin(WOSPluginOptions(config={"port": 8080}))
        plugin.start()

        context = plugin.context
        assert context is not None
        assert context.logger is not None
        assert context.mqtt is not None
        assert context.config == {"port": 8080}
        assert context.manifest is not None

        plugin.stop()


class TestPluginErrorHandling:
    @patch("wos_plugin_sdk.plugin.PluginMqttClient")
    def test_health_check_returns_unhealthy_on_error(self, mock_mqtt_class):
        class FailingPlugin(WOSPlugin):
            def on_start(self, context): pass
            def on_stop(self): pass
            def on_health_check(self):
                raise RuntimeError("Health check failed")

        plugin = FailingPlugin()
        result = plugin.check_health()

        assert result.status == "unhealthy"
        assert "Health check failed" in result.error

    @patch("wos_plugin_sdk.plugin.PluginMqttClient")
    def test_start_failure_sets_not_running(self, mock_mqtt_class):
        mock_mqtt = MagicMock()
        mock_mqtt.is_connected = True
        mock_mqtt_class.return_value = mock_mqtt

        class FailingStartPlugin(WOSPlugin):
            def on_start(self, context):
                raise RuntimeError("Start failed")
            def on_stop(self): pass
            def on_health_check(self):
                return HealthCheckResult(status="ok")

        plugin = FailingStartPlugin()

        with pytest.raises(RuntimeError):
            plugin.start()

        assert not plugin.is_running
