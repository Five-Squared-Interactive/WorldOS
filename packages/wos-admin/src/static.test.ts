/**
 * Static File Serving Tests
 *
 * Story 7.8: Admin Static Files
 *
 * Tests for serving static files for the admin UI.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAdminServer, AdminServerOptions } from './server.js';
import { AuthManager } from './auth.js';
import type { FastifyInstance } from 'fastify';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Static File Serving', () => {
  let server: FastifyInstance;
  let authManager: AuthManager;
  let tmpDir: string;
  let staticDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-static-test-'));
    staticDir = path.join(tmpDir, 'public');
    await fs.mkdir(staticDir, { recursive: true });

    authManager = new AuthManager();
    await authManager.setCredentials('admin', 'password');
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('static directory', () => {
    it('should serve index.html from static directory', async () => {
      // Create index.html
      await fs.writeFile(
        path.join(staticDir, 'index.html'),
        '<html><body>Admin UI</body></html>'
      );

      server = await createAdminServer({
        port: 0,
        authManager,
        serverDir: tmpDir,
        staticDir,
      });
      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Admin UI');
    });

    it('should serve static files with correct content-type', async () => {
      await fs.writeFile(
        path.join(staticDir, 'style.css'),
        'body { margin: 0; }'
      );

      server = await createAdminServer({
        port: 0,
        authManager,
        serverDir: tmpDir,
        staticDir,
      });
      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/style.css',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/css');
    });

    it('should serve JavaScript files', async () => {
      await fs.writeFile(
        path.join(staticDir, 'app.js'),
        'console.log("Admin app");'
      );

      server = await createAdminServer({
        port: 0,
        authManager,
        serverDir: tmpDir,
        staticDir,
      });
      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/app.js',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Admin app');
    });

    it('should serve files from subdirectories', async () => {
      const assetsDir = path.join(staticDir, 'assets');
      await fs.mkdir(assetsDir, { recursive: true });
      await fs.writeFile(
        path.join(assetsDir, 'logo.svg'),
        '<svg>logo</svg>'
      );

      server = await createAdminServer({
        port: 0,
        authManager,
        serverDir: tmpDir,
        staticDir,
      });
      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/assets/logo.svg',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return 404 for non-existent static files', async () => {
      server = await createAdminServer({
        port: 0,
        authManager,
        serverDir: tmpDir,
        staticDir,
      });
      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/nonexistent.js',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('SPA routing', () => {
    it('should serve index.html for unmatched routes (SPA fallback)', async () => {
      await fs.writeFile(
        path.join(staticDir, 'index.html'),
        '<html><body>SPA</body></html>'
      );

      server = await createAdminServer({
        port: 0,
        authManager,
        serverDir: tmpDir,
        staticDir,
      });
      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/dashboard',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('SPA');
    });

    it('should not use SPA fallback for API routes', async () => {
      await fs.writeFile(
        path.join(staticDir, 'index.html'),
        '<html><body>SPA</body></html>'
      );

      server = await createAdminServer({
        port: 0,
        authManager,
        serverDir: tmpDir,
        staticDir,
      });
      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/api/nonexistent',
      });

      // Should return 404 for unknown API routes, not SPA fallback
      expect(response.statusCode).toBe(404);
    });
  });

  describe('plugin static files', () => {
    it('should serve plugin static files from plugin directory', async () => {
      // Plugin files are served directly from plugins/<name>/ directory
      const pluginDir = path.join(tmpDir, 'plugins', 'my-plugin');
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(
        path.join(pluginDir, 'admin.js'),
        'export function mount() {}'
      );

      server = await createAdminServer({
        port: 0,
        authManager,
        serverDir: tmpDir,
        staticDir,
      });
      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/plugins/my-plugin/admin.js',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('mount');
    });
  });

  describe('security', () => {
    it('should not serve files outside static directory', async () => {
      // Create a file outside static dir
      await fs.writeFile(
        path.join(tmpDir, 'secret.txt'),
        'secret data'
      );

      server = await createAdminServer({
        port: 0,
        authManager,
        serverDir: tmpDir,
        staticDir,
      });
      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/../secret.txt',
      });

      // Should not serve the file
      expect([400, 404]).toContain(response.statusCode);
    });

    it('should set security headers', async () => {
      await fs.writeFile(
        path.join(staticDir, 'index.html'),
        '<html></html>'
      );

      server = await createAdminServer({
        port: 0,
        authManager,
        serverDir: tmpDir,
        staticDir,
      });
      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/',
      });

      // Check for basic security headers
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('caching', () => {
    it('should set cache headers for static assets', async () => {
      await fs.writeFile(
        path.join(staticDir, 'app.js'),
        'console.log("app");'
      );

      server = await createAdminServer({
        port: 0,
        authManager,
        serverDir: tmpDir,
        staticDir,
      });
      await server.ready();

      const response = await server.inject({
        method: 'GET',
        url: '/app.js',
      });

      // Should have some cache control header
      expect(response.headers['cache-control']).toBeDefined();
    });
  });
});
