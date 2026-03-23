/**
 * Admin Server Tests
 *
 * Story 7.1: Fastify Admin Server
 * Story 7.4: Plugin Status Dashboard
 *
 * HTTP server for web administration interface.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAdminServer, AdminServerOptions } from './server.js';
import { AuthManager } from './auth.js';
import type { FastifyInstance } from 'fastify';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('AdminServer', () => {
  let server: FastifyInstance;
  let authManager: AuthManager;
  let token: string;

  beforeEach(async () => {
    authManager = new AuthManager();
    await authManager.setCredentials('admin', 'password');
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  /**
   * Helper to login and get token
   */
  async function login(): Promise<string> {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'password' },
    });
    return JSON.parse(response.body).token;
  }

  describe('initialization', () => {
    it('should create Fastify server', async () => {
      server = await createAdminServer({ port: 0, authManager });
      expect(server).toBeDefined();
    });

    it('should register health endpoint', async () => {
      server = await createAdminServer({ port: 0, authManager });
      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/api/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
    });

    it('should configure CORS', async () => {
      server = await createAdminServer({
        port: 0,
        authManager,
        cors: { origin: 'http://localhost:3000' },
      });
      await server.ready();

      const response = await server.inject({
        method: 'OPTIONS',
        url: '/api/health',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'GET',
        },
      });

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    });
  });

  describe('API routes', () => {
    it('should prefix API routes with /api/', async () => {
      server = await createAdminServer({ port: 0, authManager });
      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/api/status',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return JSON for API routes', async () => {
      server = await createAdminServer({ port: 0, authManager });
      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/api/health',
      });

      expect(response.headers['content-type']).toContain('application/json');
    });

    it('should return 404 for unknown API routes', async () => {
      server = await createAdminServer({ port: 0, authManager });
      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/api/nonexistent',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('status endpoint', () => {
    it('should return server status', async () => {
      server = await createAdminServer({ port: 0, authManager });
      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/api/status',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.server).toBeDefined();
    });
  });

  describe('plugins endpoint', () => {
    it('should return plugin list when authenticated', async () => {
      server = await createAdminServer({ port: 0, authManager });
      await server.ready();
      token = await login();

      const response = await server.inject({
        method: 'GET',
        url: '/api/plugins',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body.plugins)).toBe(true);
    });
  });

  describe('config endpoint', () => {
    it('should return server config when authenticated', async () => {
      server = await createAdminServer({ port: 0, authManager });
      await server.ready();
      token = await login();

      const response = await server.inject({
        method: 'GET',
        url: '/api/config',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toBeDefined();
    });
  });

  describe('dashboard endpoint', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-admin-test-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should require authentication', async () => {
      server = await createAdminServer({ port: 0, authManager, serverDir: tmpDir });
      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/api/dashboard',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return dashboard data when authenticated', async () => {
      await fs.writeFile(path.join(tmpDir, 'wos.yaml'), 'server:\n  port: 8080\n');

      server = await createAdminServer({ port: 0, authManager, serverDir: tmpDir });
      await server.ready();
      token = await login();

      const response = await server.inject({
        method: 'GET',
        url: '/api/dashboard',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.server).toBeDefined();
      expect(body.plugins).toBeDefined();
      expect(body.config).toBeDefined();
      expect(body.timestamp).toBeDefined();
    });

    it('should include plugin summary in dashboard', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'wos.yaml'),
        `plugins:
  plugin-a:
    enabled: true
    version: "1.0.0"
  plugin-b:
    enabled: false
    version: "1.0.0"
`
      );

      server = await createAdminServer({ port: 0, authManager, serverDir: tmpDir });
      await server.ready();
      token = await login();

      const response = await server.inject({
        method: 'GET',
        url: '/api/dashboard',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.plugins.total).toBe(2);
      expect(body.plugins.list).toHaveLength(2);
    });

    it('should return plugins from dashboard data', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'wos.yaml'),
        `plugins:
  my-plugin:
    enabled: true
    version: "1.2.3"
`
      );

      server = await createAdminServer({ port: 0, authManager, serverDir: tmpDir });
      await server.ready();
      token = await login();

      const response = await server.inject({
        method: 'GET',
        url: '/api/plugins',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.plugins).toHaveLength(1);
      expect(body.plugins[0].name).toBe('my-plugin');
    });
  });

  describe('WebSocket endpoint', () => {
    it('should have WebSocket route registered', async () => {
      server = await createAdminServer({ port: 0, authManager });
      await server.ready();

      // Check that the route exists by checking registered routes
      const routes = server.printRoutes();
      expect(routes).toContain('ws (GET');
    });

    it('should create MQTT bridge when mqttClient is provided', async () => {
      const mockMqttClient = {
        subscribe: () => {},
        unsubscribe: () => {},
        publish: () => {},
        connected: true,
      };

      server = await createAdminServer({
        port: 0,
        authManager,
        mqttClient: mockMqttClient as any,
      });
      await server.ready();

      expect((server as any).mqttBridge).toBeDefined();
    });

    it('should not create MQTT bridge when mqttClient is not provided', async () => {
      server = await createAdminServer({ port: 0, authManager });
      await server.ready();

      expect((server as any).mqttBridge).toBeUndefined();
    });
  });
});
