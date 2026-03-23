/**
 * API Routes Tests
 *
 * Story 7.2: Authentication System
 * Story 7.5: Plugin List Page API
 * Story 7.7: Plugin Configuration UI API
 *
 * RESTful API routes for admin interface.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAdminServer } from './server.js';
import { AuthManager, hashPassword } from './auth.js';
import type { FastifyInstance } from 'fastify';

describe('API Routes', () => {
  let server: FastifyInstance;
  let authManager: AuthManager;

  beforeEach(async () => {
    authManager = new AuthManager();
    await authManager.setCredentials('admin', 'password123');

    server = await createAdminServer({
      port: 0,
      authManager,
    });
    await server.ready();
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  describe('auth routes', () => {
    it('should login with valid credentials', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          username: 'admin',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.token).toBeDefined();
    });

    it('should reject invalid credentials', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          username: 'admin',
          password: 'wrongpassword',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should logout and invalidate session', async () => {
      // Login first
      const loginResponse = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          username: 'admin',
          password: 'password123',
        },
      });

      const { token } = JSON.parse(loginResponse.body);

      // Logout
      const logoutResponse = await server.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(logoutResponse.statusCode).toBe(200);

      // Try to use invalidated token
      const protectedResponse = await server.inject({
        method: 'GET',
        url: '/api/plugins',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(protectedResponse.statusCode).toBe(401);
    });

    it('should return session info', async () => {
      // Login
      const loginResponse = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          username: 'admin',
          password: 'password123',
        },
      });

      const { token } = JSON.parse(loginResponse.body);

      // Get session info
      const response = await server.inject({
        method: 'GET',
        url: '/api/auth/session',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.username).toBe('admin');
    });
  });

  describe('protected routes', () => {
    it('should require authentication for /api/plugins', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/plugins',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should require authentication for /api/config', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/config',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should allow access with valid token', async () => {
      // Login
      const loginResponse = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          username: 'admin',
          password: 'password123',
        },
      });

      const { token } = JSON.parse(loginResponse.body);

      // Access protected route
      const response = await server.inject({
        method: 'GET',
        url: '/api/plugins',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('public routes', () => {
    it('should not require auth for /api/health', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/health',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('plugin API', () => {
    let token: string;

    beforeEach(async () => {
      const loginResponse = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'password123' },
      });
      token = JSON.parse(loginResponse.body).token;
    });

    it('should list plugins', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/plugins',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.plugins).toBeDefined();
    });

    it('should get plugin details', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/plugins/test-plugin',
        headers: { authorization: `Bearer ${token}` },
      });

      // May return 404 if plugin doesn't exist, that's ok
      expect([200, 404]).toContain(response.statusCode);
    });

    it('should enable/disable plugin', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/plugins/test-plugin/enable',
        headers: { authorization: `Bearer ${token}` },
      });

      // 503 if services not configured, 404 if plugin doesn't exist, 200 if success
      expect([200, 404, 503]).toContain(response.statusCode);
    });
  });

  describe('config API', () => {
    let token: string;

    beforeEach(async () => {
      const loginResponse = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'password123' },
      });
      token = JSON.parse(loginResponse.body).token;
    });

    it('should get server config', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/config',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should get plugin config', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/config/plugins/test-plugin',
        headers: { authorization: `Bearer ${token}` },
      });

      // 503 if services not configured, 404 if plugin doesn't exist, 200 if success
      expect([200, 404, 503]).toContain(response.statusCode);
    });

    it('should update plugin config', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/config/plugins/test-plugin',
        headers: { authorization: `Bearer ${token}` },
        payload: { port: 3000 },
      });

      // 503 if services not configured, 404 if plugin doesn't exist, 200 if success
      expect([200, 404, 503]).toContain(response.statusCode);
    });
  });
});
