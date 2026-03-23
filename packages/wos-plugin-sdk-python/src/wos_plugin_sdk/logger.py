"""
WorldOS Plugin SDK - Logger

Structured logging for plugins with configurable log levels.
"""

import json
import os
import sys
from datetime import datetime, timezone
from enum import IntEnum
from typing import Any, Optional, TextIO


class LogLevel(IntEnum):
    """Log levels for the plugin logger."""

    DEBUG = 0
    INFO = 1
    WARN = 2
    ERROR = 3
    SILENT = 4


# Global log level
_global_log_level: LogLevel = LogLevel.INFO


def set_global_log_level(level: LogLevel) -> None:
    """Set the global log level for all loggers."""
    global _global_log_level
    _global_log_level = level


def get_global_log_level() -> LogLevel:
    """Get the current global log level."""
    return _global_log_level


class Logger:
    """
    Structured logger for WorldOS plugins.

    Outputs JSON-formatted log messages to stdout/stderr
    with timestamps and log levels.
    """

    def __init__(
        self,
        name: str,
        level: Optional[LogLevel] = None,
        output: Optional[TextIO] = None,
    ) -> None:
        """
        Create a new logger.

        Args:
            name: Logger name (usually plugin name)
            level: Log level override (defaults to global level)
            output: Output stream (defaults to stdout for info/debug, stderr for warn/error)
        """
        self.name = name
        self._level = level
        self._output = output

    @property
    def level(self) -> LogLevel:
        """Get the effective log level."""
        return self._level if self._level is not None else _global_log_level

    def _format_message(
        self,
        level: str,
        message: str,
        data: Optional[dict[str, Any]] = None,
    ) -> str:
        """Format a log message as JSON."""
        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": level,
            "logger": self.name,
            "message": message,
        }
        if data:
            log_entry["data"] = data
        return json.dumps(log_entry)

    def _output_stream(self, level: LogLevel) -> TextIO:
        """Get the output stream for a log level."""
        if self._output:
            return self._output
        return sys.stderr if level >= LogLevel.WARN else sys.stdout

    def _log(
        self,
        level: LogLevel,
        level_name: str,
        message: str,
        data: Optional[dict[str, Any]] = None,
    ) -> None:
        """Internal log method."""
        if level < self.level:
            return
        formatted = self._format_message(level_name, message, data)
        output = self._output_stream(level)
        print(formatted, file=output)

    def debug(self, message: str, data: Optional[dict[str, Any]] = None) -> None:
        """Log a debug message."""
        self._log(LogLevel.DEBUG, "debug", message, data)

    def info(self, message: str, data: Optional[dict[str, Any]] = None) -> None:
        """Log an info message."""
        self._log(LogLevel.INFO, "info", message, data)

    def warn(self, message: str, data: Optional[dict[str, Any]] = None) -> None:
        """Log a warning message."""
        self._log(LogLevel.WARN, "warn", message, data)

    def error(
        self,
        message: str,
        error: Optional[Exception] = None,
        data: Optional[dict[str, Any]] = None,
    ) -> None:
        """Log an error message."""
        if error:
            data = data or {}
            data["error"] = {
                "type": type(error).__name__,
                "message": str(error),
            }
        self._log(LogLevel.ERROR, "error", message, data)

    def child(self, name: str) -> "Logger":
        """Create a child logger with an extended name."""
        return Logger(f"{self.name}:{name}", self._level, self._output)


def create_logger(
    name: Optional[str] = None,
    level: Optional[LogLevel] = None,
) -> Logger:
    """
    Create a logger instance.

    If no name is provided, uses the WOS_PLUGIN_NAME environment variable.

    Args:
        name: Logger name (defaults to WOS_PLUGIN_NAME env var)
        level: Log level (defaults to global level)

    Returns:
        Logger instance
    """
    if name is None:
        name = os.environ.get("WOS_PLUGIN_NAME", "plugin")
    return Logger(name, level)
