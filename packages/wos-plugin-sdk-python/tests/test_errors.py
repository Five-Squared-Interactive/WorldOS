"""Tests for error types."""

import pytest

from wos_plugin_sdk.errors import (
    ConfigurationError,
    ConnectionError,
    PluginError,
    TimeoutError,
    ValidationError,
    is_plugin_error,
    wrap_error,
)


class TestPluginError:
    def test_create_basic_error(self):
        error = PluginError("Something went wrong")
        assert str(error) == "Something went wrong"
        assert error.code == "PLUGIN_ERROR"
        assert error.details == {}

    def test_create_error_with_code(self):
        error = PluginError("Not found", code="NOT_FOUND")
        assert error.code == "NOT_FOUND"

    def test_create_error_with_details(self):
        error = PluginError("Error", details={"key": "value"})
        assert error.details == {"key": "value"}

    def test_to_dict(self):
        error = PluginError("Test error", code="TEST", details={"foo": "bar"})
        result = error.to_dict()
        assert result == {
            "code": "TEST",
            "message": "Test error",
            "details": {"foo": "bar"},
        }


class TestConfigurationError:
    def test_creates_with_correct_code(self):
        error = ConfigurationError("Invalid config")
        assert error.code == "CONFIGURATION_ERROR"

    def test_includes_details(self):
        error = ConfigurationError("Missing field", {"field": "name"})
        assert error.details == {"field": "name"}


class TestConnectionError:
    def test_creates_with_correct_code(self):
        error = ConnectionError("Failed to connect")
        assert error.code == "CONNECTION_ERROR"


class TestTimeoutError:
    def test_creates_with_correct_code(self):
        error = TimeoutError("Operation timed out")
        assert error.code == "TIMEOUT_ERROR"

    def test_includes_timeout_in_details(self):
        error = TimeoutError("Timeout", timeout_ms=5000)
        assert error.details == {"timeout_ms": 5000}


class TestValidationError:
    def test_creates_with_correct_code(self):
        error = ValidationError("Validation failed")
        assert error.code == "VALIDATION_ERROR"

    def test_includes_errors_in_details(self):
        errors = [
            {"field": "name", "message": "required"},
            {"field": "version", "message": "invalid format"},
        ]
        error = ValidationError("Validation failed", errors=errors)
        assert error.details["errors"] == errors


class TestIsPluginError:
    def test_returns_true_for_plugin_error(self):
        assert is_plugin_error(PluginError("test"))

    def test_returns_true_for_subclass(self):
        assert is_plugin_error(ConfigurationError("test"))
        assert is_plugin_error(TimeoutError("test"))

    def test_returns_false_for_other_errors(self):
        assert not is_plugin_error(ValueError("test"))
        assert not is_plugin_error(Exception("test"))


class TestWrapError:
    def test_returns_plugin_error_unchanged(self):
        original = PluginError("original")
        wrapped = wrap_error(original)
        assert wrapped is original

    def test_wraps_generic_exception(self):
        original = ValueError("some error")
        wrapped = wrap_error(original)
        assert isinstance(wrapped, PluginError)
        assert "some error" in wrapped.message
        assert wrapped.details["original_type"] == "ValueError"

    def test_includes_context(self):
        original = ValueError("error")
        wrapped = wrap_error(original, "During operation")
        assert "During operation" in wrapped.message
