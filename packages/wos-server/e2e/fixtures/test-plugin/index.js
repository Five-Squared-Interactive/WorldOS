/**
 * E2E Test Plugin
 *
 * MQTT-aware plugin for E2E testing of the WorldOS server.
 * Responds to health checks via MQTT topics and supports
 * configurable behavior for different test scenarios.
 */

// Track plugin state
let isRunning = false;
let healthCheckCount = 0;
const pluginName = process.env.WOS_PLUGIN_NAME || 'e2e-test-plugin';

/**
 * Handle MQTT messages (simulated via stdin for testing)
 */
process.stdin.on('data', (data) => {
  try {
    const message = JSON.parse(data.toString().trim());

    if (message.type === 'health_check') {
      healthCheckCount++;
      const response = {
        type: 'health_response',
        correlationId: message.correlationId,
        status: 'ok',
        details: {
          healthCheckCount,
          uptime: process.uptime(),
        },
      };
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  } catch (e) {
    // Ignore parse errors
  }
});

/**
 * Handle graceful shutdown
 */
function shutdown(signal) {
  console.log(`[${pluginName}] Received ${signal}, shutting down gracefully`);
  isRunning = false;
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/**
 * Main plugin entry point
 */
function main() {
  console.log(`[${pluginName}] Plugin starting`);

  isRunning = true;

  console.log(`[${pluginName}] Plugin started successfully`, JSON.stringify({
    pid: process.pid,
    env: {
      WOS_PLUGIN_NAME: process.env.WOS_PLUGIN_NAME,
      WOS_MQTT_HOST: process.env.WOS_MQTT_HOST,
      WOS_SERVER_DIR: process.env.WOS_SERVER_DIR,
    },
  }));

  // Keep the process running
  setInterval(() => {
    if (isRunning) {
      // silent heartbeat
    }
  }, 5000);
}

main();
