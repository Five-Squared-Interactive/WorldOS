/**
 * Admin Server
 *
 * Story 7.1: Fastify Admin Server
 * Story 7.2: Authentication System
 * Story 7.4: Plugin Status Dashboard
 * Story 7.6: MQTT-WebSocket Bridge
 *
 * HTTP server for web administration interface.
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import * as path from 'path';
import * as fs from 'fs';
import { AuthManager } from './auth.js';
import { Dashboard } from './dashboard.js';
import { MQTTBridge, MQTTClient } from './mqtt-bridge.js';

// Optional integration with wos-server
interface PluginRegistry {
  load(): Promise<void>;
  get(name: string): { name: string; version: string; enabled: boolean } | undefined;
  getAll(): { name: string; version: string; enabled: boolean }[];
  enable(name: string): Promise<void>;
  disable(name: string): Promise<void>;
}

interface ConfigManager {
  loadConfig(pluginName: string): Promise<Record<string, unknown>>;
  saveConfig(pluginName: string, config: Record<string, unknown>): Promise<void>;
}

interface PluginLoader {
  getPluginStatus(name: string): { name: string; state: string; pid?: number } | undefined;
  getAllPluginStatuses(): { name: string; state: string; pid?: number }[];
  startPlugin(name: string): Promise<void>;
  stopPlugin(name: string): Promise<void>;
  restartPlugin(name: string): Promise<void>;
}

interface AdminPanelInfo {
  name: string;
  displayName: string;
  entryPoint: string;
  icon?: string;
  route?: string;
}

interface LogEntry {
  plugin: string;
  level: string;
  message: string;
  timestamp: number;
}

interface LogAggregator {
  readAllLogs(options?: { limit?: number; level?: string; since?: number }): Promise<LogEntry[]>;
  on(event: 'log', handler: (entry: LogEntry) => void): void;
  off(event: 'log', handler: (entry: LogEntry) => void): void;
}

/**
 * Admin server options
 */
export interface AdminServerOptions {
  port?: number;
  host?: string;
  cors?: {
    origin?: string | string[] | boolean;
    credentials?: boolean;
  };
  serverDir?: string;
  authManager?: AuthManager;
  mqttClient?: MQTTClient;
  staticDir?: string;
  // Integration with wos-server components
  pluginRegistry?: PluginRegistry;
  configManager?: ConfigManager;
  pluginLoader?: PluginLoader;
  logAggregator?: LogAggregator;
  // Plugin admin panels (from wos-plugin.yaml manifests)
  panels?: AdminPanelInfo[];
  // Custom logo file path (absolute). Overrides the default WorldOS logo.
  customLogoPath?: string;
  // Custom favicon file path (absolute). Overrides the default WorldOS favicon.
  customFaviconPath?: string;
}

/**
 * Extend FastifyRequest with user info
 */
declare module 'fastify' {
  interface FastifyRequest {
    user?: { username: string };
  }
}

/**
 * Create and configure the admin server
 */
export async function createAdminServer(
  options: AdminServerOptions = {}
): Promise<FastifyInstance> {
  const server = Fastify({
    logger: false,
  });

  // Use provided auth manager or create default
  const authManager = options.authManager ?? new AuthManager();

  // Register CORS
  await server.register(cors, {
    origin: options.cors?.origin ?? true,
    credentials: options.cors?.credentials ?? true,
  });

  // Register WebSocket support
  await server.register(websocket);

  // Authentication hook — skips auth when no credentials are configured
  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    // If no credentials are set, allow all requests (open access mode)
    if (!authManager.hasCredentials()) {
      request.user = { username: 'admin' };
      return;
    }

    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'No token provided' });
    }

    const token = authHeader.slice(7);
    const session = authManager.getSession(token);

    if (!session) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' });
    }

    request.user = { username: session.username };
  };

  // ============================================
  // Public routes (no auth required)
  // ============================================

  // Health endpoint
  server.get('/api/health', async () => {
    return {
      status: 'ok',
      timestamp: Date.now(),
      authBypass: !authManager.hasCredentials(),
      hasLogAggregator: !!options.logAggregator,
      hasStaticDir: !!options.staticDir,
      version: 2,
    };
  });

  // Status endpoint (public)
  server.get('/api/status', async () => {
    return {
      server: {
        status: 'running',
        pid: process.pid,
        uptime: process.uptime(),
        version: '1.0.0',
      },
      timestamp: Date.now(),
    };
  });

  // ============================================
  // Auth routes
  // ============================================

  // Login
  server.post('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body as { username: string; password: string };

    const session = await authManager.login(username, password);

    if (!session) {
      reply.code(401).send({ error: 'Unauthorized', message: 'Invalid credentials' });
      return;
    }

    return {
      success: true,
      token: session.token,
      expiresAt: session.expiresAt,
    };
  });

  // Logout
  server.post('/api/auth/logout', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const token = request.headers.authorization?.slice(7);
    if (token) {
      authManager.logout(token);
    }
    return { success: true };
  });

  // Get session info
  server.get('/api/auth/session', {
    preHandler: authenticate,
  }, async (request) => {
    return {
      username: request.user?.username,
      authenticated: true,
    };
  });

  // ============================================
  // Protected routes (auth required)
  // ============================================

  // Create dashboard instance
  const serverDir = options.serverDir ?? process.cwd();
  const dashboard = new Dashboard({ serverDir });

  // Dashboard endpoint
  server.get('/api/dashboard', {
    preHandler: authenticate,
  }, async () => {
    return await dashboard.getData();
  });

  // Plugins list
  server.get('/api/plugins', {
    preHandler: authenticate,
  }, async () => {
    // If we have real services, use them
    if (options.pluginRegistry) {
      const registeredPlugins = options.pluginRegistry.getAll();
      const statuses = options.pluginLoader?.getAllPluginStatuses() ?? [];

      // Merge registry info with runtime status
      const plugins = registeredPlugins.map(plugin => {
        const status = statuses.find(s => s.name === plugin.name);
        return {
          ...plugin,
          state: status?.state ?? (plugin.enabled ? 'stopped' : 'disabled'),
          pid: status?.pid,
        };
      });

      return {
        plugins,
        timestamp: Date.now(),
      };
    }

    // Fall back to dashboard data
    const dashboardData = await dashboard.getData();
    return {
      plugins: dashboardData.plugins.list,
      timestamp: Date.now(),
    };
  });

  // Panels endpoint — returns registered plugin admin panels
  server.get('/api/panels', {
    preHandler: authenticate,
  }, async () => {
    return {
      panels: options.panels ?? [],
    };
  });

  // Plugin details
  server.get('/api/plugins/:name', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { name } = request.params as { name: string };

    // Try plugin registry first
    if (options.pluginRegistry) {
      const plugin = options.pluginRegistry.get(name);
      if (plugin) {
        // Merge with loader status if available
        const status = options.pluginLoader?.getPluginStatus(name);
        return {
          ...plugin,
          state: status?.state ?? 'unknown',
          pid: status?.pid,
          timestamp: Date.now(),
        };
      }
    }

    reply.code(404).send({ error: 'Not found', message: `Plugin '${name}' not found` });
  });

  // Enable plugin
  server.post('/api/plugins/:name/enable', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { name } = request.params as { name: string };

    if (!options.pluginRegistry) {
      reply.code(503).send({ error: 'Service unavailable', message: 'Plugin registry not configured' });
      return;
    }

    const plugin = options.pluginRegistry.get(name);
    if (!plugin) {
      reply.code(404).send({ error: 'Not found', message: `Plugin '${name}' not found` });
      return;
    }

    await options.pluginRegistry.enable(name);
    return { success: true, plugin: name, enabled: true };
  });

  // Disable plugin
  server.post('/api/plugins/:name/disable', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { name } = request.params as { name: string };

    if (!options.pluginRegistry) {
      reply.code(503).send({ error: 'Service unavailable', message: 'Plugin registry not configured' });
      return;
    }

    const plugin = options.pluginRegistry.get(name);
    if (!plugin) {
      reply.code(404).send({ error: 'Not found', message: `Plugin '${name}' not found` });
      return;
    }

    await options.pluginRegistry.disable(name);
    return { success: true, plugin: name, enabled: false };
  });

  // Restart plugin
  server.post('/api/plugins/:name/restart', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { name } = request.params as { name: string };

    if (!options.pluginLoader) {
      reply.code(503).send({ error: 'Service unavailable', message: 'Plugin loader not configured' });
      return;
    }

    const status = options.pluginLoader.getPluginStatus(name);
    if (!status) {
      reply.code(404).send({ error: 'Not found', message: `Plugin '${name}' not found or not running` });
      return;
    }

    await options.pluginLoader.restartPlugin(name);
    return { success: true, plugin: name, action: 'restart' };
  });

  // Start plugin
  server.post('/api/plugins/:name/start', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { name } = request.params as { name: string };

    if (!options.pluginLoader) {
      reply.code(503).send({ error: 'Service unavailable', message: 'Plugin loader not configured' });
      return;
    }

    // Verify plugin exists in registry if available
    if (options.pluginRegistry) {
      const plugin = options.pluginRegistry.get(name);
      if (!plugin) {
        reply.code(404).send({ error: 'Not found', message: `Plugin '${name}' not found` });
        return;
      }
    }

    await options.pluginLoader.startPlugin(name);
    return { success: true, plugin: name, action: 'start' };
  });

  // Stop plugin
  server.post('/api/plugins/:name/stop', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { name } = request.params as { name: string };

    if (!options.pluginLoader) {
      reply.code(503).send({ error: 'Service unavailable', message: 'Plugin loader not configured' });
      return;
    }

    const status = options.pluginLoader.getPluginStatus(name);
    if (!status) {
      reply.code(404).send({ error: 'Not found', message: `Plugin '${name}' not found or not running` });
      return;
    }

    await options.pluginLoader.stopPlugin(name);
    return { success: true, plugin: name, action: 'stop' };
  });

  // Config endpoint
  server.get('/api/config', {
    preHandler: authenticate,
  }, async () => {
    return {
      server: {
        port: options.port ?? 3000,
        host: options.host ?? '0.0.0.0',
      },
      timestamp: Date.now(),
    };
  });

  // Plugin config
  server.get('/api/config/plugins/:name', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { name } = request.params as { name: string };

    if (!options.configManager) {
      reply.code(503).send({ error: 'Service unavailable', message: 'Config manager not configured' });
      return;
    }

    // Verify plugin exists if registry is available
    if (options.pluginRegistry) {
      const plugin = options.pluginRegistry.get(name);
      if (!plugin) {
        reply.code(404).send({ error: 'Not found', message: `Plugin '${name}' not found` });
        return;
      }
    }

    try {
      const config = await options.configManager.loadConfig(name);
      return { plugin: name, config, timestamp: Date.now() };
    } catch (error) {
      reply.code(404).send({ error: 'Not found', message: `Config for plugin '${name}' not found` });
    }
  });

  // Update plugin config
  server.put('/api/config/plugins/:name', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { name } = request.params as { name: string };
    const config = request.body as Record<string, unknown>;

    if (!options.configManager) {
      reply.code(503).send({ error: 'Service unavailable', message: 'Config manager not configured' });
      return;
    }

    // Verify plugin exists if registry is available
    if (options.pluginRegistry) {
      const plugin = options.pluginRegistry.get(name);
      if (!plugin) {
        reply.code(404).send({ error: 'Not found', message: `Plugin '${name}' not found` });
        return;
      }
    }

    try {
      await options.configManager.saveConfig(name, config);
      return { success: true, plugin: name, timestamp: Date.now() };
    } catch (error) {
      reply.code(500).send({ error: 'Update failed', message: (error as Error).message });
    }
  });

  // In-memory log buffer for live log streaming
  const logBuffer: LogEntry[] = [];
  const MAX_LOG_BUFFER = 500;

  if (options.logAggregator) {
    options.logAggregator.on('log', (entry: LogEntry) => {
      logBuffer.push(entry);
      if (logBuffer.length > MAX_LOG_BUFFER) {
        logBuffer.splice(0, logBuffer.length - MAX_LOG_BUFFER);
      }
    });
  }

  // Logs endpoint — merges file-based and in-memory logs
  server.get('/api/logs', {
    preHandler: authenticate,
  }, async (request) => {
    const { limit: limitStr, level, since: sinceStr } = request.query as { limit?: string; level?: string; since?: string };
    const limit = limitStr ? parseInt(limitStr, 10) : 200;
    const since = sinceStr ? parseInt(sinceStr, 10) : undefined;

    let entries: LogEntry[] = [];

    if (options.logAggregator) {
      // Try file-based logs first
      const fileLogs = await options.logAggregator.readAllLogs({
        limit: limit * 2,
        level: level || undefined,
        since,
      });
      entries = fileLogs;
    }

    // Merge in-memory buffer (catches logs not yet flushed to disk)
    const memLogs = logBuffer.filter(e => {
      if (since && e.timestamp < since) return false;
      if (level && e.level !== level) return false;
      return true;
    });

    // Deduplicate by timestamp+plugin+message
    const seen = new Set(entries.map(e => `${e.timestamp}|${e.plugin}|${e.message}`));
    for (const e of memLogs) {
      const key = `${e.timestamp}|${e.plugin}|${e.message}`;
      if (!seen.has(key)) {
        entries.push(e);
        seen.add(key);
      }
    }

    // Sort descending by timestamp, apply limit
    entries.sort((a, b) => b.timestamp - a.timestamp);
    entries = entries.slice(0, limit);

    return { logs: entries, timestamp: Date.now() };
  });

  // ============================================
  // WebSocket routes
  // ============================================

  // Create MQTT bridge if client is provided
  let mqttBridge: MQTTBridge | undefined;
  if (options.mqttClient) {
    mqttBridge = new MQTTBridge({ mqttClient: options.mqttClient });
  }

  // WebSocket endpoint for real-time updates
  server.get('/ws', { websocket: true }, (connection, request) => {
    let username = 'admin';

    // In open-access mode (no credentials), allow all connections
    if (authManager.hasCredentials()) {
      const token = (request.query as Record<string, string>).token;

      if (!token) {
        connection.send(JSON.stringify({ type: 'error', error: 'No token provided' }));
        connection.close();
        return;
      }

      const session = authManager.getSession(token);
      if (!session) {
        connection.send(JSON.stringify({ type: 'error', error: 'Invalid token' }));
        connection.close();
        return;
      }

      username = session.username;
    }

    // Add to MQTT bridge if available
    if (mqttBridge) {
      mqttBridge.addClient(connection as any, username);
    }

    // Send connection success message
    connection.send(JSON.stringify({
      type: 'connected',
      username,
      timestamp: Date.now(),
    }));
  });

  // Expose MQTT bridge for external access
  (server as any).mqttBridge = mqttBridge;

  // ============================================
  // Custom logo override
  // ============================================

  if (options.customLogoPath && fs.existsSync(options.customLogoPath)) {
    const logoPath = options.customLogoPath;
    const ext = path.extname(logoPath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
    };
    const contentType = mimeTypes[ext] ?? 'image/png';

    server.get('/logo.png', async (_request, reply) => {
      reply.header('content-type', contentType);
      reply.header('cache-control', 'no-cache');
      reply.header('x-content-type-options', 'nosniff');
      return reply.send(fs.createReadStream(logoPath));
    });
  }

  // ============================================
  // Custom favicon override
  // ============================================

  if (options.customFaviconPath && fs.existsSync(options.customFaviconPath)) {
    const faviconPath = options.customFaviconPath;
    const ext = path.extname(faviconPath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.ico': 'image/x-icon',
      '.svg': 'image/svg+xml',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
    };
    const contentType = mimeTypes[ext] ?? 'image/png';

    server.get('/favicon.png', async (_request, reply) => {
      reply.header('content-type', contentType);
      reply.header('cache-control', 'no-cache');
      reply.header('x-content-type-options', 'nosniff');
      return reply.send(fs.createReadStream(faviconPath));
    });
  }

  // ============================================
  // Static file serving
  // ============================================

  // Serve static files if staticDir is provided
  if (options.staticDir && fs.existsSync(options.staticDir)) {
    // Serve main static files
    await server.register(fastifyStatic, {
      root: options.staticDir,
      prefix: '/',
      decorateReply: true,
      setHeaders: (reply) => {
        reply.setHeader('x-content-type-options', 'nosniff');
        reply.setHeader('cache-control', 'no-cache');
      },
    });

    // Serve plugin static files
    const pluginsDir = path.join(serverDir, 'plugins');
    if (fs.existsSync(pluginsDir)) {
      await server.register(fastifyStatic, {
        root: pluginsDir,
        prefix: '/plugins/',
        decorateReply: false,
        setHeaders: (reply) => {
          reply.setHeader('x-content-type-options', 'nosniff');
          reply.setHeader('cache-control', 'no-cache');
        },
      });
    }

    // SPA fallback - serve index.html for unmatched non-API routes
    server.setNotFoundHandler(async (request, reply) => {
      // Don't serve SPA fallback for API routes
      if (request.url.startsWith('/api/')) {
        reply.code(404).send({ error: 'Not found' });
        return;
      }

      // Try to serve index.html for SPA routing
      const indexPath = path.join(options.staticDir!, 'index.html');
      if (fs.existsSync(indexPath)) {
        reply.header('content-type', 'text/html; charset=utf-8');
        reply.header('x-content-type-options', 'nosniff');
        return reply.sendFile('index.html');
      }

      reply.code(404).send({ error: 'Not found' });
    });
  }

  return server;
}

/**
 * Start the admin server
 */
export async function startAdminServer(
  options: AdminServerOptions = {}
): Promise<FastifyInstance> {
  const server = await createAdminServer(options);

  await server.listen({
    port: options.port ?? 3000,
    host: options.host ?? '0.0.0.0',
  });

  return server;
}
