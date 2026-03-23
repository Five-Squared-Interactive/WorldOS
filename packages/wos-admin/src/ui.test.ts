/**
 * UI Integration Tests
 *
 * These tests use faithful reproductions of wos-server's real classes
 * (PluginRegistry, ConfigManager, LogAggregator) with ONLY the methods
 * that exist on the real classes. If server.ts calls a method that doesn't
 * exist on the real class (e.g. getPlugin instead of get), the test fails.
 *
 * This catches interface mismatches that mocked tests miss.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAdminServer } from './server.js';
import { AuthManager } from './auth.js';
import type { FastifyInstance } from 'fastify';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');

// ────────────────────────────────────────────────────────────────
// Faithful reproductions of wos-server classes.
// These have ONLY the methods the real classes expose.
// No extra methods, no renamed methods.
// ────────────────────────────────────────────────────────────────

/**
 * Matches wos-server/src/plugin-registry/plugin-registry.ts
 * Real methods: load, get, getAll, enable, disable, register, unregister, ...
 * NOT: getPlugin, setEnabled
 */
class TestPluginRegistry {
  private plugins = new Map<string, { name: string; version: string; enabled: boolean; source: { type: string; path: string }; installedAt: string; description?: string }>();
  private serverDir: string;

  constructor(serverDir: string) {
    this.serverDir = serverDir;
  }

  async load(): Promise<void> {
    // Parse wos.yaml like the real registry does
    const configPath = path.join(this.serverDir, 'wos.yaml');
    try {
      const { parse } = await import('yaml');
      const content = await fs.readFile(configPath, 'utf-8');
      const config = parse(content) ?? {};
      const pluginsSection = config.plugins as Record<string, Record<string, unknown>> | undefined;
      if (pluginsSection) {
        for (const [name, data] of Object.entries(pluginsSection)) {
          if (data && typeof data === 'object') {
            this.plugins.set(name, {
              name,
              version: (data.version as string) ?? '0.0.0',
              enabled: data.enabled !== false,
              source: { type: 'local', path: (data.source as string) ?? `./plugins/${name}` },
              installedAt: new Date().toISOString(),
              description: data.description as string | undefined,
            });
          }
        }
      }
    } catch { /* no config */ }
  }

  get(name: string) {
    return this.plugins.get(name);
  }

  getAll() {
    return Array.from(this.plugins.values());
  }

  async enable(name: string): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) throw new Error(`Plugin '${name}' not found`);
    entry.enabled = true;
  }

  async disable(name: string): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) throw new Error(`Plugin '${name}' not found`);
    entry.enabled = false;
  }

  getEnabled() {
    return this.getAll().filter(p => p.enabled);
  }

  has(name: string) {
    return this.plugins.has(name);
  }

  isEnabled(name: string) {
    return this.plugins.get(name)?.enabled ?? false;
  }
}

/**
 * Matches wos-server/src/config/config-manager.ts
 * Real methods: loadConfig, saveConfig, validateConfig, ...
 * NOT: updateConfig
 */
class TestConfigManager {
  private serverDir: string;
  private configs = new Map<string, Record<string, unknown>>();

  constructor(serverDir: string) {
    this.serverDir = serverDir;
  }

  async loadConfig(pluginName: string): Promise<Record<string, unknown>> {
    return this.configs.get(pluginName) ?? {};
  }

  async saveConfig(pluginName: string, config: Record<string, unknown>): Promise<void> {
    this.configs.set(pluginName, config);
  }

  // Test helper to pre-seed config
  _seed(pluginName: string, config: Record<string, unknown>) {
    this.configs.set(pluginName, config);
  }
}

/**
 * Matches wos-server/src/plugin-loader/plugin-loader.ts status output.
 * Real methods: getPluginStatus, getAllPluginStatuses, restartPlugin, ...
 */
class TestPluginLoader {
  private statuses = new Map<string, {
    name: string;
    state: string;
    pid?: number;
    startedAt?: Date;
    restartCount: number;
    consecutiveHealthFailures: number;
    manifest: { name: string; version: string; runtime: string; main: string };
    pluginDir: string;
  }>();

  getPluginStatus(name: string) {
    return this.statuses.get(name);
  }

  getAllPluginStatuses() {
    return Array.from(this.statuses.values());
  }

  async startPlugin(name: string): Promise<void> {
    const s = this.statuses.get(name);
    if (s) {
      s.state = 'running';
    } else {
      // Plugin not tracked yet, create a new entry
      this._addRunning(name);
    }
  }

  async stopPlugin(name: string): Promise<void> {
    const s = this.statuses.get(name);
    if (!s) throw new Error(`Plugin '${name}' not found`);
    s.state = 'stopped';
  }

  async restartPlugin(name: string): Promise<void> {
    const s = this.statuses.get(name);
    if (!s) throw new Error(`Plugin '${name}' not found`);
    // simulate restart
    s.state = 'running';
  }

  // Test helper
  _addRunning(name: string) {
    this.statuses.set(name, {
      name,
      state: 'running',
      pid: 12345,
      startedAt: new Date(),
      restartCount: 0,
      consecutiveHealthFailures: 0,
      manifest: { name, version: '1.0.0', runtime: 'node', main: 'index.js' },
      pluginDir: `/plugins/${name}`,
    });
  }

  _addStopped(name: string) {
    this.statuses.set(name, {
      name,
      state: 'stopped',
      restartCount: 0,
      consecutiveHealthFailures: 0,
      manifest: { name, version: '1.0.0', runtime: 'node', main: 'index.js' },
      pluginDir: `/plugins/${name}`,
    });
  }
}

/**
 * Matches wos-server/src/logging/log-aggregator.ts
 * Real class extends EventEmitter and has: log, writeLog, readLogs, readAllLogs, streamLogs, streamAllLogs
 */
class TestLogAggregator extends EventEmitter {
  private logsDir: string;

  constructor(logsDir: string) {
    super();
    this.logsDir = logsDir;
  }

  log(pluginName: string, level: string, message: string) {
    const entry = { plugin: pluginName, level, message, timestamp: Date.now() };
    this.emit(`log:${pluginName}`, entry);
    this.emit('log', entry);
  }

  async readAllLogs(options: { limit?: number; level?: string; since?: number } = {}) {
    const { limit = 100, level, since } = options;
    let allEntries: { plugin: string; level: string; message: string; timestamp: number }[] = [];

    try {
      const files = await fs.readdir(this.logsDir);
      for (const file of files.filter(f => f.endsWith('.log'))) {
        const content = await fs.readFile(path.join(this.logsDir, file), 'utf-8');
        const entries = content.trim().split('\n').filter(Boolean).map(l => {
          try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean);
        allEntries.push(...entries);
      }
    } catch { /* no logs dir */ }

    if (level) allEntries = allEntries.filter(e => e.level === level);
    if (since) allEntries = allEntries.filter(e => e.timestamp >= since);
    allEntries.sort((a, b) => b.timestamp - a.timestamp);
    return allEntries.slice(0, limit);
  }

  streamAllLogs(callback: (entry: any) => void) {
    this.on('log', callback);
    return () => this.off('log', callback);
  }
}

// ────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────

async function createTmpServerDir() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-ui-test-'));
  await fs.writeFile(path.join(tmpDir, 'wos.yaml'), `
server:
  name: test-server
  logLevel: info
mqtt:
  embedded: true
  port: 1883
admin:
  enabled: true
  port: 3000
plugins:
  hello-logger:
    enabled: true
    version: "1.0.0"
    source: ./plugins/hello-logger
    description: "Logs hello"
  http-health:
    enabled: false
    version: "0.3.0"
    source: ./plugins/http-health
`);
  await fs.mkdir(path.join(tmpDir, 'plugins'), { recursive: true });
  return tmpDir;
}

async function writeLogFiles(tmpDir: string) {
  const logsDir = path.join(tmpDir, 'logs');
  await fs.mkdir(logsDir, { recursive: true });
  const now = Date.now();
  const entries = [
    { plugin: 'hello-logger', level: 'info', message: 'Plugin started', timestamp: now - 3000 },
    { plugin: 'hello-logger', level: 'info', message: 'Hello world!', timestamp: now - 2000 },
    { plugin: 'hello-logger', level: 'warn', message: 'Something odd', timestamp: now - 1000 },
    { plugin: 'hello-logger', level: 'error', message: 'Crash!', timestamp: now },
  ];
  await fs.writeFile(
    path.join(logsDir, 'hello-logger.log'),
    entries.map(e => JSON.stringify(e)).join('\n') + '\n'
  );
  return { logsDir, entries, now };
}

// ────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────

describe('UI Integration (real interfaces)', () => {
  let server: FastifyInstance;
  let tmpDir: string;

  afterEach(async () => {
    if (server) await server.close();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Auth Bypass ──────────────────────────────────────────────

  describe('auth bypass (no credentials configured)', () => {
    it('/api/dashboard returns 200 without token', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({ port: 0, authManager: new AuthManager(), serverDir: tmpDir });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/dashboard' });
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).plugins).toBeDefined();
    });

    it('/api/plugins returns 200 without token', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({ port: 0, authManager: new AuthManager(), serverDir: tmpDir });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/plugins' });
      expect(r.statusCode).toBe(200);
    });

    it('/api/config returns 200 without token', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({ port: 0, authManager: new AuthManager(), serverDir: tmpDir });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/config' });
      expect(r.statusCode).toBe(200);
    });

    it('/api/logs returns 200 without token', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({ port: 0, authManager: new AuthManager(), serverDir: tmpDir });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/logs' });
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).logs).toBeDefined();
    });

    it('/api/auth/session returns admin user in bypass mode', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({ port: 0, authManager: new AuthManager(), serverDir: tmpDir });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/auth/session' });
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).username).toBe('admin');
    });

    it('returns 401 when credentials ARE set', async () => {
      tmpDir = await createTmpServerDir();
      const authManager = new AuthManager();
      await authManager.setCredentials('admin', 'secret');
      server = await createAdminServer({ port: 0, authManager, serverDir: tmpDir });
      await server.ready();

      for (const url of ['/api/dashboard', '/api/plugins', '/api/config', '/api/logs']) {
        const r = await server.inject({ method: 'GET', url });
        expect(r.statusCode).toBe(401);
      }
    });
  });

  // ── Plugin actions using real PluginRegistry interface ────────

  describe('plugin actions (real PluginRegistry interface)', () => {
    it('GET /api/plugins returns registry data merged with loader status', async () => {
      tmpDir = await createTmpServerDir();
      const registry = new TestPluginRegistry(tmpDir);
      await registry.load();
      const loader = new TestPluginLoader();
      loader._addRunning('hello-logger');

      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        pluginRegistry: registry as any,
        pluginLoader: loader as any,
      });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/plugins' });
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.plugins).toHaveLength(2);
      const hello = body.plugins.find((p: any) => p.name === 'hello-logger');
      expect(hello.state).toBe('running');
      expect(hello.pid).toBe(12345);
    });

    it('GET /api/plugins/:name returns single plugin detail', async () => {
      tmpDir = await createTmpServerDir();
      const registry = new TestPluginRegistry(tmpDir);
      await registry.load();
      const loader = new TestPluginLoader();
      loader._addRunning('hello-logger');

      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        pluginRegistry: registry as any,
        pluginLoader: loader as any,
      });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/plugins/hello-logger' });
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.name).toBe('hello-logger');
      expect(body.state).toBe('running');
    });

    it('GET /api/plugins/:name returns 404 for unknown plugin', async () => {
      tmpDir = await createTmpServerDir();
      const registry = new TestPluginRegistry(tmpDir);
      await registry.load();

      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        pluginRegistry: registry as any,
      });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/plugins/nonexistent' });
      expect(r.statusCode).toBe(404);
    });

    it('POST /api/plugins/:name/disable calls registry.disable()', async () => {
      tmpDir = await createTmpServerDir();
      const registry = new TestPluginRegistry(tmpDir);
      await registry.load();
      expect(registry.isEnabled('hello-logger')).toBe(true);

      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        pluginRegistry: registry as any,
      });
      await server.ready();

      const r = await server.inject({ method: 'POST', url: '/api/plugins/hello-logger/disable' });
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).success).toBe(true);
      expect(registry.isEnabled('hello-logger')).toBe(false);
    });

    it('POST /api/plugins/:name/enable calls registry.enable()', async () => {
      tmpDir = await createTmpServerDir();
      const registry = new TestPluginRegistry(tmpDir);
      await registry.load();
      expect(registry.isEnabled('http-health')).toBe(false);

      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        pluginRegistry: registry as any,
      });
      await server.ready();

      const r = await server.inject({ method: 'POST', url: '/api/plugins/http-health/enable' });
      expect(r.statusCode).toBe(200);
      expect(registry.isEnabled('http-health')).toBe(true);
    });

    it('POST /api/plugins/:name/restart calls loader.restartPlugin()', async () => {
      tmpDir = await createTmpServerDir();
      const loader = new TestPluginLoader();
      loader._addRunning('hello-logger');

      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        pluginLoader: loader as any,
      });
      await server.ready();

      const r = await server.inject({ method: 'POST', url: '/api/plugins/hello-logger/restart' });
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).success).toBe(true);
    });

    it('POST /api/plugins/:name/start calls loader.startPlugin()', async () => {
      tmpDir = await createTmpServerDir();
      const registry = new TestPluginRegistry(tmpDir);
      await registry.load();
      const loader = new TestPluginLoader();
      loader._addStopped('hello-logger');

      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        pluginRegistry: registry as any,
        pluginLoader: loader as any,
      });
      await server.ready();

      const r = await server.inject({ method: 'POST', url: '/api/plugins/hello-logger/start' });
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).success).toBe(true);
      expect(JSON.parse(r.body).action).toBe('start');
    });

    it('POST /api/plugins/:name/stop calls loader.stopPlugin()', async () => {
      tmpDir = await createTmpServerDir();
      const loader = new TestPluginLoader();
      loader._addRunning('hello-logger');

      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        pluginLoader: loader as any,
      });
      await server.ready();

      const r = await server.inject({ method: 'POST', url: '/api/plugins/hello-logger/stop' });
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).success).toBe(true);
      expect(JSON.parse(r.body).action).toBe('stop');
    });

    it('POST /api/plugins/:name/stop returns 404 when not running', async () => {
      tmpDir = await createTmpServerDir();
      const loader = new TestPluginLoader();
      // No status set for this plugin

      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        pluginLoader: loader as any,
      });
      await server.ready();

      const r = await server.inject({ method: 'POST', url: '/api/plugins/nonexistent/stop' });
      expect(r.statusCode).toBe(404);
    });

    it('POST /api/plugins/:name/start returns 503 without loader', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
      });
      await server.ready();

      const r = await server.inject({ method: 'POST', url: '/api/plugins/hello-logger/start' });
      expect(r.statusCode).toBe(503);
    });

    it('POST /api/plugins/:name/stop returns 503 without loader', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
      });
      await server.ready();

      const r = await server.inject({ method: 'POST', url: '/api/plugins/hello-logger/stop' });
      expect(r.statusCode).toBe(503);
    });

    it('POST /api/plugins/:name/start returns 404 for unknown plugin when registry exists', async () => {
      tmpDir = await createTmpServerDir();
      const registry = new TestPluginRegistry(tmpDir);
      await registry.load();
      const loader = new TestPluginLoader();

      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        pluginRegistry: registry as any,
        pluginLoader: loader as any,
      });
      await server.ready();

      const r = await server.inject({ method: 'POST', url: '/api/plugins/nonexistent/start' });
      expect(r.statusCode).toBe(404);
    });

    it('POST /api/plugins/:name/disable returns 404 for unknown plugin', async () => {
      tmpDir = await createTmpServerDir();
      const registry = new TestPluginRegistry(tmpDir);
      await registry.load();

      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        pluginRegistry: registry as any,
      });
      await server.ready();

      const r = await server.inject({ method: 'POST', url: '/api/plugins/nonexistent/disable' });
      expect(r.statusCode).toBe(404);
    });
  });

  // ── Config using real ConfigManager interface ────────────────

  describe('config API (real ConfigManager interface)', () => {
    it('GET /api/config/plugins/:name calls loadConfig()', async () => {
      tmpDir = await createTmpServerDir();
      const registry = new TestPluginRegistry(tmpDir);
      await registry.load();
      const configManager = new TestConfigManager(tmpDir);
      configManager._seed('hello-logger', { logFormat: 'json', logLevel: 'info' });

      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        pluginRegistry: registry as any,
        configManager: configManager as any,
      });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/config/plugins/hello-logger' });
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.config.logFormat).toBe('json');
    });

    it('PUT /api/config/plugins/:name calls saveConfig()', async () => {
      tmpDir = await createTmpServerDir();
      const registry = new TestPluginRegistry(tmpDir);
      await registry.load();
      const configManager = new TestConfigManager(tmpDir);

      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        pluginRegistry: registry as any,
        configManager: configManager as any,
      });
      await server.ready();

      const r = await server.inject({
        method: 'PUT',
        url: '/api/config/plugins/hello-logger',
        payload: { logFormat: 'text', logLevel: 'debug' },
      });
      expect(r.statusCode).toBe(200);

      // Verify it was saved
      const saved = await configManager.loadConfig('hello-logger');
      expect(saved.logFormat).toBe('text');
    });
  });

  // ── Logs using real LogAggregator interface ──────────────────

  describe('logs (real LogAggregator interface)', () => {
    it('returns empty logs when no logAggregator', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({ port: 0, authManager: new AuthManager(), serverDir: tmpDir });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/logs' });
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body).logs).toEqual([]);
    });

    it('returns logs from disk files via readAllLogs()', async () => {
      tmpDir = await createTmpServerDir();
      const { logsDir, entries } = await writeLogFiles(tmpDir);
      const logAggregator = new TestLogAggregator(logsDir);

      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        logAggregator: logAggregator as any,
      });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/logs' });
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.logs.length).toBeGreaterThanOrEqual(4);
      // Sorted descending — most recent first
      expect(body.logs[0].message).toBe('Crash!');
    });

    it('respects level filter', async () => {
      tmpDir = await createTmpServerDir();
      const { logsDir } = await writeLogFiles(tmpDir);
      const logAggregator = new TestLogAggregator(logsDir);

      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        logAggregator: logAggregator as any,
      });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/logs?level=error' });
      const body = JSON.parse(r.body);
      expect(body.logs.length).toBeGreaterThanOrEqual(1);
      expect(body.logs.every((l: any) => l.level === 'error')).toBe(true);
    });

    it('captures live emitted logs in buffer', async () => {
      tmpDir = await createTmpServerDir();
      const { logsDir } = await writeLogFiles(tmpDir);
      const logAggregator = new TestLogAggregator(logsDir);

      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        logAggregator: logAggregator as any,
      });
      await server.ready();

      // Emit a live log (simulates plugin producing output at runtime)
      logAggregator.log('hello-logger', 'info', 'Live message from plugin');

      const r = await server.inject({ method: 'GET', url: '/api/logs' });
      const body = JSON.parse(r.body);
      const live = body.logs.find((l: any) => l.message === 'Live message from plugin');
      expect(live).toBeDefined();
      expect(live.plugin).toBe('hello-logger');
    });

    it('respects since filter', async () => {
      tmpDir = await createTmpServerDir();
      const { logsDir, now } = await writeLogFiles(tmpDir);
      const logAggregator = new TestLogAggregator(logsDir);

      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        logAggregator: logAggregator as any,
      });
      await server.ready();

      // Only get logs from last 1.5 seconds
      const since = now - 1500;
      const r = await server.inject({ method: 'GET', url: `/api/logs?since=${since}` });
      const body = JSON.parse(r.body);
      // Should get warn + error (last 1.5s), not info entries from 2-3s ago
      expect(body.logs.length).toBeLessThan(4);
      expect(body.logs.every((l: any) => l.timestamp >= since)).toBe(true);
    });
  });

  // ── Status endpoint ──────────────────────────────────────────

  describe('/api/status', () => {
    it('returns pid, uptime, version, status', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({ port: 0, authManager: new AuthManager(), serverDir: tmpDir });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/status' });
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.server.status).toBe('running');
      expect(body.server.pid).toBe(process.pid);
      expect(body.server.uptime).toBeTypeOf('number');
      expect(body.server.uptime).toBeGreaterThan(0);
      expect(body.server.version).toBeTypeOf('string');
    });
  });

  // ── Dashboard data shape ─────────────────────────────────────

  describe('dashboard data shape (what app.js expects)', () => {
    it('/api/dashboard returns plugins.total, plugins.list, config, directory', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({ port: 0, authManager: new AuthManager(), serverDir: tmpDir });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/dashboard' });
      const d = JSON.parse(r.body);
      expect(d.plugins.total).toBe(2);
      expect(d.plugins.running).toBeTypeOf('number');
      expect(d.plugins.stopped).toBeTypeOf('number');
      expect(d.plugins.failed).toBeTypeOf('number');
      expect(d.plugins.disabled).toBeTypeOf('number');
      expect(Array.isArray(d.plugins.list)).toBe(true);
      expect(d.config).toBeDefined();
      expect(d.config.mqttEmbedded).toBe(true);
      expect(d.config.mqttPort).toBe(1883);
      expect(d.directory).toBe(tmpDir);
      expect(d.timestamp).toBeTypeOf('number');

      // Plugin entries match what app.js renders
      const hello = d.plugins.list.find((p: any) => p.name === 'hello-logger');
      expect(hello).toBeDefined();
      expect(hello.version).toBe('1.0.0');
      expect(hello.enabled).toBe(true);
      expect(hello.description).toBe('Logs hello');
    });
  });

  // ── Static file serving (real public/ files) ─────────────────

  describe('static file serving (real public/ files)', () => {
    it('GET / serves index.html with WorldOS Admin content', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({ port: 0, authManager: new AuthManager(), serverDir: tmpDir, staticDir: publicDir });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/' });
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain('WorldOS Admin');
      expect(r.body).toContain('<div id="app">');
      expect(r.body).toContain('id="sidebar"');
      expect(r.body).toContain('id="content"');
    });

    it('GET /style.css serves CSS with theme variables', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({ port: 0, authManager: new AuthManager(), serverDir: tmpDir, staticDir: publicDir });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/style.css' });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toContain('text/css');
      expect(r.body).toContain('--bg-body');
      expect(r.body).toContain('--accent');
      expect(r.body).toContain('.plugin-card');
    });

    it('GET /app.js serves JS with all page renderers and pollLogs', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({ port: 0, authManager: new AuthManager(), serverDir: tmpDir, staticDir: publicDir });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/app.js' });
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain('renderDashboard');
      expect(r.body).toContain('renderPlugins');
      expect(r.body).toContain('renderLogs');
      expect(r.body).toContain('renderSettings');
      expect(r.body).toContain('pollLogs');
      expect(r.body).toContain('/logs?');
    });

    it('SPA fallback serves index.html for non-file routes', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({ port: 0, authManager: new AuthManager(), serverDir: tmpDir, staticDir: publicDir });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/plugins' });
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain('WorldOS Admin');
    });

    it('API routes are NOT caught by SPA fallback', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({ port: 0, authManager: new AuthManager(), serverDir: tmpDir, staticDir: publicDir });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/nonexistent' });
      expect(r.statusCode).toBe(404);
    });
  });

  // ── Panels endpoint ─────────────────────────────────────────

  describe('/api/panels', () => {
    it('returns empty panels when none configured', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({ port: 0, authManager: new AuthManager(), serverDir: tmpDir });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/panels' });
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.panels).toEqual([]);
    });

    it('returns registered panels', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        panels: [
          { name: 'presence', displayName: 'User Presence', entryPoint: '/plugins/presence/admin/panel.js', icon: 'users', route: '/presence' },
          { name: 'moderation', displayName: 'Moderation', entryPoint: '/plugins/moderation/admin/panel.js' },
        ],
      });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/panels' });
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.panels).toHaveLength(2);
      expect(body.panels[0].name).toBe('presence');
      expect(body.panels[0].displayName).toBe('User Presence');
      expect(body.panels[0].entryPoint).toBe('/plugins/presence/admin/panel.js');
      expect(body.panels[0].icon).toBe('users');
      expect(body.panels[1].name).toBe('moderation');
    });

    it('requires auth when credentials are set', async () => {
      tmpDir = await createTmpServerDir();
      const authManager = new AuthManager();
      await authManager.setCredentials('admin', 'secret');
      server = await createAdminServer({
        port: 0,
        authManager,
        serverDir: tmpDir,
        panels: [{ name: 'test', displayName: 'Test', entryPoint: '/plugins/test/panel.js' }],
      });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/panels' });
      expect(r.statusCode).toBe(401);
    });
  });

  // ── Custom logo ─────────────────────────────────────────────

  describe('custom logo', () => {
    it('serves default logo when no custom logo configured', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        staticDir: publicDir,
      });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/logo.png' });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toContain('image/png');
    });

    it('serves custom logo when customLogoPath is set', async () => {
      tmpDir = await createTmpServerDir();
      // Create a fake PNG file (1x1 pixel)
      const logoPath = path.join(tmpDir, 'my-logo.png');
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      ]);
      await fs.writeFile(logoPath, pngHeader);

      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        staticDir: publicDir,
        customLogoPath: logoPath,
      });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/logo.png' });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toBe('image/png');
      // Should serve the custom file, not the default
      expect(r.rawPayload.length).toBe(pngHeader.length);
    });

    it('serves correct content-type for SVG logos', async () => {
      tmpDir = await createTmpServerDir();
      const logoPath = path.join(tmpDir, 'logo.svg');
      await fs.writeFile(logoPath, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');

      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        customLogoPath: logoPath,
      });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/logo.png' });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toBe('image/svg+xml');
    });

    it('falls back to default when customLogoPath does not exist', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({
        port: 0,
        authManager: new AuthManager(),
        serverDir: tmpDir,
        staticDir: publicDir,
        customLogoPath: path.join(tmpDir, 'nonexistent.png'),
      });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/logo.png' });
      expect(r.statusCode).toBe(200);
      // Falls through to static file serving (default logo)
      expect(r.headers['content-type']).toContain('image/png');
    });
  });

  // ── Health endpoint (diagnostic) ─────────────────────────────

  describe('/api/health diagnostic', () => {
    it('reports authBypass=true when no credentials', async () => {
      tmpDir = await createTmpServerDir();
      server = await createAdminServer({ port: 0, authManager: new AuthManager(), serverDir: tmpDir });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/health' });
      const body = JSON.parse(r.body);
      expect(body.authBypass).toBe(true);
    });

    it('reports authBypass=false when credentials set', async () => {
      tmpDir = await createTmpServerDir();
      const authManager = new AuthManager();
      await authManager.setCredentials('admin', 'pass');
      server = await createAdminServer({ port: 0, authManager, serverDir: tmpDir });
      await server.ready();

      const r = await server.inject({ method: 'GET', url: '/api/health' });
      const body = JSON.parse(r.body);
      expect(body.authBypass).toBe(false);
    });
  });
});
