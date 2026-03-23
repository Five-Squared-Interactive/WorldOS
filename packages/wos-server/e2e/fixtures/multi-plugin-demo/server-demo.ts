/**
 * Integrated WorldOS Server Demo
 *
 * Starts a REAL WorldOS server with embedded Mosquitto MQTT broker
 * and three plugins running as child processes:
 *   - Identity (user auth, JWT tokens)
 *   - World Manager (world state, entities, templates)
 *   - Messaging (channels, messages, DMs)
 *
 * This is the full server stack — not a mock. Plugins communicate
 * over real MQTT, health monitoring is active, and you see real
 * wos-server logs.
 *
 * Run:
 *   npx tsx server-demo.ts
 *
 * Press Ctrl+C to stop.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pathToFileURL } from 'url';

// Resolve paths relative to this script
const PACKAGES_DIR = path.resolve(import.meta.dirname, '..', '..', '..', '..');

async function main() {
  // ── Create server directory ──
  const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-server-demo-'));
  const pluginsDir = path.join(serverDir, 'plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });
  fs.mkdirSync(path.join(serverDir, 'logs'), { recursive: true });

  console.log(`\n  WorldOS Integrated Server Demo`);
  console.log(`  Server directory: ${serverDir}`);
  console.log(`  Packages: ${PACKAGES_DIR}\n`);

  // ── Symlink plugin packages into plugins/ ──
  const pluginLinks: [string, string][] = [
    ['identity', 'wos-plugin-identity'],
    ['world-manager', 'wos-plugin-world-manager'],
    ['messaging', 'wos-plugin-messaging'],
  ];

  for (const [name, pkg] of pluginLinks) {
    const target = path.join(PACKAGES_DIR, pkg);
    const link = path.join(pluginsDir, name);

    // Use junction on Windows (works without admin), symlink elsewhere
    if (process.platform === 'win32') {
      fs.symlinkSync(target, link, 'junction');
    } else {
      fs.symlinkSync(target, link);
    }
    console.log(`  Linked plugin: ${name} -> ${target}`);
  }

  // ── Write wos.yaml config ──
  const wosYaml = `# WorldOS Demo Server Configuration
server:
  name: demo-server
  logLevel: debug

mqtt:
  embedded: true
  host: localhost
  port: 1884

admin:
  enabled: true
  port: 3000

plugins:
  identity:
    enabled: true
    config:
      allow_registration: true
      jwt_secret: demo-secret-key-for-testing-only
      access_token_ttl: 3600
      refresh_token_ttl: 86400
  world-manager:
    enabled: true
    config:
      world_name: Demo World
      world_type: space
      world_owner: system
  messaging:
    enabled: true
    config:
      retentionLimit: 1000
      maxContentLength: 4000
`;

  fs.writeFileSync(path.join(serverDir, 'wos.yaml'), wosYaml);
  console.log(`  Wrote wos.yaml\n`);

  // ── Import and start the server ──
  const serverModulePath = path.join(PACKAGES_DIR, 'wos-server', 'dist', 'server.js');
  const { WorldOSServer, loadServerConfig } = await import(
    pathToFileURL(serverModulePath).href
  );

  const config = await loadServerConfig(serverDir);
  const server = new WorldOSServer(config);

  // ── Wire up event logging ──
  server.on('server:starting', () => {
    console.log(`  [server] Starting...`);
  });

  server.on('server:started', () => {
    console.log(`  [server] Started!`);
    console.log(`  [server] MQTT broker on localhost:1884`);
    printStatus();
  });

  server.on('plugin:started', (status: any) => {
    console.log(`  [server] Plugin started: ${status.name} (PID ${status.pid})`);
  });

  server.on('plugin:stopped', (status: any) => {
    console.log(`  [server] Plugin stopped: ${status.name}`);
  });

  server.on('plugin:crashed', (status: any, error: Error) => {
    console.log(`  [server] Plugin crashed: ${status.name} - ${error.message}`);
  });

  server.on('plugin:health', (name: string, healthStatus: string) => {
    console.log(`  [server] Health: ${name} = ${healthStatus}`);
  });

  server.on('server:error', (error: Error) => {
    console.error(`  [server] Error: ${error.message}`);
  });

  // Capture plugin stdout/stderr (filter out health check JSON noise)
  server.getPluginLoader().on('plugin:output', (name: string, data: string, stream: string) => {
    for (const line of data.split('\n')) {
      const msg = line.trim();
      if (!msg) continue;
      // Skip raw health response JSON (already shown via health events)
      if (msg.startsWith('{"type":"health_response"')) continue;
      console.log(`  [${name}:${stream}] ${msg}`);
    }
  });

  function printStatus() {
    const status = server.getStatus();
    console.log(`\n  ── Server Status ──`);
    console.log(`  State: ${status.state}`);
    console.log(`  Plugins: ${status.runningPlugins}/${status.totalPlugins} running`);
    console.log(`  Health: ${status.health}`);

    const plugins = server.getAllPluginStatuses();
    for (const p of plugins) {
      console.log(`    ${p.name}: ${p.state} (PID ${p.pid ?? '-'})`);
    }
    console.log();
  }

  // ── Graceful shutdown on Ctrl+C ──
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log(`\n  [server] Shutting down...`);
    try {
      await server.stop();
      console.log(`  [server] Stopped.`);
    } catch (err: any) {
      console.error(`  [server] Shutdown error: ${err.message}`);
    }

    // Clean up temp dir
    try {
      fs.rmSync(serverDir, { recursive: true, force: true });
      console.log(`  Cleaned up ${serverDir}`);
    } catch {
      // Ignore cleanup errors
    }

    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // ── Start! ──
  console.log(`  Starting WorldOS server...\n`);
  await server.start();

  // ── Start admin panel ──
  try {
    const adminPkgPath = path.join(PACKAGES_DIR, 'wos-admin');
    const { startAdminServer, AuthManager } = await import(
      pathToFileURL(path.join(adminPkgPath, 'dist', 'index.js')).href
    );

    const authManager = new AuthManager();
    const staticDir = path.join(adminPkgPath, 'public');

    // Register admin panels for plugins that have an admin/ directory
    const panels: { name: string; displayName: string; entryPoint: string; icon?: string; route?: string }[] = [];
    const panelTitles: Record<string, string> = {
      'identity': 'User Identity',
      'world-manager': 'World Manager',
      'messaging': 'Messaging',
    };
    for (const [pluginName] of pluginLinks) {
      const panelPath = path.join(pluginsDir, pluginName, 'admin', 'panel.js');
      if (fs.existsSync(panelPath)) {
        panels.push({
          name: pluginName,
          displayName: panelTitles[pluginName] || pluginName,
          entryPoint: `/plugins/${pluginName}/admin/panel.js`,
        });
      }
    }

    await startAdminServer({
      port: 3000,
      serverDir,
      authManager,
      staticDir,
      mqttClient: server.getAdminMqttClient(),
      pluginRegistry: server.getRegistry(),
      configManager: server.getConfigManager(),
      pluginLoader: server.getPluginLoader(),
      logAggregator: server.getLogAggregator(),
      panels,
    });

    console.log(`  [admin] Web admin panel listening on http://localhost:3000`);
    if (panels.length > 0) {
      console.log(`  [admin] Plugin panels: ${panels.map(p => p.displayName).join(', ')}`);
    }
  } catch (err: any) {
    console.error(`  [admin] Failed to start admin panel: ${err.message}`);
  }

  // Print status periodically
  setInterval(() => {
    if (!stopping) printStatus();
  }, 15_000);

  // Keep alive
  console.log(`  Server running. Press Ctrl+C to stop.\n`);
}

main().catch(err => {
  console.error('Demo failed:', err);
  process.exit(1);
});
