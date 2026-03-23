/**
 * WorldOS Server Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { WorldOSServer, initServer, loadServerConfig } from './server.js';

describe('WorldOSServer', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-server-test-'));
    await initServer(testDir);
  });

  afterEach(async () => {
    await new Promise(r => setTimeout(r, 100));
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should create server with default config', () => {
      const server = new WorldOSServer({ serverDir: testDir });

      expect(server.getState()).toBe('stopped');
      expect(server.isRunning()).toBe(false);
    });

    it('should create server with custom config', () => {
      const server = new WorldOSServer({
        serverDir: testDir,
        mqttHost: 'mqtt.example.com',
        mqttPort: 1884,
        adminPort: 4000,
        logLevel: 'debug',
      });

      expect(server.getState()).toBe('stopped');
    });
  });

  describe('getStatus', () => {
    it('should return server status', () => {
      const server = new WorldOSServer({ serverDir: testDir });

      const status = server.getStatus();

      expect(status.state).toBe('stopped');
      expect(status.totalPlugins).toBe(0);
    });
  });

  describe('getRegistry', () => {
    it('should return plugin registry', () => {
      const server = new WorldOSServer({ serverDir: testDir });

      const registry = server.getRegistry();

      expect(registry).toBeDefined();
    });
  });

  describe('getConfigManager', () => {
    it('should return config manager', () => {
      const server = new WorldOSServer({ serverDir: testDir });

      const configManager = server.getConfigManager();

      expect(configManager).toBeDefined();
    });
  });

  describe('getWebhookManager', () => {
    it('should return webhook manager', () => {
      const server = new WorldOSServer({ serverDir: testDir });

      const webhookManager = server.getWebhookManager();

      expect(webhookManager).toBeDefined();
    });
  });

  describe('getLogAggregator', () => {
    it('should return log aggregator', () => {
      const server = new WorldOSServer({ serverDir: testDir });

      const logAggregator = server.getLogAggregator();

      expect(logAggregator).toBeDefined();
    });
  });

  describe('start/stop without MQTT', () => {
    it('should emit events on state changes', async () => {
      const server = new WorldOSServer({ serverDir: testDir });

      const startingHandler = vi.fn();
      server.on('server:starting', startingHandler);

      // Starting will fail without MQTT, but events should still fire
      server.start().catch(() => {});

      expect(startingHandler).toHaveBeenCalled();
    });

    it('should not allow starting when not stopped', async () => {
      const server = new WorldOSServer({ serverDir: testDir });

      // Manually set state
      (server as any).state = 'running';

      await expect(server.start()).rejects.toThrow("Cannot start server in state 'running'");
    });

    it('should not allow stopping when not running', async () => {
      const server = new WorldOSServer({ serverDir: testDir });

      await expect(server.stop()).rejects.toThrow("Cannot stop server in state 'stopped'");
    });
  });
});

describe('initServer', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-init-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should create plugins directory', async () => {
    const serverDir = path.join(testDir, 'my-server');

    await initServer(serverDir);

    const pluginsDir = path.join(serverDir, 'plugins');
    const stat = await fs.stat(pluginsDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('should create wos.yaml config file', async () => {
    const serverDir = path.join(testDir, 'my-server');

    await initServer(serverDir);

    const configPath = path.join(serverDir, 'wos.yaml');
    const content = await fs.readFile(configPath, 'utf-8');

    expect(content).toContain('WorldOS Server Configuration');
    expect(content).toContain('server:');
    expect(content).toContain('mqtt:');
    expect(content).toContain('plugins:');
  });

  it('should not overwrite existing config', async () => {
    const serverDir = path.join(testDir, 'my-server');
    const configPath = path.join(serverDir, 'wos.yaml');

    await fs.mkdir(serverDir, { recursive: true });
    await fs.writeFile(configPath, 'existing: config');

    await initServer(serverDir);

    const content = await fs.readFile(configPath, 'utf-8');
    expect(content).toBe('existing: config');
  });

  it('should be idempotent', async () => {
    const serverDir = path.join(testDir, 'my-server');

    await initServer(serverDir);
    await initServer(serverDir);

    const pluginsDir = path.join(serverDir, 'plugins');
    const stat = await fs.stat(pluginsDir);
    expect(stat.isDirectory()).toBe(true);
  });
});

describe('loadServerConfig', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-config-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should return defaults when no config exists', async () => {
    const config = await loadServerConfig(testDir);

    expect(config.serverDir).toBe(testDir);
    expect(config.mqttHost).toBe('localhost');
    expect(config.mqttPort).toBe(1883);
    expect(config.adminPort).toBe(3000);
    expect(config.logLevel).toBe('info');
  });

  it('should load config from wos.yaml', async () => {
    const configContent = `
server:
  logLevel: debug

mqtt:
  host: mqtt.example.com
  port: 1884
  username: user
  password: pass

admin:
  port: 4000
`;
    await fs.writeFile(path.join(testDir, 'wos.yaml'), configContent);

    const config = await loadServerConfig(testDir);

    expect(config.mqttHost).toBe('mqtt.example.com');
    expect(config.mqttPort).toBe(1884);
    expect(config.mqttUsername).toBe('user');
    expect(config.mqttPassword).toBe('pass');
    expect(config.adminPort).toBe(4000);
    expect(config.logLevel).toBe('debug');
  });

  it('should use defaults for missing config values', async () => {
    const configContent = `
server:
  name: my-server
`;
    await fs.writeFile(path.join(testDir, 'wos.yaml'), configContent);

    const config = await loadServerConfig(testDir);

    expect(config.mqttHost).toBe('localhost');
    expect(config.mqttPort).toBe(1883);
    expect(config.adminPort).toBe(3000);
  });
});
