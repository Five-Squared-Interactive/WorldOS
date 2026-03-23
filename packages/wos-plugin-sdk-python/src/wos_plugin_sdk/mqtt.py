"""
WorldOS Plugin SDK - MQTT Client

MQTT client for plugin communication with the WorldOS server.
"""

import json
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Generic, Optional, TypeVar

import paho.mqtt.client as mqtt

from .errors import ConnectionError, TimeoutError

T = TypeVar("T")


@dataclass
class PluginMessage(Generic[T]):
    """Message received from MQTT."""

    topic: str
    payload: T
    timestamp: int


@dataclass
class RequestMessage(Generic[T]):
    """Request message format for request/response pattern."""

    correlation_id: str
    timestamp: int
    payload: T


@dataclass
class ResponseMessage(Generic[T]):
    """Response message format for request/response pattern."""

    correlation_id: str
    timestamp: int
    success: bool
    data: Optional[T] = None
    error: Optional[dict[str, Any]] = None


MessageHandler = Callable[[PluginMessage[Any]], None]


@dataclass
class PluginMqttClientOptions:
    """Options for the plugin MQTT client."""

    url: Optional[str] = None
    client_id: Optional[str] = None
    auto_connect: bool = True
    connect_timeout: int = 10000
    reconnect: bool = True


@dataclass
class PendingRequest:
    """Pending request awaiting response."""

    event: threading.Event = field(default_factory=threading.Event)
    response: Optional[ResponseMessage[Any]] = None


class PluginMqttClient:
    """
    MQTT client for WorldOS plugins.

    Provides publish/subscribe messaging and request/response patterns
    for communication with the WorldOS server.
    """

    def __init__(self, options: Optional[PluginMqttClientOptions] = None) -> None:
        """
        Create a new plugin MQTT client.

        Args:
            options: Client configuration options
        """
        opts = options or PluginMqttClientOptions()

        self._url = opts.url or os.environ.get("WOS_MQTT_URL", "mqtt://localhost:1883")
        self._plugin_name = os.environ.get("WOS_PLUGIN_NAME", "unknown")

        if opts.client_id:
            self._client_id = opts.client_id
        else:
            random_suffix = uuid.uuid4().hex[:8]
            self._client_id = f"plugin-{self._plugin_name}-{random_suffix}"

        self._options = opts
        self._is_connected = False
        self._is_connecting = False

        # Parse URL
        url_match = re.match(r"mqtt://([^:]+):(\d+)", self._url)
        if url_match:
            self._host = url_match.group(1)
            self._port = int(url_match.group(2))
        else:
            self._host = "localhost"
            self._port = 1883

        # Create MQTT client
        self._client = mqtt.Client(
            client_id=self._client_id,
            protocol=mqtt.MQTTv311,
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        )
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message

        # Tracking
        self._subscriptions: set[str] = set()
        self._handlers: dict[str, list[MessageHandler]] = {}
        self._pending_requests: dict[str, PendingRequest] = {}
        self._connect_event = threading.Event()
        self._lock = threading.Lock()

        # Auto-connect if enabled
        if opts.auto_connect:
            self.connect()

    def _on_connect(
        self,
        client: mqtt.Client,
        userdata: Any,
        flags: mqtt.ConnectFlags,
        reason_code: mqtt.ReasonCode,
        properties: Optional[mqtt.Properties] = None,
    ) -> None:
        """Handle MQTT connection."""
        if reason_code == 0:
            self._is_connected = True
            self._is_connecting = False
            self._connect_event.set()

            # Resubscribe to topics
            for topic in self._subscriptions:
                self._client.subscribe(topic)

    def _on_disconnect(
        self,
        client: mqtt.Client,
        userdata: Any,
        disconnect_flags: mqtt.DisconnectFlags,
        reason_code: mqtt.ReasonCode,
        properties: Optional[mqtt.Properties] = None,
    ) -> None:
        """Handle MQTT disconnection."""
        self._is_connected = False
        self._connect_event.clear()

    def _on_message(
        self,
        client: mqtt.Client,
        userdata: Any,
        msg: mqtt.MQTTMessage,
    ) -> None:
        """Handle incoming MQTT message."""
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            payload = msg.payload.decode("utf-8", errors="replace")

        message = PluginMessage(
            topic=msg.topic,
            payload=payload,
            timestamp=int(time.time() * 1000),
        )

        # Check for pending request responses
        if isinstance(payload, dict) and "correlationId" in payload:
            correlation_id = payload["correlationId"]
            with self._lock:
                pending = self._pending_requests.get(correlation_id)
                if pending:
                    pending.response = ResponseMessage(
                        correlation_id=correlation_id,
                        timestamp=payload.get("timestamp", int(time.time() * 1000)),
                        success=payload.get("success", True),
                        data=payload.get("data"),
                        error=payload.get("error"),
                    )
                    pending.event.set()
                    return

        # Dispatch to handlers
        self._dispatch_to_handlers(message)

    def _dispatch_to_handlers(self, message: PluginMessage[Any]) -> None:
        """Dispatch message to matching handlers."""
        with self._lock:
            handlers_copy = dict(self._handlers)

        for pattern, handlers in handlers_copy.items():
            if self._topic_matches(pattern, message.topic):
                for handler in handlers:
                    try:
                        handler(message)
                    except Exception:
                        pass  # Log error

    def _topic_matches(self, pattern: str, topic: str) -> bool:
        """Check if topic matches pattern (supports + and # wildcards)."""
        pattern_parts = pattern.split("/")
        topic_parts = topic.split("/")

        for i, pattern_part in enumerate(pattern_parts):
            if pattern_part == "#":
                return True
            if i >= len(topic_parts):
                return False
            if pattern_part != "+" and pattern_part != topic_parts[i]:
                return False

        return len(pattern_parts) == len(topic_parts)

    def connect(self) -> None:
        """Connect to the MQTT broker."""
        if self._is_connected or self._is_connecting:
            return

        self._is_connecting = True
        self._connect_event.clear()

        try:
            self._client.connect(self._host, self._port, keepalive=60)
            self._client.loop_start()

            # Wait for connection with timeout
            timeout_sec = self._options.connect_timeout / 1000
            if not self._connect_event.wait(timeout=timeout_sec):
                self._is_connecting = False
                raise ConnectionError(
                    f"Failed to connect to MQTT broker at {self._url}",
                    {"timeout_ms": self._options.connect_timeout},
                )
        except Exception as e:
            self._is_connecting = False
            if isinstance(e, ConnectionError):
                raise
            raise ConnectionError(
                f"Failed to connect to MQTT broker: {str(e)}",
                {"url": self._url},
            )

    def disconnect(self) -> None:
        """Disconnect from the MQTT broker."""
        if not self._is_connected:
            return

        self._client.loop_stop()
        self._client.disconnect()
        self._is_connected = False
        self._connect_event.clear()

    def _ensure_connected(self) -> None:
        """Ensure client is connected."""
        if not self._is_connected:
            raise ConnectionError("MQTT client not connected")

    def build_plugin_topic(self, *path: str) -> str:
        """Build a topic within the plugin's namespace."""
        return f"wos/plugin/{self._plugin_name}/{'/'.join(path)}"

    def subscribe(self, *path: str) -> None:
        """Subscribe to a topic within the plugin's namespace."""
        topic = self.build_plugin_topic(*path)
        self.subscribe_raw(topic)

    def subscribe_raw(self, topic: str) -> None:
        """Subscribe to a raw topic (not within plugin namespace)."""
        self._ensure_connected()
        with self._lock:
            self._subscriptions.add(topic)
        self._client.subscribe(topic)

    def unsubscribe(self, *path: str) -> None:
        """Unsubscribe from a topic within the plugin's namespace."""
        topic = self.build_plugin_topic(*path)
        self._ensure_connected()
        with self._lock:
            self._subscriptions.discard(topic)
        self._client.unsubscribe(topic)

    def subscribe_with_handler(
        self,
        topic: str,
        handler: MessageHandler,
    ) -> None:
        """
        Subscribe to a topic with a message handler.

        Args:
            topic: Topic to subscribe to (can include + and # wildcards)
            handler: Handler function called when messages arrive
        """
        self.subscribe_raw(topic)
        with self._lock:
            if topic not in self._handlers:
                self._handlers[topic] = []
            self._handlers[topic].append(handler)

    def publish(self, path: list[str], payload: Any) -> None:
        """Publish a message to a topic within the plugin's namespace."""
        topic = self.build_plugin_topic(*path)
        self.publish_raw(topic, payload)

    def publish_raw(self, topic: str, payload: Any) -> None:
        """Publish a message to a raw topic (not within plugin namespace)."""
        self._ensure_connected()
        message = json.dumps(payload) if not isinstance(payload, str) else payload
        self._client.publish(topic, message.encode("utf-8"))

    def request(
        self,
        topic: str,
        payload: Any,
        timeout_ms: int = 30000,
    ) -> ResponseMessage[Any]:
        """
        Send a request and wait for response.

        Args:
            topic: Topic to send request to
            payload: Request payload
            timeout_ms: Timeout in milliseconds

        Returns:
            Response message

        Raises:
            TimeoutError: If response is not received within timeout
        """
        self._ensure_connected()

        correlation_id = str(uuid.uuid4())
        response_topic = f"{topic}/response"

        # Set up pending request
        pending = PendingRequest()
        with self._lock:
            self._pending_requests[correlation_id] = pending

        # Subscribe to response topic
        self.subscribe_raw(response_topic)

        try:
            # Send request
            request_message = {
                "correlationId": correlation_id,
                "timestamp": int(time.time() * 1000),
                "payload": payload,
            }
            self.publish_raw(topic, request_message)

            # Wait for response
            if not pending.event.wait(timeout=timeout_ms / 1000):
                raise TimeoutError(
                    f"Request to {topic} timed out",
                    timeout_ms=timeout_ms,
                )

            if pending.response is None:
                raise TimeoutError(f"No response received for request to {topic}")

            return pending.response

        finally:
            with self._lock:
                self._pending_requests.pop(correlation_id, None)

    def respond(
        self,
        response_topic: str,
        correlation_id: str,
        data: Any,
    ) -> None:
        """Respond to a request with success."""
        response = {
            "correlationId": correlation_id,
            "timestamp": int(time.time() * 1000),
            "success": True,
            "data": data,
        }
        self.publish_raw(response_topic, response)

    def respond_error(
        self,
        response_topic: str,
        correlation_id: str,
        code: str,
        message: str,
        details: Optional[Any] = None,
    ) -> None:
        """Respond to a request with an error."""
        response = {
            "correlationId": correlation_id,
            "timestamp": int(time.time() * 1000),
            "success": False,
            "error": {
                "code": code,
                "message": message,
                "details": details,
            },
        }
        self.publish_raw(response_topic, response)

    @property
    def is_connected(self) -> bool:
        """Get connection status."""
        return self._is_connected

    @property
    def client_id(self) -> str:
        """Get the client ID."""
        return self._client_id

    @property
    def plugin_name(self) -> str:
        """Get the plugin name."""
        return self._plugin_name

    @property
    def url(self) -> str:
        """Get the broker URL."""
        return self._url

    @property
    def subscribed_topics(self) -> list[str]:
        """Get subscribed topics."""
        with self._lock:
            return list(self._subscriptions)
