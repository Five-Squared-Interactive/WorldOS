/**
 * hello-logger — sample WorldOS plugin
 *
 * Demonstrates the plugin contract:
 *   1. Reads config from WOS_PLUGIN_* environment variables
 *   2. Responds to health checks via stdin JSON messages
 *   3. Handles SIGTERM/SIGINT for graceful shutdown
 *   4. Stays alive until told to stop
 */

const pluginName = process.env.WOS_PLUGIN_NAME || 'hello-logger';
const mqttHost   = process.env.WOS_MQTT_HOST   || 'localhost';
const mqttPort   = process.env.WOS_MQTT_PORT   || '1883';
const serverDir  = process.env.WOS_SERVER_DIR   || '.';
const logLevel   = process.env.WOS_PLUGIN_HELLO_LOGGER_LOGLEVEL || 'info';

let running = true;
let healthChecks = 0;

// ── Health check protocol ────────────────────────────────────
// The server sends JSON on stdin; we reply on stdout.
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  for (const line of chunk.split('\n').filter(Boolean)) {
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'health_check') {
        healthChecks++;
        process.stdout.write(JSON.stringify({
          type: 'health_response',
          correlationId: msg.correlationId,
          status: 'ok',
          details: {
            healthChecks,
            uptime: process.uptime(),
          },
        }) + '\n');
      }
    } catch {
      // not JSON — ignore
    }
  }
});

// ── Graceful shutdown ────────────────────────────────────────
function shutdown(signal) {
  console.log(JSON.stringify({
    level: 'info',
    message: `Received ${signal}, shutting down`,
    plugin: pluginName,
    timestamp: Date.now(),
  }));
  running = false;
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── Main ─────────────────────────────────────────────────────
console.log(JSON.stringify({
  level: 'info',
  message: `Plugin started`,
  plugin: pluginName,
  timestamp: Date.now(),
  data: { mqttHost, mqttPort, serverDir, logLevel },
}));

// Periodic heartbeat — always logs at info every 30s so the dashboard has something to show
let heartbeatCount = 0;
setInterval(() => {
  if (!running) return;
  heartbeatCount++;
  const level = logLevel === 'debug' ? 'debug' : 'info';
  console.log(JSON.stringify({
    level,
    message: `heartbeat #${heartbeatCount} — uptime ${Math.floor(process.uptime())}s`,
    plugin: pluginName,
    timestamp: Date.now(),
  }));
}, 30000);

// Also log a "ready" message shortly after start so there's immediate feedback
setTimeout(() => {
  if (!running) return;
  console.log(JSON.stringify({
    level: 'info',
    message: 'Plugin ready and listening for MQTT events',
    plugin: pluginName,
    timestamp: Date.now(),
    data: { mqttHost, mqttPort },
  }));
}, 2000);
