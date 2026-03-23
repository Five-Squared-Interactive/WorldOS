"""
WorldOS Plugin SDK - Python

SDK for building WorldOS plugins with MQTT communication,
lifecycle hooks, and health monitoring.
"""

__version__ = "0.1.0"

from .plugin import WOSPlugin, PluginContext, PluginManifest, HealthCheckResult
from .mqtt import PluginMqttClient, PluginMessage, RequestMessage, ResponseMessage
from .logger import create_logger, Logger, LogLevel
from .errors import (
    PluginError,
    ConfigurationError,
    ConnectionError,
    TimeoutError,
    ValidationError,
)

__all__ = [
    # Version
    "__version__",
    # Plugin
    "WOSPlugin",
    "PluginContext",
    "PluginManifest",
    "HealthCheckResult",
    # MQTT
    "PluginMqttClient",
    "PluginMessage",
    "RequestMessage",
    "ResponseMessage",
    # Logger
    "create_logger",
    "Logger",
    "LogLevel",
    # Errors
    "PluginError",
    "ConfigurationError",
    "ConnectionError",
    "TimeoutError",
    "ValidationError",
]
