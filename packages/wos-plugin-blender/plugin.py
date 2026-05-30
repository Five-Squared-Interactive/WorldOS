# Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

"""
WorldOS Blender Plugin

Headless Blender integration for model simplification and format conversion.
Listens for simplify/convert requests on MQTT, spawns Blender in background
mode, and publishes results.
"""

import json
import os
import shutil
import subprocess
import sys

# Add the Python SDK to the path
sdk_path = os.path.join(os.path.dirname(__file__), "..", "wos-plugin-sdk-python", "src")
if os.path.isdir(sdk_path):
    sys.path.insert(0, sdk_path)

# Bridge WOS_MQTT_HOST/WOS_MQTT_PORT env vars (set by wos-server) to
# WOS_MQTT_URL (read by the Python SDK).
if "WOS_MQTT_URL" not in os.environ:
    _host = os.environ.get("WOS_MQTT_HOST", "localhost")
    _port = os.environ.get("WOS_MQTT_PORT", "1883")
    os.environ["WOS_MQTT_URL"] = f"mqtt://{_host}:{_port}"

from wos_plugin_sdk import WOSPlugin, PluginContext, HealthCheckResult


def _find_blender():
    """Auto-detect Blender executable."""
    found = shutil.which("blender")
    if found:
        return found
    # Common Windows path
    candidate = r"C:\Program Files\Blender Foundation\Blender 4.5\blender.exe"
    if os.path.isfile(candidate):
        return candidate
    return None


class BlenderPlugin(WOSPlugin):

    def __init__(self):
        super().__init__()
        self._blender_path = None
        self._default_ratio = 0.5
        self._default_format = "glb"
        self._output_dir = None
        self._jobs_completed = 0
        self._jobs_failed = 0
        self._worker_script = os.path.join(os.path.dirname(__file__), "worker.py")

    def on_start(self, context: PluginContext) -> None:
        cfg = context.config
        self._blender_path = cfg.get("blender_path") or _find_blender()
        self._default_ratio = cfg.get("default_ratio", 0.5)
        self._default_format = cfg.get("default_format", "glb")
        self._output_dir = cfg.get("output_dir")

        if not self._blender_path:
            context.logger.error("Blender executable not found. Set blender_path in config.")
            return

        context.logger.info(f"Blender path: {self._blender_path}")

        # Subscribe to job topics
        context.mqtt.subscribe_with_handler(
            "wos/blender/simplify", self._handle_simplify
        )
        context.mqtt.subscribe_with_handler(
            "wos/blender/convert", self._handle_convert
        )

        context.logger.info("Blender plugin ready")

    def on_stop(self) -> None:
        pass

    def on_health_check(self) -> HealthCheckResult:
        if not self._blender_path:
            return HealthCheckResult(
                status="unhealthy",
                error="Blender executable not configured",
            )
        return HealthCheckResult(
            status="ok",
            details={
                "blender_path": self._blender_path,
                "jobs_completed": self._jobs_completed,
                "jobs_failed": self._jobs_failed,
            },
        )

    def _handle_simplify(self, message) -> None:
        """Handle a simplify request.

        Expected payload:
            {
                "model": "/path/to/model.glb",
                "output_dir": "/path/to/output",   (optional)
                "output_format": "glb",             (optional)
                "ratio": 0.5                        (optional)
            }
        """
        payload = message.payload if isinstance(message.payload, dict) else {}
        correlation_id = payload.get("correlationId", "")
        data = payload.get("payload", payload)

        model = data.get("model")
        if not model or not os.path.isfile(model):
            self._publish_error(correlation_id, f"Model not found: {model}")
            return

        ratio = data.get("ratio", self._default_ratio)
        output_format = data.get("output_format", self._default_format)
        output_dir = data.get("output_dir", self._output_dir)

        self._run_blender_job(model, ratio, output_format, output_dir, correlation_id)

    def _handle_convert(self, message) -> None:
        """Handle a format conversion request (ratio=1.0, no decimation).

        Expected payload:
            {
                "model": "/path/to/model.fbx",
                "output_format": "glb",
                "output_dir": "/path/to/output"    (optional)
            }
        """
        payload = message.payload if isinstance(message.payload, dict) else {}
        correlation_id = payload.get("correlationId", "")
        data = payload.get("payload", payload)

        model = data.get("model")
        if not model or not os.path.isfile(model):
            self._publish_error(correlation_id, f"Model not found: {model}")
            return

        output_format = data.get("output_format", self._default_format)
        output_dir = data.get("output_dir", self._output_dir)

        self._run_blender_job(model, 1.0, output_format, output_dir, correlation_id)

    def _run_blender_job(self, model, ratio, output_format, output_dir, correlation_id):
        """Spawn Blender headless to process a model."""
        ctx = self.context
        ctx.logger.info(f"Processing: {model} (ratio={ratio}, format={output_format})")

        # Publish status
        ctx.mqtt.publish_raw("wos/blender/status", {
            "status": "processing",
            "model": model,
            "correlationId": correlation_id,
        })

        # Build output path
        base = os.path.splitext(os.path.basename(model))[0]
        suffix = "simplified" if ratio < 1.0 else "converted"
        out_filename = f"{base}_{suffix}.{output_format}"

        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
            out_path = os.path.join(output_dir, out_filename)
        else:
            out_path = os.path.join(os.path.dirname(model), out_filename)

        cmd = [
            self._blender_path,
            "--background",
            "--python", self._worker_script,
            "--",
            model,
            out_path,
            str(ratio),
        ]

        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=300
            )

            if result.returncode != 0:
                self._jobs_failed += 1
                stderr = result.stderr[-500:] if result.stderr else "unknown error"
                ctx.logger.error(f"Blender failed: {stderr}")
                self._publish_error(correlation_id, f"Blender exited with code {result.returncode}")
                return

            if not os.path.isfile(out_path):
                self._jobs_failed += 1
                self._publish_error(correlation_id, f"Output file not created: {out_path}")
                return

            self._jobs_completed += 1
            file_size = os.path.getsize(out_path)
            ctx.logger.info(f"Complete: {out_path} ({file_size} bytes)")

            # Publish result
            result_payload = {
                "status": "complete",
                "model": model,
                "output": out_path,
                "output_format": output_format,
                "ratio": ratio,
                "file_size": file_size,
            }
            if correlation_id:
                ctx.mqtt.respond("wos/blender/result", correlation_id, result_payload)
            else:
                ctx.mqtt.publish_raw("wos/blender/result", result_payload)

        except subprocess.TimeoutExpired:
            self._jobs_failed += 1
            ctx.logger.error(f"Blender timed out processing: {model}")
            self._publish_error(correlation_id, "Blender process timed out (300s)")
        except Exception as e:
            self._jobs_failed += 1
            ctx.logger.error(f"Error running Blender: {e}")
            self._publish_error(correlation_id, str(e))

    def _publish_error(self, correlation_id, error_msg):
        ctx = self.context
        if correlation_id:
            ctx.mqtt.respond_error(
                "wos/blender/result", correlation_id,
                "BLENDER_ERROR", error_msg,
            )
        else:
            ctx.mqtt.publish_raw("wos/blender/status", {
                "status": "error",
                "error": error_msg,
            })


plugin = BlenderPlugin()

if __name__ == "__main__":
    plugin.run()
