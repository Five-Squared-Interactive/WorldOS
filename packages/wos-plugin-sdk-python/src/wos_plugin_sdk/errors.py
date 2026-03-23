"""
WorldOS Plugin SDK - Error Types

Custom error types for plugin operations.
"""

from typing import Any, Optional


class PluginError(Exception):
    """Base error class for plugin errors."""

    def __init__(
        self,
        message: str,
        code: str = "PLUGIN_ERROR",
        details: Optional[dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details or {}

    def to_dict(self) -> dict[str, Any]:
        """Convert error to dictionary for serialization."""
        return {
            "code": self.code,
            "message": self.message,
            "details": self.details,
        }


class ConfigurationError(PluginError):
    """Error in plugin configuration."""

    def __init__(
        self,
        message: str,
        details: Optional[dict[str, Any]] = None,
    ) -> None:
        super().__init__(message, "CONFIGURATION_ERROR", details)


class ConnectionError(PluginError):
    """Error connecting to MQTT broker or other services."""

    def __init__(
        self,
        message: str,
        details: Optional[dict[str, Any]] = None,
    ) -> None:
        super().__init__(message, "CONNECTION_ERROR", details)


class TimeoutError(PluginError):
    """Operation timed out."""

    def __init__(
        self,
        message: str,
        timeout_ms: Optional[int] = None,
        details: Optional[dict[str, Any]] = None,
    ) -> None:
        details = details or {}
        if timeout_ms is not None:
            details["timeout_ms"] = timeout_ms
        super().__init__(message, "TIMEOUT_ERROR", details)


class ValidationError(PluginError):
    """Validation error with field-level details."""

    def __init__(
        self,
        message: str,
        errors: Optional[list[dict[str, str]]] = None,
        details: Optional[dict[str, Any]] = None,
    ) -> None:
        details = details or {}
        if errors:
            details["errors"] = errors
        super().__init__(message, "VALIDATION_ERROR", details)


def is_plugin_error(error: Exception) -> bool:
    """Check if an error is a PluginError."""
    return isinstance(error, PluginError)


def wrap_error(error: Exception, context: str = "") -> PluginError:
    """Wrap a generic exception as a PluginError."""
    if isinstance(error, PluginError):
        return error
    message = f"{context}: {str(error)}" if context else str(error)
    return PluginError(message, "WRAPPED_ERROR", {"original_type": type(error).__name__})
