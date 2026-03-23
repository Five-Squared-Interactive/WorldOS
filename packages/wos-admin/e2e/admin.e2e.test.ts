/**
 * Admin Server End-to-End Tests
 *
 * Story 11.5: E2E Test Coverage for Admin Server
 *
 * Tests the full Fastify admin server with:
 * - Auth flow (login → protected routes → logout)
 * - Plugin management API (list, details, enable/disable, restart)
 * - Config management API (read, update)
 * - Dashboard data aggregation from real wos.yaml
 * - Public endpoints (health, status)
 * - Error cases (401, 403, 404, 503)
 *
 * Uses Fastify inject() for in-process HTTP testing and mock
 * service objects (PluginRegistry, ConfigManager, PluginLoader)
 * to simulate the wos-server integration layer.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import { createAdminServer, AdminServerOptions } from '../src/server.js';
import { AuthManager } from '../src/auth.js';

// ── Mock Services ────────────────────────────────────────────────────

/** In-memory plugin registry mock */
function createMockPluginRegistry() {
  const plugins = new Map<string, { name: string; version: string; enabled: boolean }>();

  return {
    async load() {},
    get(name: string) { return plugins.get(name); },
    getAll() { return Array.from(plugins.values()); },
    async enable(name: string) {
      const p = plugins.get(name);
      if (p) p.enabled = true;
    },
    async disable(name: string) {
      const p = plugins.get(name);
      if (p) p.enabled = false;
    },
    // Test helper
    _add(name: string, version: string, enabled: boolean) {
      plugins.set(name, { name, version, enabled });
    },
  };
}

/** In-memory config manager mock */
function createMockConfigManager() {
  const configs = new Map<string, Record<string, unknown>>();

  return {
    async loadConfig(pluginName: string) {
      const c = configs.get(pluginName);
      if (!c) throw new Error(`Config not found for ${pluginName}`);
      return c;
    },
    async saveConfig(pluginName: string, config: Record<string, unknown>) {
      configs.set(pluginName, config);
    },
    // Test helper
    _set(name: string, config: Record<string, unknown>) {
      configs.set(name, config);
    },
  };
}

/** In-memory plugin loader mock */
function createMockPluginLoader() {
  const statuses = new Map<string, { name: string; state: string; pid?: number }>();
  let restartCalls: string[] = [];

  return {
    getPluginStatus(name: string) { return statuses.get(name); },
    getAllPluginStatuses() { return Array.from(statuses.values()); },
    async startPlugin(name: string) { restartCalls.push(`start:${name}`); },
    async stopPlugin(name: string) { restartCalls.push(`stop:${name}`); },
    async restartPlugin(name: string) { restartCalls.push(name); },
    // Test helpers
    _setStatus(name: string, state: string, pid?: number) {
      statuses.set(name, { name, state, pid });
    },
    _getRestartCalls() { return restartCalls; },
    _resetRestartCalls() { restartCalls = []; },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Create server with auth and mocks, return server + login helper */
async function createTestServer(opts: {
  registry?: ReturnType<typeof createMockPluginRegistry>;
  configMgr?: ReturnType<typeof createMockConfigManager>;
  loader?: ReturnType<typeof createMockPluginLoader>;
  serverDir?: string;
  panels?: { name: string; displayName: string; entryPoint: string; icon?: string; route?: string }[];
} = {}) {
  const authManager = new AuthManager({ saltRounds: 4 }); // fast hashing for tests
  await authManager.setCredentials('admin', 'password');

  const options: AdminServerOptions = {
    port: 0,
    authManager,
    pluginRegistry: opts.registry,
    configManager: opts.configMgr,
    pluginLoader: opts.loader,
    serverDir: opts.serverDir,
    panels: opts.panels,
  };

  const server = await createAdminServer(options);
  await server.ready();

  /** Helper: login and return token */
  async function login(username = 'admin', password = 'password'): Promise<string> {
    const res = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password },
    });
    const body = JSON.parse(res.body);
    return body.token;
  }

  return { server, authManager, login };
}

// =====================================================================
// 1. Public endpoints (no auth)
// =====================================================================

describe('public endpoints (e2e)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    const ctx = await createTestServer();
    server = ctx.server;
  });

  afterEach(async () => {
    await server.close();
  });

  it('GET /api/health returns ok', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeTypeOf('number');
  });

  it('GET /api/status returns server info', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/status' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.server.status).toBe('running');
    expect(body.server.version).toBe('1.0.0');
    expect(body.server.uptime).toBeTypeOf('number');
  });
});

// =====================================================================
// 2. Auth flow
// =====================================================================

describe('auth flow (e2e)', () => {
  let server: FastifyInstance;
  let login: (u?: string, p?: string) => Promise<string>;

  beforeEach(async () => {
    const ctx = await createTestServer();
    server = ctx.server;
    login = ctx.login;
  });

  afterEach(async () => {
    await server.close();
  });

  it('should login with valid credentials', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'password' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.token).toBeTypeOf('string');
    expect(body.token.length).toBe(64); // 32 bytes hex
    expect(body.expiresAt).toBeTypeOf('number');
  });

  it('should reject invalid credentials', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'wrong' },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Unauthorized');
  });

  it('should reject unknown user', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'nobody', password: 'password' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('should access protected route with token', async () => {
    const token = await login();

    const res = await server.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.authenticated).toBe(true);
    expect(body.username).toBe('admin');
  });

  it('should reject protected route without token', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/auth/session',
    });

    expect(res.statusCode).toBe(401);
  });

  it('should reject protected route with invalid token', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { authorization: 'Bearer invalid-token-here' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('should logout and invalidate token', async () => {
    const token = await login();

    // Logout
    const logoutRes = await server.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logoutRes.statusCode).toBe(200);

    // Token should no longer work
    const sessionRes = await server.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(sessionRes.statusCode).toBe(401);
  });

  it('should support multiple concurrent sessions', async () => {
    const token1 = await login();
    const token2 = await login();

    expect(token1).not.toBe(token2);

    // Both should work
    const res1 = await server.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { authorization: `Bearer ${token1}` },
    });
    const res2 = await server.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { authorization: `Bearer ${token2}` },
    });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
  });
});

// =====================================================================
// 3. Plugin management API
// =====================================================================

describe('plugin management API (e2e)', () => {
  let server: FastifyInstance;
  let login: () => Promise<string>;
  let registry: ReturnType<typeof createMockPluginRegistry>;
  let loader: ReturnType<typeof createMockPluginLoader>;

  beforeEach(async () => {
    registry = createMockPluginRegistry();
    loader = createMockPluginLoader();

    registry._add('mqtt-logger', '1.0.0', true);
    registry._add('http-bridge', '2.1.0', true);
    registry._add('disabled-plugin', '0.5.0', false);

    loader._setStatus('mqtt-logger', 'running', 1234);
    loader._setStatus('http-bridge', 'running', 5678);

    const ctx = await createTestServer({ registry, loader });
    server = ctx.server;
    login = ctx.login;
  });

  afterEach(async () => {
    await server.close();
  });

  it('GET /api/plugins lists all plugins with merged status', async () => {
    const token = await login();

    const res = await server.inject({
      method: 'GET',
      url: '/api/plugins',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.plugins).toHaveLength(3);

    const mqttLogger = body.plugins.find((p: any) => p.name === 'mqtt-logger');
    expect(mqttLogger.state).toBe('running');
    expect(mqttLogger.pid).toBe(1234);

    const disabledPlugin = body.plugins.find((p: any) => p.name === 'disabled-plugin');
    expect(disabledPlugin.state).toBe('disabled');
  });

  it('GET /api/plugins/:name returns plugin details', async () => {
    const token = await login();

    const res = await server.inject({
      method: 'GET',
      url: '/api/plugins/mqtt-logger',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('mqtt-logger');
    expect(body.version).toBe('1.0.0');
    expect(body.state).toBe('running');
    expect(body.pid).toBe(1234);
  });

  it('GET /api/plugins/:name returns 404 for unknown plugin', async () => {
    const token = await login();

    const res = await server.inject({
      method: 'GET',
      url: '/api/plugins/nonexistent',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('POST /api/plugins/:name/enable enables a plugin', async () => {
    const token = await login();

    const res = await server.inject({
      method: 'POST',
      url: '/api/plugins/disabled-plugin/enable',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.enabled).toBe(true);

    // Verify plugin is now enabled in registry
    expect(registry.get('disabled-plugin')!.enabled).toBe(true);
  });

  it('POST /api/plugins/:name/disable disables a plugin', async () => {
    const token = await login();

    const res = await server.inject({
      method: 'POST',
      url: '/api/plugins/mqtt-logger/disable',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.enabled).toBe(false);

    expect(registry.get('mqtt-logger')!.enabled).toBe(false);
  });

  it('POST /api/plugins/:name/restart restarts a running plugin', async () => {
    const token = await login();

    const res = await server.inject({
      method: 'POST',
      url: '/api/plugins/mqtt-logger/restart',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.action).toBe('restart');

    expect(loader._getRestartCalls()).toContain('mqtt-logger');
  });

  it('POST /api/plugins/:name/restart returns 404 for unknown plugin', async () => {
    const token = await login();

    const res = await server.inject({
      method: 'POST',
      url: '/api/plugins/nonexistent/restart',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('POST /api/plugins/:name/enable returns 404 for unknown plugin', async () => {
    const token = await login();

    const res = await server.inject({
      method: 'POST',
      url: '/api/plugins/nonexistent/enable',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('requires auth for all plugin endpoints', async () => {
    const endpoints = [
      { method: 'GET' as const, url: '/api/plugins' },
      { method: 'GET' as const, url: '/api/plugins/mqtt-logger' },
      { method: 'POST' as const, url: '/api/plugins/mqtt-logger/enable' },
      { method: 'POST' as const, url: '/api/plugins/mqtt-logger/disable' },
      { method: 'POST' as const, url: '/api/plugins/mqtt-logger/restart' },
    ];

    for (const endpoint of endpoints) {
      const res = await server.inject(endpoint);
      expect(res.statusCode).toBe(401);
    }
  });
});

// =====================================================================
// 4. Config management API
// =====================================================================

describe('config management API (e2e)', () => {
  let server: FastifyInstance;
  let login: () => Promise<string>;
  let registry: ReturnType<typeof createMockPluginRegistry>;
  let configMgr: ReturnType<typeof createMockConfigManager>;

  beforeEach(async () => {
    registry = createMockPluginRegistry();
    configMgr = createMockConfigManager();

    registry._add('my-plugin', '1.0.0', true);
    configMgr._set('my-plugin', { port: 9090, debug: false });

    const ctx = await createTestServer({ registry, configMgr });
    server = ctx.server;
    login = ctx.login;
  });

  afterEach(async () => {
    await server.close();
  });

  it('GET /api/config returns server config', async () => {
    const token = await login();

    const res = await server.inject({
      method: 'GET',
      url: '/api/config',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.server).toBeDefined();
    expect(body.timestamp).toBeTypeOf('number');
  });

  it('GET /api/config/plugins/:name returns plugin config', async () => {
    const token = await login();

    const res = await server.inject({
      method: 'GET',
      url: '/api/config/plugins/my-plugin',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.plugin).toBe('my-plugin');
    expect(body.config.port).toBe(9090);
    expect(body.config.debug).toBe(false);
  });

  it('PUT /api/config/plugins/:name updates plugin config', async () => {
    const token = await login();

    const newConfig = { port: 8080, debug: true, newField: 'hello' };

    const res = await server.inject({
      method: 'PUT',
      url: '/api/config/plugins/my-plugin',
      headers: { authorization: `Bearer ${token}` },
      payload: newConfig,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);

    // Verify config was updated
    const updated = await configMgr.loadConfig('my-plugin');
    expect(updated.port).toBe(8080);
    expect(updated.debug).toBe(true);
    expect(updated.newField).toBe('hello');
  });

  it('GET /api/config/plugins/:name returns 404 for unknown plugin', async () => {
    const token = await login();

    const res = await server.inject({
      method: 'GET',
      url: '/api/config/plugins/nonexistent',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('PUT /api/config/plugins/:name returns 404 for unknown plugin', async () => {
    const token = await login();

    const res = await server.inject({
      method: 'PUT',
      url: '/api/config/plugins/nonexistent',
      headers: { authorization: `Bearer ${token}` },
      payload: { foo: 'bar' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('requires auth for all config endpoints', async () => {
    const endpoints = [
      { method: 'GET' as const, url: '/api/config' },
      { method: 'GET' as const, url: '/api/config/plugins/my-plugin' },
      { method: 'PUT' as const, url: '/api/config/plugins/my-plugin', payload: {} },
    ];

    for (const endpoint of endpoints) {
      const res = await server.inject(endpoint);
      expect(res.statusCode).toBe(401);
    }
  });
});

// =====================================================================
// 5. 503 when services not configured
// =====================================================================

describe('503 when services not wired (e2e)', () => {
  let server: FastifyInstance;
  let login: () => Promise<string>;

  beforeEach(async () => {
    // Create server with NO registry, no config manager, no loader
    const ctx = await createTestServer();
    server = ctx.server;
    login = ctx.login;
  });

  afterEach(async () => {
    await server.close();
  });

  it('POST /api/plugins/:name/enable returns 503 without registry', async () => {
    const token = await login();

    const res = await server.inject({
      method: 'POST',
      url: '/api/plugins/any/enable',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/unavailable/i);
  });

  it('POST /api/plugins/:name/disable returns 503 without registry', async () => {
    const token = await login();

    const res = await server.inject({
      method: 'POST',
      url: '/api/plugins/any/disable',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(503);
  });

  it('POST /api/plugins/:name/restart returns 503 without loader', async () => {
    const token = await login();

    const res = await server.inject({
      method: 'POST',
      url: '/api/plugins/any/restart',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(503);
  });

  it('GET /api/config/plugins/:name returns 503 without configManager', async () => {
    const token = await login();

    const res = await server.inject({
      method: 'GET',
      url: '/api/config/plugins/any',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(503);
  });

  it('PUT /api/config/plugins/:name returns 503 without configManager', async () => {
    const token = await login();

    const res = await server.inject({
      method: 'PUT',
      url: '/api/config/plugins/any',
      headers: { authorization: `Bearer ${token}` },
      payload: { x: 1 },
    });

    expect(res.statusCode).toBe(503);
  });
});

// =====================================================================
// 6. Dashboard integration with real wos.yaml
// =====================================================================

describe('dashboard with real wos.yaml (e2e)', () => {
  let server: FastifyInstance;
  let login: () => Promise<string>;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-admin-e2e-'));

    // Create a real wos.yaml
    const wosYaml = {
      server: { name: 'test-server', port: 8080, host: '0.0.0.0' },
      mqtt: { port: 1883, embedded: true },
      plugins: {
        'chat-plugin': { enabled: true, version: '1.0.0' },
        'analytics': { enabled: false, version: '0.2.0' },
      },
    };
    await fs.writeFile(path.join(tempDir, 'wos.yaml'), yaml.stringify(wosYaml));

    const ctx = await createTestServer({ serverDir: tempDir });
    server = ctx.server;
    login = ctx.login;
  });

  afterEach(async () => {
    await server.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('GET /api/dashboard returns aggregated data from wos.yaml', async () => {
    const token = await login();

    const res = await server.inject({
      method: 'GET',
      url: '/api/dashboard',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Server should show as stopped (no PID file)
    expect(body.server.status).toBe('stopped');

    // Plugins from wos.yaml
    expect(body.plugins.total).toBe(2);
    expect(body.plugins.list).toHaveLength(2);

    const chat = body.plugins.list.find((p: any) => p.name === 'chat-plugin');
    expect(chat).toBeDefined();
    expect(chat.enabled).toBe(true);

    const analytics = body.plugins.list.find((p: any) => p.name === 'analytics');
    expect(analytics).toBeDefined();
    expect(analytics.enabled).toBe(false);

    // Config from wos.yaml
    expect(body.config.mqttPort).toBe(1883);
    expect(body.directory).toBe(tempDir);
    expect(body.timestamp).toBeTypeOf('number');
  });

  it('GET /api/dashboard returns empty plugins when no wos.yaml', async () => {
    // Use a dir without wos.yaml
    const emptyDir = path.join(tempDir, 'empty');
    await fs.mkdir(emptyDir, { recursive: true });

    const ctx = await createTestServer({ serverDir: emptyDir });
    const emptyServer = ctx.server;

    try {
      const token = await ctx.login();

      const res = await emptyServer.inject({
        method: 'GET',
        url: '/api/dashboard',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.plugins.total).toBe(0);
      expect(body.plugins.list).toHaveLength(0);
    } finally {
      await emptyServer.close();
    }
  });
});

// =====================================================================
// 7. Panels endpoint
// =====================================================================

describe('panels endpoint (e2e)', () => {
  let server: FastifyInstance;
  let login: () => Promise<string>;

  afterEach(async () => {
    await server.close();
  });

  it('GET /api/panels returns registered panels', async () => {
    const ctx = await createTestServer({
      panels: [
        { name: 'presence', displayName: 'User Presence', entryPoint: '/plugins/presence/admin/panel.js', icon: 'users', route: '/presence' },
        { name: 'moderation', displayName: 'Moderation', entryPoint: '/plugins/moderation/admin/panel.js' },
      ],
    });
    server = ctx.server;
    login = ctx.login;

    const token = await login();
    const res = await server.inject({
      method: 'GET',
      url: '/api/panels',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.panels).toHaveLength(2);
    expect(body.panels[0].name).toBe('presence');
    expect(body.panels[0].displayName).toBe('User Presence');
    expect(body.panels[1].name).toBe('moderation');
  });

  it('GET /api/panels returns empty when none configured', async () => {
    const ctx = await createTestServer();
    server = ctx.server;
    login = ctx.login;

    const token = await login();
    const res = await server.inject({
      method: 'GET',
      url: '/api/panels',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).panels).toEqual([]);
  });

  it('GET /api/panels requires auth', async () => {
    const ctx = await createTestServer({
      panels: [{ name: 'test', displayName: 'Test', entryPoint: '/test.js' }],
    });
    server = ctx.server;

    const res = await server.inject({ method: 'GET', url: '/api/panels' });
    expect(res.statusCode).toBe(401);
  });
});

// =====================================================================
// 8. Full workflow: login → manage plugins → config → logout
// =====================================================================

describe('full admin workflow (e2e)', () => {
  let server: FastifyInstance;
  let registry: ReturnType<typeof createMockPluginRegistry>;
  let configMgr: ReturnType<typeof createMockConfigManager>;
  let loader: ReturnType<typeof createMockPluginLoader>;

  beforeEach(async () => {
    registry = createMockPluginRegistry();
    configMgr = createMockConfigManager();
    loader = createMockPluginLoader();

    registry._add('plugin-a', '1.0.0', true);
    registry._add('plugin-b', '2.0.0', false);
    loader._setStatus('plugin-a', 'running', 111);
    configMgr._set('plugin-a', { logLevel: 'info', maxRetries: 3 });
    configMgr._set('plugin-b', { logLevel: 'warn' });

    const ctx = await createTestServer({ registry, configMgr, loader });
    server = ctx.server;
  });

  afterEach(async () => {
    await server.close();
  });

  it('complete admin session: login → list → enable → config → restart → logout', async () => {
    // 1. Login
    const loginRes = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'password' },
    });
    expect(loginRes.statusCode).toBe(200);
    const { token } = JSON.parse(loginRes.body);
    const headers = { authorization: `Bearer ${token}` };

    // 2. List plugins
    const listRes = await server.inject({ method: 'GET', url: '/api/plugins', headers });
    expect(listRes.statusCode).toBe(200);
    const { plugins } = JSON.parse(listRes.body);
    expect(plugins).toHaveLength(2);

    // 3. Enable disabled plugin
    const enableRes = await server.inject({
      method: 'POST',
      url: '/api/plugins/plugin-b/enable',
      headers,
    });
    expect(enableRes.statusCode).toBe(200);
    expect(registry.get('plugin-b')!.enabled).toBe(true);

    // 4. Read config
    const configRes = await server.inject({
      method: 'GET',
      url: '/api/config/plugins/plugin-a',
      headers,
    });
    expect(configRes.statusCode).toBe(200);
    const configBody = JSON.parse(configRes.body);
    expect(configBody.config.logLevel).toBe('info');

    // 5. Update config
    const updateRes = await server.inject({
      method: 'PUT',
      url: '/api/config/plugins/plugin-a',
      headers,
      payload: { logLevel: 'debug', maxRetries: 5 },
    });
    expect(updateRes.statusCode).toBe(200);

    const updatedConfig = await configMgr.loadConfig('plugin-a');
    expect(updatedConfig.logLevel).toBe('debug');
    expect(updatedConfig.maxRetries).toBe(5);

    // 6. Restart plugin
    const restartRes = await server.inject({
      method: 'POST',
      url: '/api/plugins/plugin-a/restart',
      headers,
    });
    expect(restartRes.statusCode).toBe(200);
    expect(loader._getRestartCalls()).toContain('plugin-a');

    // 7. Logout
    const logoutRes = await server.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers,
    });
    expect(logoutRes.statusCode).toBe(200);

    // 8. Verify token is invalidated
    const afterLogout = await server.inject({
      method: 'GET',
      url: '/api/plugins',
      headers,
    });
    expect(afterLogout.statusCode).toBe(401);
  });
});
