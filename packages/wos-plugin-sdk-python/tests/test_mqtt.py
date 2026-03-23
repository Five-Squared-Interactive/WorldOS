"""Tests for MQTT client."""

import os
from unittest.mock import MagicMock, patch

import pytest

from wos_plugin_sdk.mqtt import (
    PluginMessage,
    PluginMqttClient,
    PluginMqttClientOptions,
    RequestMessage,
    ResponseMessage,
)


class TestPluginMessage:
    def test_create_message(self):
        msg = PluginMessage(
            topic="test/topic",
            payload={"key": "value"},
            timestamp=1234567890,
        )
        assert msg.topic == "test/topic"
        assert msg.payload == {"key": "value"}
        assert msg.timestamp == 1234567890


class TestRequestMessage:
    def test_create_request(self):
        msg = RequestMessage(
            correlation_id="abc-123",
            timestamp=1234567890,
            payload={"action": "test"},
        )
        assert msg.correlation_id == "abc-123"
        assert msg.payload == {"action": "test"}


class TestResponseMessage:
    def test_create_success_response(self):
        msg = ResponseMessage(
            correlation_id="abc-123",
            timestamp=1234567890,
            success=True,
            data={"result": "ok"},
        )
        assert msg.success is True
        assert msg.data == {"result": "ok"}
        assert msg.error is None

    def test_create_error_response(self):
        msg = ResponseMessage(
            correlation_id="abc-123",
            timestamp=1234567890,
            success=False,
            error={"code": "ERROR", "message": "Failed"},
        )
        assert msg.success is False
        assert msg.error["code"] == "ERROR"


class TestPluginMqttClientOptions:
    def test_default_options(self):
        opts = PluginMqttClientOptions()
        assert opts.url is None
        assert opts.auto_connect is True
        assert opts.connect_timeout == 10000

    def test_custom_options(self):
        opts = PluginMqttClientOptions(
            url="mqtt://custom:1234",
            auto_connect=False,
            connect_timeout=5000,
        )
        assert opts.url == "mqtt://custom:1234"
        assert opts.auto_connect is False
        assert opts.connect_timeout == 5000


class TestPluginMqttClient:
    @patch("wos_plugin_sdk.mqtt.mqtt.Client")
    def test_creates_with_defaults(self, mock_mqtt_class):
        mock_client = MagicMock()
        mock_mqtt_class.return_value = mock_client

        with patch.dict(os.environ, {"WOS_PLUGIN_NAME": "test-plugin"}):
            client = PluginMqttClient(PluginMqttClientOptions(auto_connect=False))

        assert client.plugin_name == "test-plugin"
        assert "plugin-test-plugin" in client.client_id

    @patch("wos_plugin_sdk.mqtt.mqtt.Client")
    def test_uses_custom_url(self, mock_mqtt_class):
        mock_client = MagicMock()
        mock_mqtt_class.return_value = mock_client

        client = PluginMqttClient(
            PluginMqttClientOptions(
                url="mqtt://custom:9999",
                auto_connect=False,
            )
        )

        assert client.url == "mqtt://custom:9999"

    @patch("wos_plugin_sdk.mqtt.mqtt.Client")
    def test_builds_plugin_topic(self, mock_mqtt_class):
        mock_client = MagicMock()
        mock_mqtt_class.return_value = mock_client

        with patch.dict(os.environ, {"WOS_PLUGIN_NAME": "my-plugin"}):
            client = PluginMqttClient(PluginMqttClientOptions(auto_connect=False))
            topic = client.build_plugin_topic("events", "click")

        assert topic == "wos/plugin/my-plugin/events/click"

    @patch("wos_plugin_sdk.mqtt.mqtt.Client")
    def test_topic_matching_exact(self, mock_mqtt_class):
        mock_client = MagicMock()
        mock_mqtt_class.return_value = mock_client

        client = PluginMqttClient(PluginMqttClientOptions(auto_connect=False))
        assert client._topic_matches("a/b/c", "a/b/c") is True
        assert client._topic_matches("a/b/c", "a/b/d") is False

    @patch("wos_plugin_sdk.mqtt.mqtt.Client")
    def test_topic_matching_plus_wildcard(self, mock_mqtt_class):
        mock_client = MagicMock()
        mock_mqtt_class.return_value = mock_client

        client = PluginMqttClient(PluginMqttClientOptions(auto_connect=False))
        assert client._topic_matches("a/+/c", "a/b/c") is True
        assert client._topic_matches("a/+/c", "a/x/c") is True
        assert client._topic_matches("a/+/c", "a/b/d") is False

    @patch("wos_plugin_sdk.mqtt.mqtt.Client")
    def test_topic_matching_hash_wildcard(self, mock_mqtt_class):
        mock_client = MagicMock()
        mock_mqtt_class.return_value = mock_client

        client = PluginMqttClient(PluginMqttClientOptions(auto_connect=False))
        assert client._topic_matches("a/#", "a/b/c") is True
        assert client._topic_matches("a/#", "a/b/c/d") is True
        assert client._topic_matches("#", "a/b/c") is True

    @patch("wos_plugin_sdk.mqtt.mqtt.Client")
    def test_subscribed_topics_initially_empty(self, mock_mqtt_class):
        mock_client = MagicMock()
        mock_mqtt_class.return_value = mock_client

        client = PluginMqttClient(PluginMqttClientOptions(auto_connect=False))
        assert client.subscribed_topics == []

    @patch("wos_plugin_sdk.mqtt.mqtt.Client")
    def test_is_not_connected_initially(self, mock_mqtt_class):
        mock_client = MagicMock()
        mock_mqtt_class.return_value = mock_client

        client = PluginMqttClient(PluginMqttClientOptions(auto_connect=False))
        assert client.is_connected is False


class TestPluginMqttClientConnection:
    @patch("wos_plugin_sdk.mqtt.mqtt.Client")
    def test_connect_calls_mqtt_connect(self, mock_mqtt_class):
        mock_client = MagicMock()
        mock_mqtt_class.return_value = mock_client

        client = PluginMqttClient(PluginMqttClientOptions(auto_connect=False))

        # Simulate connection success
        def trigger_connect(*args, **kwargs):
            # Call the on_connect callback
            client._on_connect(mock_client, None, MagicMock(), MagicMock(value=0))

        mock_client.connect.side_effect = trigger_connect

        client.connect()

        mock_client.connect.assert_called_once()
        mock_client.loop_start.assert_called_once()
        assert client.is_connected is True

    @patch("wos_plugin_sdk.mqtt.mqtt.Client")
    def test_disconnect_stops_loop(self, mock_mqtt_class):
        mock_client = MagicMock()
        mock_mqtt_class.return_value = mock_client

        client = PluginMqttClient(PluginMqttClientOptions(auto_connect=False))
        client._is_connected = True  # Simulate connected state

        client.disconnect()

        mock_client.loop_stop.assert_called_once()
        mock_client.disconnect.assert_called_once()
        assert client.is_connected is False
