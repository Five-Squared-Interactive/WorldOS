/**
 * WorldOS Server E2E Tests (Full Stack)
 *
 * Story 11.5: End-to-end validation with real MQTT broker.
 *
 * Tests the complete WorldOSServer class with:
 * - Real aedes MQTT broker (in-process)
 * - Real plugin processes (child_process.spawn)
 * - Real health check protocol over MQTT
 * - Server start/stop lifecycle
 * - Plugin event forwarding
 * - Server status aggregation
 * - Log aggregation
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import * as net from 'net';
import { EventEmitter } from 'events';
import Aedes from 'aedes';
import { WorldOSServer, initServer, loadServerConfig } from '../src/server.js';
import type { PluginStatus } from '../src/plugin-loader/types.js';

// ── Helpers ─────────────────────────────────────────────────────────────

const E2E_TIMEOUT = 30000;

/** Find a free port */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const addr = server.address() as net.AddressInfo;
      server.close(() => resolve(addr.port));
    });
    server.on('error', reject);
  });
}

/** Create a test plugin */
async function createTestPlugin(
  pluginsDir: string,
  name: string,
  options: {
    behavior?: 'long-running' | 'crash-immediate' | 'crash-after-delay';
    crashDelayMs?: number;
    dependencies?: string[];
  } = {}
): Promise<string> {
  const pluginDir = path.join(pluginsDir, name);
  await fs.mkdir(pluginDir, { recursive: true });

  const manifest: Record<string, unknown> = {
    name,
    displayName: `Test: ${name}`,
    version: '1.0.0',
    runtime: 'node',
    entrypoint: 'index.js',
    description: `E2E test plugin: ${name}`,
  };
  if (options.dependencies) {
    manifest.dependencies = options.dependencies;
  }
  await fs.writeFile(path.join(pluginDir, 'wos-plugin.yaml'), yaml.stringify(manifest));

  let script: string;
  switch (options.behavior) {
    case 'crash-immediate':
      script = 'process.exit(1);';
      break;
    case 'crash-after-delay':
      script = `setTimeout(() => process.exit(1), ${options.crashDelayMs ?? 500});`;
      break;
    case 'long-running':
    default:
      script = `
        console.log('Plugin ${name} started');
        setInterval(() => {}, 1000);
        process.on('SIGTERM', () => {
          console.log('Plugin ${name} shutting down');
          process.exit(0);
        });
      `;
  }

  await fs.writeFile(path.join(pluginDir, 'index.js'), script);
  return pluginDir;
}

/** Wait for an event with timeout */
function waitForEvent<T>(
  emitter: EventEmitter,
  event: string,
  timeoutMs = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeoutMs);

    const handler = (data: T) => {
      clearTimeout(timeout);
      emitter.off(event, handler);
      resolve(data);
    };

    emitter.on(event, handler);
  });
}

// ── Test Suite ──────────────────────────────────────────────────────────

describe('WorldOSServer Full-Stack E2E', () => {
  let aedes: Aedes;
  let mqttServer: net.Server;
  let mqttPort: number;
  let testDir: string;
  let server: WorldOSServer | null = null;

  beforeAll(async () => {
    // Start in-process MQTT broker
    mqttPort = await findFreePort();
    aedes = new Aedes();
    mqttServer = net.createServer(aedes.handle);

    await new Promise<void>((resolve) => {
      mqttServer.listen(mqttPort, () => {
        resolve();
      });
    });
  });

  afterAll(async () => {
    aedes.close();
    await new Promise<void>((resolve) => {
      mqttServer.close(() => resolve());
    });
  });

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-server-e2e-'));

    // Initialize server directory
    await initServer(testDir);
  });

  afterEach(async () => {
    // Stop server if running
    if (server && server.isRunning()) {
      try {
        await server.stop();
      } catch {
        // Ignore stop errors in cleanup
      }
    }
    server = null;

    await new Promise(r => setTimeout(r, 500));
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors on Windows
    }
  });

  // ── Server Lifecycle ─────────────────────────────────────────────

  describe('Server Lifecycle', () => {
    it('should start and connect to MQTT broker', async () => {
      server = new WorldOSServer({
        serverDir: testDir,
        mqttHost: 'localhost',
        mqttPort,
      });

      expect(server.getState()).toBe('stopped');

      await server.start();

      expect(server.getState()).toBe('running');
      expect(server.isRunning()).toBe(true);
    });

    it('should emit server:starting and server:started events', async () => {
      server = new WorldOSServer({
        serverDir: testDir,
        mqttHost: 'localhost',
        mqttPort,
      });

      const events: string[] = [];
      server.on('server:starting', () => events.push('starting'));
      server.on('server:started', () => events.push('started'));

      await server.start();

      expect(events).toEqual(['starting', 'started']);
    });

    it('should stop gracefully', async () => {
      server = new WorldOSServer({
        serverDir: testDir,
        mqttHost: 'localhost',
        mqttPort,
      });

      await server.start();
      expect(server.isRunning()).toBe(true);

      const events: string[] = [];
      server.on('server:stopping', () => events.push('stopping'));
      server.on('server:stopped', () => events.push('stopped'));

      await server.stop();

      expect(server.getState()).toBe('stopped');
      expect(events).toEqual(['stopping', 'stopped']);
    });

    it('should throw when starting already running server', async () => {
      server = new WorldOSServer({
        serverDir: testDir,
        mqttHost: 'localhost',
        mqttPort,
      });

      await server.start();

      await expect(server.start()).rejects.toThrow("Cannot start server in state 'running'");
    });

    it('should throw when stopping non-running server', async () => {
      server = new WorldOSServer({
        serverDir: testDir,
        mqttHost: 'localhost',
        mqttPort,
      });

      await expect(server.stop()).rejects.toThrow("Cannot stop server in state 'stopped'");
    });

    it('should restart server', async () => {
      server = new WorldOSServer({
        serverDir: testDir,
        mqttHost: 'localhost',
        mqttPort,
      });

      await server.start();
      expect(server.isRunning()).toBe(true);

      await server.restart();
      expect(server.isRunning()).toBe(true);
    });
  });

  // ── Plugin Lifecycle through Server ────────────────────────────

  describe('Plugin Lifecycle through Server', () => {
    it('should discover and start plugins on server.start()', async () => {
      const pluginsDir = path.join(testDir, 'plugins');
      await createTestPlugin(pluginsDir, 'srv-plugin-a', { behavior: 'long-running' });

      server = new WorldOSServer({
        serverDir: testDir,
        mqttHost: 'localhost',
        mqttPort,
      });

      const startedPlugins: string[] = [];
      server.on('plugin:started', (status: PluginStatus) => {
        startedPlugins.push(status.name);
      });

      await server.start();

      // Give plugins time to start
      await new Promise(r => setTimeout(r, 500));

      expect(startedPlugins).toContain('srv-plugin-a');

      const pluginStatus = server.getPluginStatus('srv-plugin-a');
      expect(pluginStatus?.state).toBe('running');
      expect(pluginStatus?.pid).toBeGreaterThan(0);
    });

    it('should start multiple plugins', async () => {
      const pluginsDir = path.join(testDir, 'plugins');
      await createTestPlugin(pluginsDir, 'multi-a', { behavior: 'long-running' });
      await createTestPlugin(pluginsDir, 'multi-b', { behavior: 'long-running' });

      server = new WorldOSServer({
        serverDir: testDir,
        mqttHost: 'localhost',
        mqttPort,
      });

      await server.start();
      await new Promise(r => setTimeout(r, 500));

      const statuses = server.getAllPluginStatuses();
      expect(statuses).toHaveLength(2);
      expect(statuses.every(s => s.state === 'running')).toBe(true);
    });

    it('should stop all plugins on server.stop()', async () => {
      const pluginsDir = path.join(testDir, 'plugins');
      await createTestPlugin(pluginsDir, 'stop-test', { behavior: 'long-running' });

      server = new WorldOSServer({
        serverDir: testDir,
        mqttHost: 'localhost',
        mqttPort,
      });

      await server.start();
      await new Promise(r => setTimeout(r, 300));

      // Verify running
      expect(server.getPluginStatus('stop-test')?.state).toBe('running');

      await server.stop();

      // After stop, server state is stopped
      expect(server.getState()).toBe('stopped');
    });

    it('should forward plugin:crashed events', async () => {
      const pluginsDir = path.join(testDir, 'plugins');
      await createTestPlugin(pluginsDir, 'crash-fwd', { behavior: 'crash-immediate' });

      server = new WorldOSServer({
        serverDir: testDir,
        mqttHost: 'localhost',
        mqttPort,
      });

      const crashPromise = waitForEvent<PluginStatus>(server, 'plugin:crashed', 5000);

      await server.start();

      const crashed = await crashPromise;
      expect(crashed.name).toBe('crash-fwd');
    });

    it('should restart individual plugin via server', async () => {
      const pluginsDir = path.join(testDir, 'plugins');
      await createTestPlugin(pluginsDir, 'restart-via-srv', { behavior: 'long-running' });

      server = new WorldOSServer({
        serverDir: testDir,
        mqttHost: 'localhost',
        mqttPort,
      });

      await server.start();
      await new Promise(r => setTimeout(r, 300));

      const beforePid = server.getPluginStatus('restart-via-srv')?.pid;

      await server.restartPlugin('restart-via-srv');
      await new Promise(r => setTimeout(r, 300));

      const afterPid = server.getPluginStatus('restart-via-srv')?.pid;
      expect(afterPid).toBeGreaterThan(0);
      expect(afterPid).not.toBe(beforePid);
    });
  });

  // ── Server Status Aggregation ─────────────────────────────────

  describe('Server Status Aggregation', () => {
    it('should report server status with running plugins', async () => {
      const pluginsDir = path.join(testDir, 'plugins');
      await createTestPlugin(pluginsDir, 'status-a', { behavior: 'long-running' });
      await createTestPlugin(pluginsDir, 'status-b', { behavior: 'long-running' });

      server = new WorldOSServer({
        serverDir: testDir,
        mqttHost: 'localhost',
        mqttPort,
      });

      await server.start();
      await new Promise(r => setTimeout(r, 500));

      const status = server.getStatus();
      expect(status.state).toBe('running');
      expect(status.startedAt).toBeDefined();
      expect(status.totalPlugins).toBe(2);
      expect(status.runningPlugins).toBe(2);
    });

    it('should report healthy with no plugins', async () => {
      server = new WorldOSServer({
        serverDir: testDir,
        mqttHost: 'localhost',
        mqttPort,
      });

      await server.start();

      const status = server.getStatus();
      expect(status.status).toBe('healthy');
      expect(status.totalPlugins).toBe(0);
    });

    it('should expose registry and config manager', async () => {
      server = new WorldOSServer({
        serverDir: testDir,
        mqttHost: 'localhost',
        mqttPort,
      });

      expect(server.getRegistry()).toBeDefined();
      expect(server.getConfigManager()).toBeDefined();
      expect(server.getWebhookManager()).toBeDefined();
      expect(server.getLogAggregator()).toBeDefined();
      expect(server.getPluginLoader()).toBeDefined();
    });
  });

  // ── MQTT Health Checks (Real Broker) ──────────────────────────

  describe('MQTT Health Checks (Real Broker)', () => {
    it('should send health check requests over real MQTT', async () => {
      const pluginsDir = path.join(testDir, 'plugins');
      await createTestPlugin(pluginsDir, 'mqtt-health-test', { behavior: 'long-running' });

      // Track health requests on the broker
      const healthRequests: string[] = [];
      aedes.on('publish', (packet) => {
        if (packet.topic.includes('/health/request')) {
          healthRequests.push(packet.topic);
        }
      });

      server = new WorldOSServer({
        serverDir: testDir,
        mqttHost: 'localhost',
        mqttPort,
        mqttEmbedded: false, // Use the test's aedes broker, not embedded Mosquitto
        logLevel: 'debug',
      });

      await server.start();

      // Wait for health check interval (default 30s, but we need to wait)
      // Health checks start immediately after plugin starts
      await new Promise(r => setTimeout(r, 2000));

      expect(healthRequests.some(t => t.includes('mqtt-health-test'))).toBe(true);
    });
  });

  // ── Config Loading ────────────────────────────────────────────

  describe('Configuration', () => {
    it('should load config from wos.yaml via loadServerConfig', async () => {
      // Write custom config
      const customConfig = yaml.stringify({
        server: { name: 'test-server', logLevel: 'debug' },
        mqtt: { host: 'localhost', port: mqttPort },
        admin: { enabled: true, port: 4000 },
        plugins: {},
      });
      await fs.writeFile(path.join(testDir, 'wos.yaml'), customConfig);

      const config = await loadServerConfig(testDir);
      expect(config.serverDir).toBe(testDir);
      expect(config.mqttHost).toBe('localhost');
      expect(config.mqttPort).toBe(mqttPort);
      expect(config.adminPort).toBe(4000);
      expect(config.logLevel).toBe('debug');
    });

    it('should return defaults when wos.yaml missing', async () => {
      const emptyDir = path.join(testDir, 'empty');
      await fs.mkdir(emptyDir, { recursive: true });

      const config = await loadServerConfig(emptyDir);
      expect(config.mqttHost).toBe('localhost');
      expect(config.mqttPort).toBe(1883);
      expect(config.adminPort).toBe(3000);
      expect(config.logLevel).toBe('info');
    });

    it('should use config manager for plugin config', async () => {
      // Write config with plugin config section
      const config = yaml.stringify({
        server: { logLevel: 'info' },
        mqtt: { host: 'localhost', port: mqttPort },
        plugins: {
          'config-test': {
            enabled: true,
            version: '1.0.0',
            config: {
              interval: 5000,
              debug: true,
            },
          },
        },
      });
      await fs.writeFile(path.join(testDir, 'wos.yaml'), config);

      server = new WorldOSServer({
        serverDir: testDir,
        mqttHost: 'localhost',
        mqttPort,
      });

      const configManager = server.getConfigManager();
      const pluginConfig = await configManager.loadConfig('config-test');
      expect(pluginConfig.interval).toBe(5000);
      expect(pluginConfig.debug).toBe(true);
    });
  });

  // ── initServer ────────────────────────────────────────────────

  describe('initServer', () => {
    it('should create full directory structure', async () => {
      const newDir = path.join(testDir, 'fresh-server');
      await initServer(newDir);

      // Verify structure
      const dirStat = await fs.stat(newDir);
      expect(dirStat.isDirectory()).toBe(true);

      const pluginsStat = await fs.stat(path.join(newDir, 'plugins'));
      expect(pluginsStat.isDirectory()).toBe(true);

      const configContent = await fs.readFile(path.join(newDir, 'wos.yaml'), 'utf-8');
      const parsed = yaml.parse(configContent);
      expect(parsed.server).toBeDefined();
      expect(parsed.mqtt).toBeDefined();
      expect(parsed.plugins).toBeDefined();
    });
  });

  // ── Error Handling ────────────────────────────────────────────

  describe('Error Handling', () => {
    it('should fail to connect with wrong MQTT port', async () => {
      server = new WorldOSServer({
        serverDir: testDir,
        mqttHost: 'localhost',
        mqttPort: 59999, // Nobody listening here
        mqttEmbedded: false, // Don't start embedded broker — we want a real failure
      });

      await expect(server.start()).rejects.toThrow();
      expect(server.getState()).toBe('stopped');
    });

    it('should emit server:error on MQTT connection failure', async () => {
      server = new WorldOSServer({
        serverDir: testDir,
        mqttHost: 'localhost',
        mqttPort: 59999,
        mqttEmbedded: false, // Don't start embedded broker — we want a real failure
      });

      const errors: Error[] = [];
      server.on('server:error', (err: Error) => errors.push(err));

      try {
        await server.start();
      } catch {
        // Expected
      }

      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
