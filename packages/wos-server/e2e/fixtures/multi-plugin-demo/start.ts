/**
 * Start WorldOS server with identity + world-manager + messaging plugins.
 *
 * Usage: npx tsx start.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

const DEMO_DIR = import.meta.dirname;
const PACKAGES_DIR = path.resolve(DEMO_DIR, '..', '..', '..', '..');
const SERVER_DIR = path.join(DEMO_DIR, 'server');
const PLUGINS_DIR = path.join(SERVER_DIR, 'plugins');

// ── Ensure server directory is set up ──

fs.mkdirSync(path.join(SERVER_DIR, 'logs'), { recursive: true });
fs.mkdirSync(PLUGINS_DIR, { recursive: true });

// Symlink plugins (idempotent)
const plugins: [string, string][] = [
  ['identity', 'wos-plugin-identity'],
  ['world-manager', 'wos-plugin-world-manager'],
  ['messaging', 'wos-plugin-messaging'],
];

for (const [name, pkg] of plugins) {
  const link = path.join(PLUGINS_DIR, name);
  const target = path.join(PACKAGES_DIR, pkg);
  if (!fs.existsSync(link)) {
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : undefined);
  }
}

// Write wos.yaml
fs.writeFileSync(path.join(SERVER_DIR, 'wos.yaml'), `server:
  name: demo-server
  logLevel: info

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
`);

// ── Start server ──

const serverModule = pathToFileURL(path.join(PACKAGES_DIR, 'wos-server', 'dist', 'server.js')).href;
const { WorldOSServer, loadServerConfig } = await import(serverModule);

const config = await loadServerConfig(SERVER_DIR);
const server = new WorldOSServer(config);

server.on('plugin:started', (s: any) => console.log(`  [+] ${s.name} started (PID ${s.pid})`));
server.on('plugin:crashed', (s: any, e: Error) => console.log(`  [!] ${s.name} crashed: ${e.message}`));
server.on('plugin:health', (name: string, status: string) => console.log(`  [health] ${name} = ${status}`));

server.getPluginLoader().on('plugin:output', (name: string, data: string, stream: string) => {
  for (const line of data.split('\n')) {
    const msg = line.trim();
    if (!msg || msg.startsWith('{"type":"health_response"')) continue;
    console.log(`  [${name}] ${msg}`);
  }
});

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  console.log('\n  Shutting down...');
  await server.stop();
  console.log('  Stopped.');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('\n  Starting WorldOS server...\n');
await server.start();

const status = server.getStatus();
console.log(`\n  WorldOS running — ${status.runningPlugins}/${status.totalPlugins} plugins on mqtt://localhost:1884`);
console.log('  Press Ctrl+C to stop.\n');
