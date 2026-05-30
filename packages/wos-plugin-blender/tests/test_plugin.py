# Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

"""
Unit tests for the Blender plugin logic.
Runs with standard Python (no Blender needed).
"""

import os
import sys
import unittest
from unittest.mock import MagicMock, patch

# Add plugin dir and SDK to path
plugin_dir = os.path.join(os.path.dirname(__file__), "..")
sdk_dir = os.path.join(plugin_dir, "..", "wos-plugin-sdk-python", "src")
sys.path.insert(0, plugin_dir)
sys.path.insert(0, sdk_dir)

from plugin import BlenderPlugin, _find_blender


class TestFindBlender(unittest.TestCase):
    """Tests for Blender auto-detection."""

    @patch("shutil.which", return_value="/usr/bin/blender")
    def test_finds_blender_on_path(self, mock_which):
        result = _find_blender()
        self.assertEqual(result, "/usr/bin/blender")

    @patch("shutil.which", return_value=None)
    @patch("os.path.isfile", return_value=False)
    def test_returns_none_when_not_found(self, mock_isfile, mock_which):
        result = _find_blender()
        self.assertIsNone(result)


class TestBlenderPluginInit(unittest.TestCase):
    """Tests for plugin initialization."""

    def test_default_values(self):
        p = BlenderPlugin()
        self.assertEqual(p._default_ratio, 0.5)
        self.assertEqual(p._default_format, "glb")
        self.assertIsNone(p._output_dir)
        self.assertEqual(p._jobs_completed, 0)
        self.assertEqual(p._jobs_failed, 0)


class TestBlenderPluginHealthCheck(unittest.TestCase):
    """Tests for health check responses."""

    def test_unhealthy_without_blender(self):
        p = BlenderPlugin()
        p._blender_path = None
        result = p.on_health_check()
        self.assertEqual(result.status, "unhealthy")

    def test_healthy_with_blender(self):
        p = BlenderPlugin()
        p._blender_path = "/usr/bin/blender"
        result = p.on_health_check()
        self.assertEqual(result.status, "ok")
        self.assertEqual(result.details["blender_path"], "/usr/bin/blender")
        self.assertEqual(result.details["jobs_completed"], 0)


class TestBlenderPluginOnStart(unittest.TestCase):
    """Tests for plugin on_start behavior."""

    def _make_context(self, config=None):
        ctx = MagicMock()
        ctx.config = config or {}
        ctx.logger = MagicMock()
        ctx.mqtt = MagicMock()
        return ctx

    @patch("plugin._find_blender", return_value="/usr/bin/blender")
    def test_on_start_subscribes_to_topics(self, mock_find):
        p = BlenderPlugin()
        ctx = self._make_context()
        p.on_start(ctx)

        calls = ctx.mqtt.subscribe_with_handler.call_args_list
        topics = [c[0][0] for c in calls]
        self.assertIn("wos/blender/simplify", topics)
        self.assertIn("wos/blender/convert", topics)

    @patch("plugin._find_blender", return_value=None)
    def test_on_start_logs_error_without_blender(self, mock_find):
        p = BlenderPlugin()
        ctx = self._make_context()
        p.on_start(ctx)

        ctx.logger.error.assert_called()
        ctx.mqtt.subscribe_with_handler.assert_not_called()

    @patch("plugin._find_blender", return_value="/usr/bin/blender")
    def test_on_start_uses_config_values(self, mock_find):
        p = BlenderPlugin()
        ctx = self._make_context(config={
            "blender_path": "/custom/blender",
            "default_ratio": 0.3,
            "default_format": "fbx",
            "output_dir": "/tmp/output",
        })
        p.on_start(ctx)

        self.assertEqual(p._blender_path, "/custom/blender")
        self.assertEqual(p._default_ratio, 0.3)
        self.assertEqual(p._default_format, "fbx")
        self.assertEqual(p._output_dir, "/tmp/output")


class TestBlenderPluginHandlers(unittest.TestCase):
    """Tests for message handler logic."""

    def _make_plugin_with_context(self):
        p = BlenderPlugin()
        ctx = MagicMock()
        ctx.config = {}
        ctx.logger = MagicMock()
        ctx.mqtt = MagicMock()
        p._context = ctx
        p._blender_path = "/usr/bin/blender"
        return p

    def test_simplify_rejects_missing_model(self):
        p = self._make_plugin_with_context()
        msg = MagicMock()
        msg.payload = {"model": "/nonexistent/model.glb"}

        p._handle_simplify(msg)
        # No correlationId so error goes via publish_raw
        p.context.mqtt.publish_raw.assert_called()
        call_args = p.context.mqtt.publish_raw.call_args[0]
        self.assertEqual(call_args[0], "wos/blender/status")
        self.assertEqual(call_args[1]["status"], "error")

    def test_convert_rejects_missing_model(self):
        p = self._make_plugin_with_context()
        msg = MagicMock()
        msg.payload = {"model": "/nonexistent/model.glb"}

        p._handle_convert(msg)
        p.context.mqtt.publish_raw.assert_called()
        call_args = p.context.mqtt.publish_raw.call_args[0]
        self.assertEqual(call_args[0], "wos/blender/status")
        self.assertEqual(call_args[1]["status"], "error")

    def test_simplify_rejects_missing_model_with_correlation(self):
        """When correlationId is present, uses respond_error."""
        p = self._make_plugin_with_context()
        msg = MagicMock()
        msg.payload = {"correlationId": "abc-123", "payload": {"model": "/nonexistent/model.glb"}}

        p._handle_simplify(msg)
        p.context.mqtt.respond_error.assert_called()

    @patch("subprocess.run")
    def test_simplify_spawns_blender(self, mock_run):
        p = self._make_plugin_with_context()
        mock_run.return_value = MagicMock(returncode=0)

        # Create a real temp file to act as input
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as f:
            tmp_path = f.name
        try:
            msg = MagicMock()
            msg.payload = {"model": tmp_path, "ratio": 0.5}

            # Patch os.path.isfile for output check
            with patch("os.path.isfile", side_effect=lambda p: p == tmp_path or True), \
                 patch("os.path.getsize", return_value=1024):
                p._handle_simplify(msg)

            mock_run.assert_called_once()
            cmd = mock_run.call_args[0][0]
            self.assertEqual(cmd[0], "/usr/bin/blender")
            self.assertIn("--background", cmd)
            self.assertIn("0.5", cmd)
        finally:
            os.unlink(tmp_path)


if __name__ == "__main__":
    unittest.main()
