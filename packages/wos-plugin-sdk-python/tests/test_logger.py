"""Tests for logger."""

import json
import io
import os
from unittest.mock import patch

import pytest

from wos_plugin_sdk.logger import (
    Logger,
    LogLevel,
    create_logger,
    get_global_log_level,
    set_global_log_level,
)


class TestLogLevel:
    def test_levels_ordered_correctly(self):
        assert LogLevel.DEBUG < LogLevel.INFO
        assert LogLevel.INFO < LogLevel.WARN
        assert LogLevel.WARN < LogLevel.ERROR
        assert LogLevel.ERROR < LogLevel.SILENT


class TestGlobalLogLevel:
    def test_default_level_is_info(self):
        # Reset to default
        set_global_log_level(LogLevel.INFO)
        assert get_global_log_level() == LogLevel.INFO

    def test_can_change_global_level(self):
        set_global_log_level(LogLevel.DEBUG)
        assert get_global_log_level() == LogLevel.DEBUG
        set_global_log_level(LogLevel.INFO)  # Reset


class TestLogger:
    def test_create_logger_with_name(self):
        logger = Logger("test-plugin")
        assert logger.name == "test-plugin"

    def test_logger_uses_global_level(self):
        set_global_log_level(LogLevel.WARN)
        logger = Logger("test")
        assert logger.level == LogLevel.WARN
        set_global_log_level(LogLevel.INFO)  # Reset

    def test_logger_can_override_level(self):
        logger = Logger("test", level=LogLevel.ERROR)
        assert logger.level == LogLevel.ERROR

    def test_info_outputs_json(self):
        output = io.StringIO()
        logger = Logger("test", output=output)
        logger.info("Test message")

        output.seek(0)
        line = output.readline()
        data = json.loads(line)

        assert data["level"] == "info"
        assert data["logger"] == "test"
        assert data["message"] == "Test message"
        assert "timestamp" in data

    def test_info_with_data(self):
        output = io.StringIO()
        logger = Logger("test", output=output)
        logger.info("Test", {"key": "value"})

        output.seek(0)
        data = json.loads(output.readline())
        assert data["data"] == {"key": "value"}

    def test_debug_respects_level(self):
        output = io.StringIO()
        logger = Logger("test", level=LogLevel.INFO, output=output)
        logger.debug("Debug message")

        output.seek(0)
        assert output.read() == ""  # No output

    def test_error_includes_exception(self):
        output = io.StringIO()
        logger = Logger("test", output=output)
        try:
            raise ValueError("test error")
        except ValueError as e:
            logger.error("Error occurred", error=e)

        output.seek(0)
        data = json.loads(output.readline())
        assert data["data"]["error"]["type"] == "ValueError"
        assert data["data"]["error"]["message"] == "test error"

    def test_child_logger(self):
        parent = Logger("parent")
        child = parent.child("child")
        assert child.name == "parent:child"


class TestCreateLogger:
    def test_creates_with_name(self):
        logger = create_logger("my-plugin")
        assert logger.name == "my-plugin"

    def test_uses_env_var_when_no_name(self):
        with patch.dict(os.environ, {"WOS_PLUGIN_NAME": "env-plugin"}):
            logger = create_logger()
            assert logger.name == "env-plugin"

    def test_defaults_to_plugin_when_no_env(self):
        with patch.dict(os.environ, {}, clear=True):
            os.environ.pop("WOS_PLUGIN_NAME", None)
            logger = create_logger()
            assert logger.name == "plugin"

    def test_accepts_log_level(self):
        logger = create_logger("test", level=LogLevel.ERROR)
        assert logger.level == LogLevel.ERROR
