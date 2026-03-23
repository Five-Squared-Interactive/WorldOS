/**
 * http-health — sample WorldOS plugin
 *
 * Starts a tiny HTTP server that responds to GET /healthz
 * with a JSON payload.  Shows how a plugin can use per-plugin
 * config values passed through environment variables.
 *
 * Config (via wos.yaml → env vars):
 *   port                 – listen port (default 9090)
 *   path                 – endpoint path (default /healthz)
 *   includePluginStatus  – include extra detail (default true)
 */

import { createServer } from 'node:http';

const pluginName = process.env.WOS_PLUGIN_NAME || 'http-health';
const port = Number(process.env.WOS_PLUGIN_HTTP_HEALTH_PORT) || 9090;
const healthPath = process.env.WOS_PLUGIN_HTTP_HEALTH_PATH || '/healthz';

let running = true;
let requestCount = 0;

// ── HTTP server ──────────────────────────────────────────────
const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === healthPath) {
    requestCount++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      plugin: pluginName,
      uptime: process.uptime(),
      requests: requestCount,
      timestamp: Date.now(),
    }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(port, () => {
  console.log(JSON.stringify({
    level: 'info',
    message: `Health endpoint listening on :${port}${healthPath}`,
    plugin: pluginName,
    timestamp: Date.now(),
  }));
});

// ── Health check protocol (stdin/stdout) ─────────────────────
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  for (const line of chunk.split('\n').filter(Boolean)) {
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'health_check') {
        process.stdout.write(JSON.stringify({
          type: 'health_response',
          correlationId: msg.correlationId,
          status: 'ok',
          details: {
            httpPort: port,
            requests: requestCount,
            uptime: process.uptime(),
          },
        }) + '\n');
      }
    } catch {
      // ignore
    }
  }
});

// ── Graceful shutdown ────────────────────────────────────────
function shutdown(signal) {
  running = false;
  server.close(() => {
    console.log(JSON.stringify({
      level: 'info',
      message: `Received ${signal}, HTTP server closed`,
      plugin: pluginName,
      timestamp: Date.now(),
    }));
    process.exit(0);
  });
  // Force exit after 3s if server won't close
  setTimeout(() => process.exit(1), 3000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
