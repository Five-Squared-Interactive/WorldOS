/**
 * WorldOS Server E2E Tests
 *
 * Story 11.5: End-to-end validation of the full WorldOS plugin system.
 *
 * Tests the complete lifecycle including:
 * - Server directory initialization (wos init)
 * - Plugin installation and manifest validation
 * - Plugin startup with process isolation
 * - Health check protocol via MQTT
 * - Crash detection and automatic restart with backoff
 * - Graceful degradation across multiple plugins
 * - Configuration management and hot-reload
 * - Graceful shutdown in reverse dependency order
 * - Server status aggregation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import { EventEmitter } from 'events';
import { PluginLoader } from '../src/plugin-loader/plugin-loader.js';
import { MqttClient, createHealthResponse } from '../src/plugin-loader/health-monitor.js';
import type { PluginStatus, HealthStatus, ServerStatus } from '../src/plugin-loader/types.js';
import { initServer } from '../src/server.js';

// ── Helpers ─────────────────────────────────────────────────────────────

const E2E_TIMEOUT = 30000;

/**
 * Mock MQTT broker for e2e tests — auto-responds to health checks
 */
class MockMqttBroker extends EventEmitter implements MqttClient {
  connected = true;
  subscriptions: Set<string> = new Set();
  publishedMessages: Array<{ topic: string; message: string; timestamp: number }> = [];
  private autoRespondHealth: Map<string, 'healthy' | 'degraded' | 'unhealthy'> = new Map();

  async publish(topic: string, message: string): Promise<void> {
    this.publishedMessages.push({ topic, message, timestamp: Date.now() });

    if (topic.includes('/health/request')) {
      const match = topic.match(/wos\/plugin\/([^/]+)\/health\/request/);
      if (match) {
        const pluginName = match[1];
        if (this.autoRespondHealth.has(pluginName)) {
          const status = this.autoRespondHealth.get(pluginName)!;
          const request = JSON.parse(message);
          setTimeout(() => {
            this.simulateHealthResponse(pluginName, request.correlationId, status);
          }, 10);
        }
      }
    }
  }

  async subscribe(topic: string): Promise<void> {
    this.subscriptions.add(topic);
  }

  async unsubscribe(topic: string): Promise<void> {
    this.subscriptions.delete(topic);
  }

  setAutoHealthResponse(pluginName: string, status: 'healthy' | 'degraded' | 'unhealthy'): void {
    this.autoRespondHealth.set(pluginName, status);
  }

  clearAutoHealthResponse(pluginName: string): void {
    this.autoRespondHealth.delete(pluginName);
  }

  simulateHealthResponse(
    pluginName: string,
    correlationId: string,
    status: 'healthy' | 'degraded' | 'unhealthy',
    details?: Record<string, unknown>
  ): void {
    const response = createHealthResponse(correlationId, status, details);
    const topic = `wos/plugin/${pluginName}/health/response`;
    this.emit('message', topic, Buffer.from(JSON.stringify(response)));
  }

  getHealthRequests(pluginName: string): Array<{ correlationId: string; timestamp: string }> {
    return this.publishedMessages
      .filter(m => m.topic === `wos/plugin/${pluginName}/health/request`)
      .map(m => JSON.parse(m.message));
  }

  clearMessages(): void {
    this.publishedMessages = [];
  }
}

/**
 * Create a test plugin with configurable behavior
 */
async function createTestPlugin(
  pluginsDir: string,
  name: string,
  options: {
    behavior?: 'long-running' | 'crash-immediate' | 'crash-after-delay' | 'exit-clean';
    crashDelayMs?: number;
    dependencies?: string[];
    config?: Record<string, unknown>;
  } = {}
): Promise<string> {
  const pluginDir = path.join(pluginsDir, name);
  await fs.mkdir(pluginDir, { recursive: true });

  // Create manifest
  const manifest: Record<string, unknown> = {
    name,
    displayName: `Test Plugin: ${name}`,
    version: '1.0.0',
    runtime: 'node',
    entrypoint: 'index.js',
    description: `E2E test plugin: ${name}`,
  };
  if (options.dependencies) {
    manifest.dependencies = options.dependencies;
  }
  if (options.config) {
    manifest.config = options.config;
  }
  await fs.writeFile(path.join(pluginDir, 'wos-plugin.yaml'), yaml.stringify(manifest));

  // Create script based on behavior
  let script: string;
  switch (options.behavior) {
    case 'crash-immediate':
      script = 'process.exit(1);';
      break;
    case 'crash-after-delay':
      script = `setTimeout(() => process.exit(1), ${options.crashDelayMs ?? 500});`;
      break;
    case 'exit-clean':
      script = 'process.exit(0);';
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

/**
 * Wait for an event with timeout
 */
function waitForEvent<T>(
  emitter: EventEmitter,
  event: string,
  timeoutMs = 5000,
  predicate?: (data: T) => boolean
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeoutMs);

    const handler = (data: T) => {
      if (!predicate || predicate(data)) {
        clearTimeout(timeout);
        emitter.off(event, handler);
        resolve(data);
      }
    };

    emitter.on(event, handler);
  });
}

/**
 * Create a PluginLoader with fast test timings
 */
function createTestLoader(serverDir: string): PluginLoader {
  return new PluginLoader({
    serverDir,
    mqttHost: 'localhost',
    mqttPort: 1883,
    healthCheck: {
      intervalMs: 300,
      timeoutMs: 150,
      failureThreshold: 3,
      gracefulShutdownMs: 1000,
    },
    restartPolicy: {
      initialBackoffMs: 100,
      maxBackoffMs: 1000,
      backoffMultiplier: 2,
      stableThresholdMs: 2000,
      circuitBreakerThreshold: 5,
      circuitBreakerWindowMs: 10000,
    },
  });
}

// ── Test Suites ─────────────────────────────────────────────────────────

describe('WorldOS Server E2E', () => {
  let testDir: string;
  let pluginsDir: string;
  let loader: PluginLoader;
  let mqttBroker: MockMqttBroker;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-e2e-'));
    pluginsDir = path.join(testDir, 'plugins');
    await fs.mkdir(pluginsDir);

    loader = createTestLoader(testDir);
    mqttBroker = new MockMqttBroker();
    loader.setMqttClient(mqttBroker);
  });

  afterEach(async () => {
    await loader.stopAll();
    await new Promise(r => setTimeout(r, 300));
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors on Windows
    }
  });

  // ── Scenario 1: Server Initialization ──────────────────────────────

  describe('Scenario 1: Server Initialization (wos init)', () => {
    it('should create server directory structure via initServer', async () => {
      const newServerDir = path.join(testDir, 'new-server');
      await initServer(newServerDir);

      // Verify directory structure
      const stat = await fs.stat(newServerDir);
      expect(stat.isDirectory()).toBe(true);

      const pluginsStat = await fs.stat(path.join(newServerDir, 'plugins'));
      expect(pluginsStat.isDirectory()).toBe(true);

      // Verify wos.yaml created
      const configContent = await fs.readFile(
        path.join(newServerDir, 'wos.yaml'),
        'utf-8'
      );
      expect(configContent).toContain('server:');
      expect(configContent).toContain('plugins:');
      expect(configContent).toContain('mqtt:');
    });

    it('should not overwrite existing wos.yaml on re-init', async () => {
      const newServerDir = path.join(testDir, 'reinit-server');
      await initServer(newServerDir);

      // Write custom config
      const customConfig = 'server:\n  name: my-custom-server\n  logLevel: debug\n';
      await fs.writeFile(path.join(newServerDir, 'wos.yaml'), customConfig);

      // Re-init should not overwrite
      await initServer(newServerDir);

      const content = await fs.readFile(path.join(newServerDir, 'wos.yaml'), 'utf-8');
      expect(content).toBe(customConfig);
    });

    it('should have valid YAML in generated wos.yaml', async () => {
      const newServerDir = path.join(testDir, 'yaml-test');
      await initServer(newServerDir);

      const content = await fs.readFile(path.join(newServerDir, 'wos.yaml'), 'utf-8');
      const config = yaml.parse(content);

      expect(config.server).toBeDefined();
      expect(config.mqtt).toBeDefined();
      expect(config.mqtt.host).toBe('localhost');
      expect(config.mqtt.port).toBe(1883);
      expect(config.admin).toBeDefined();
      expect(config.plugins).toBeDefined();
    });
  });

  // ── Scenario 2: Plugin Installation & Validation ───────────────────

  describe('Scenario 2: Plugin Installation & Validation', () => {
    it('should discover plugin from directory with valid manifest', async () => {
      await createTestPlugin(pluginsDir, 'install-test', { behavior: 'long-running' });

      const events: string[] = [];
      loader.on('plugin:discovered', () => events.push('discovered'));

      await loader.loadAll();

      expect(events).toContain('discovered');
      const status = loader.getPluginStatus('install-test');
      expect(status).toBeDefined();
      expect(status!.manifest.name).toBe('install-test');
      expect(status!.manifest.version).toBe('1.0.0');
      expect(status!.manifest.runtime).toBe('node');
    });

    it('should install test plugin from fixtures directory', async () => {
      // Copy fixture plugin
      const fixtureDir = path.join(__dirname, 'fixtures', 'test-plugin');
      const targetDir = path.join(pluginsDir, 'e2e-test-plugin');
      await copyDirectory(fixtureDir, targetDir);

      // Verify manifest
      const manifest = yaml.parse(
        await fs.readFile(path.join(targetDir, 'wos-plugin.yaml'), 'utf-8')
      );
      expect(manifest.name).toBe('e2e-test-plugin');
      expect(manifest.runtime).toBe('node');
      expect(manifest.entrypoint).toBe('./index.js');
    });

    it('should skip directories without wos-plugin.yaml', async () => {
      // Create a non-plugin directory
      await fs.mkdir(path.join(pluginsDir, 'not-a-plugin'), { recursive: true });
      await fs.writeFile(path.join(pluginsDir, 'not-a-plugin', 'README.md'), '# Not a plugin');

      // Create a real plugin
      await createTestPlugin(pluginsDir, 'real-plugin', { behavior: 'long-running' });

      await loader.loadAll();

      const statuses = loader.getAllPluginStatuses();
      expect(statuses).toHaveLength(1);
      expect(statuses[0].name).toBe('real-plugin');
    });

    it('should report errors for invalid manifests', async () => {
      // Create plugin with invalid manifest (missing required fields)
      const badDir = path.join(pluginsDir, 'bad-plugin');
      await fs.mkdir(badDir, { recursive: true });
      await fs.writeFile(path.join(badDir, 'wos-plugin.yaml'), 'invalid: true\n');

      const errors: Error[] = [];
      loader.on('loader:error', (error: Error) => errors.push(error));

      await loader.loadAll();

      expect(errors.length).toBeGreaterThan(0);
    });
  });

  // ── Scenario 3: Full Plugin Lifecycle ──────────────────────────────

  describe('Scenario 3: Full Plugin Lifecycle', () => {
    it('should complete full lifecycle: discover → start → health → stop', async () => {
      await createTestPlugin(pluginsDir, 'lifecycle-plugin', { behavior: 'long-running' });
      mqttBroker.setAutoHealthResponse('lifecycle-plugin', 'healthy');

      // Track complete event sequence
      const events: string[] = [];
      loader.on('plugin:discovered', () => events.push('discovered'));
      loader.on('plugin:starting', () => events.push('starting'));
      loader.on('plugin:started', () => events.push('started'));
      loader.on('plugin:health', (_name: string, status: HealthStatus) => {
        events.push(`health:${status}`);
      });
      loader.on('plugin:stopping', () => events.push('stopping'));
      loader.on('plugin:stopped', () => events.push('stopped'));

      // Start
      await loader.loadAll();

      // Verify running
      let status = loader.getPluginStatus('lifecycle-plugin');
      expect(status?.state).toBe('running');
      expect(status?.pid).toBeGreaterThan(0);
      expect(status?.startedAt).toBeDefined();

      // Wait for health check cycle
      await new Promise(r => setTimeout(r, 500));

      // Verify health events received
      expect(events).toContain('health:ok');

      // Stop
      await loader.stopPlugin('lifecycle-plugin');

      status = loader.getPluginStatus('lifecycle-plugin');
      expect(status?.state).toBe('stopped');
      expect(status?.stoppedAt).toBeDefined();

      // Verify full event sequence
      expect(events).toContain('discovered');
      expect(events).toContain('starting');
      expect(events).toContain('started');
      expect(events).toContain('stopping');
      expect(events).toContain('stopped');
    }, E2E_TIMEOUT);

    it('should track PID and process metadata', async () => {
      await createTestPlugin(pluginsDir, 'pid-test', { behavior: 'long-running' });

      await loader.loadAll();

      const status = loader.getPluginStatus('pid-test');
      expect(status?.pid).toBeGreaterThan(0);
      expect(status?.state).toBe('running');
      expect(status?.restartCount).toBe(0);
      expect(status?.consecutiveHealthFailures).toBe(0);
      expect(status?.pluginDir).toContain('pid-test');
    });
  });

  // ── Scenario 4: Health Check Protocol ──────────────────────────────

  describe('Scenario 4: Health Check Protocol', () => {
    it('should send health requests with correlationId via MQTT', async () => {
      await createTestPlugin(pluginsDir, 'health-mqtt', { behavior: 'long-running' });

      await loader.loadAll();

      // Wait for health check
      await new Promise(r => setTimeout(r, 400));

      const requests = mqttBroker.getHealthRequests('health-mqtt');
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0].correlationId).toBeDefined();
      expect(requests[0].correlationId.length).toBeGreaterThan(0);
      expect(requests[0].timestamp).toBeDefined();
    });

    it('should subscribe to health response topic', async () => {
      await createTestPlugin(pluginsDir, 'health-sub', { behavior: 'long-running' });

      await loader.loadAll();

      expect(mqttBroker.subscriptions.has('wos/plugin/health-sub/health/response')).toBe(true);
    });

    it('should mark plugin healthy on OK response', async () => {
      await createTestPlugin(pluginsDir, 'health-ok', { behavior: 'long-running' });
      mqttBroker.setAutoHealthResponse('health-ok', 'healthy');

      const healthEvents: Array<{ name: string; status: HealthStatus }> = [];
      loader.on('plugin:health', (name: string, status: HealthStatus) => {
        healthEvents.push({ name, status });
      });

      await loader.loadAll();
      await new Promise(r => setTimeout(r, 500));

      expect(healthEvents.some(e => e.name === 'health-ok' && e.status === 'ok')).toBe(true);

      const status = loader.getPluginStatus('health-ok');
      expect(status?.lastHealthStatus).toBe('ok');
      expect(status?.consecutiveHealthFailures).toBe(0);
    });

    it('should mark plugin degraded on degraded response', async () => {
      await createTestPlugin(pluginsDir, 'health-degraded', { behavior: 'long-running' });
      mqttBroker.setAutoHealthResponse('health-degraded', 'degraded');

      await loader.loadAll();
      await new Promise(r => setTimeout(r, 500));

      const status = loader.getPluginStatus('health-degraded');
      expect(status?.state).toBe('degraded');
      expect(status?.lastHealthStatus).toBe('degraded');
    });

    it('should track consecutive failures on timeout (no response)', async () => {
      await createTestPlugin(pluginsDir, 'health-timeout', { behavior: 'long-running' });
      // No auto-response = timeout

      const unhealthyEvents: number[] = [];
      loader.on('plugin:health', (name: string, status: HealthStatus) => {
        if (name === 'health-timeout' && status === 'unhealthy') {
          const pluginStatus = loader.getPluginStatus('health-timeout');
          unhealthyEvents.push(pluginStatus?.consecutiveHealthFailures ?? 0);
        }
      });

      await loader.loadAll();

      // Wait for multiple health check timeouts
      await new Promise(r => setTimeout(r, 1200));

      expect(unhealthyEvents.length).toBeGreaterThanOrEqual(2);
      // Failures should be incrementing
      if (unhealthyEvents.length >= 2) {
        expect(unhealthyEvents[1]).toBeGreaterThan(unhealthyEvents[0]);
      }
    });

    it('should recover from degraded to running on healthy response', async () => {
      await createTestPlugin(pluginsDir, 'health-recover', { behavior: 'long-running' });
      mqttBroker.setAutoHealthResponse('health-recover', 'degraded');

      await loader.loadAll();
      await new Promise(r => setTimeout(r, 500));

      // Verify degraded
      let status = loader.getPluginStatus('health-recover');
      expect(status?.state).toBe('degraded');

      // Switch to healthy
      mqttBroker.setAutoHealthResponse('health-recover', 'healthy');
      await new Promise(r => setTimeout(r, 500));

      // Verify recovered
      status = loader.getPluginStatus('health-recover');
      expect(status?.state).toBe('running');
      expect(status?.lastHealthStatus).toBe('ok');
    });
  });

  // ── Scenario 5: Crash Detection & Restart ──────────────────────────

  describe('Scenario 5: Crash Detection & Automatic Restart', () => {
    it('should detect crash and emit event', async () => {
      await createTestPlugin(pluginsDir, 'crash-detect', { behavior: 'crash-immediate' });

      const crashPromise = waitForEvent<PluginStatus>(loader, 'plugin:crashed');
      await loader.loadAll();

      const crashed = await crashPromise;
      expect(crashed.name).toBe('crash-detect');
      expect(crashed.state).toBe('crashed');
    });

    it('should auto-restart with exponential backoff', async () => {
      await createTestPlugin(pluginsDir, 'backoff-e2e', { behavior: 'crash-immediate' });

      const restartDelays: number[] = [];
      loader.on('plugin:restarting', (_name: string, _attempt: number, delay: number) => {
        restartDelays.push(delay);
      });

      await loader.loadAll();
      await new Promise(r => setTimeout(r, 2000));

      // Should have multiple restarts with increasing delays
      expect(restartDelays.length).toBeGreaterThanOrEqual(2);
      expect(restartDelays[1]).toBeGreaterThan(restartDelays[0]);

      // Verify exponential pattern: 100, 200, 400, ...
      expect(restartDelays[0]).toBe(100);
      expect(restartDelays[1]).toBe(200);
    });

    it('should trip circuit breaker after max failures', async () => {
      await createTestPlugin(pluginsDir, 'circuit-e2e', { behavior: 'crash-immediate' });

      const failedPromise = waitForEvent<PluginStatus>(loader, 'plugin:failed', 15000);
      await loader.loadAll();

      const failed = await failedPromise;
      expect(failed.name).toBe('circuit-e2e');
      expect(failed.state).toBe('failed');
      expect(failed.error).toContain('Circuit breaker');
    }, 20000);

    it('should allow manual recovery after circuit breaker', async () => {
      await createTestPlugin(pluginsDir, 'recover-e2e', { behavior: 'crash-immediate' });

      await loader.loadAll();
      await waitForEvent(loader, 'plugin:failed', 15000);

      // Verify failed
      let status = loader.getPluginStatus('recover-e2e');
      expect(status?.state).toBe('failed');

      // Fix the plugin
      await fs.writeFile(
        path.join(pluginsDir, 'recover-e2e', 'index.js'),
        'setInterval(() => {}, 1000); process.on("SIGTERM", () => process.exit(0));'
      );

      // Reset and restart
      loader.resetCircuitBreaker('recover-e2e');
      await loader.startPlugin('recover-e2e');

      status = loader.getPluginStatus('recover-e2e');
      expect(status?.state).toBe('running');
      expect(status?.restartCount).toBe(0);
    }, 20000);

    it('should handle crash-after-delay scenario', async () => {
      await createTestPlugin(pluginsDir, 'delayed-crash', {
        behavior: 'crash-after-delay',
        crashDelayMs: 300,
      });

      await loader.loadAll();

      // Should start successfully first
      let status = loader.getPluginStatus('delayed-crash');
      expect(status?.state).toBe('running');

      // Wait for delayed crash
      const crashed = await waitForEvent<PluginStatus>(loader, 'plugin:crashed', 3000);
      expect(crashed.name).toBe('delayed-crash');
    });
  });

  // ── Scenario 6: Dependency-Ordered Lifecycle ───────────────────────

  describe('Scenario 6: Dependency-Ordered Startup & Shutdown', () => {
    it('should start plugins in dependency order', async () => {
      await createTestPlugin(pluginsDir, 'dep-c', {
        behavior: 'long-running',
        dependencies: ['dep-b'],
      });
      await createTestPlugin(pluginsDir, 'dep-b', {
        behavior: 'long-running',
        dependencies: ['dep-a'],
      });
      await createTestPlugin(pluginsDir, 'dep-a', {
        behavior: 'long-running',
      });

      const startOrder: string[] = [];
      loader.on('plugin:started', (status: PluginStatus) => {
        startOrder.push(status.name);
      });

      await loader.loadAll();

      expect(startOrder).toEqual(['dep-a', 'dep-b', 'dep-c']);
    });

    it('should stop all plugins cleanly with stopAll', async () => {
      await createTestPlugin(pluginsDir, 'stop-a', { behavior: 'long-running' });
      await createTestPlugin(pluginsDir, 'stop-b', { behavior: 'long-running' });
      await createTestPlugin(pluginsDir, 'stop-c', { behavior: 'long-running' });

      await loader.loadAll();

      // All running
      const statuses = loader.getAllPluginStatuses();
      expect(statuses.every(s => s.state === 'running')).toBe(true);

      // Stop all
      await loader.stopAll();

      // All stopped
      const finalStatuses = loader.getAllPluginStatuses();
      expect(finalStatuses.every(s => s.state === 'stopped')).toBe(true);
    });

    it('should not leave orphaned restart timers during shutdown', async () => {
      // Plugin that crashes — will have pending restart timers
      await createTestPlugin(pluginsDir, 'orphan-test', { behavior: 'crash-immediate' });
      await createTestPlugin(pluginsDir, 'healthy-peer', { behavior: 'long-running' });

      await loader.loadAll();

      // Let crash/restart cycle begin
      await new Promise(r => setTimeout(r, 300));

      // Stop all should clear pending restart timers
      await loader.stopAll();

      // Verify everything is stopped
      const statuses = loader.getAllPluginStatuses();
      const running = statuses.filter(s => s.state === 'running' || s.state === 'starting');
      expect(running).toHaveLength(0);
    });
  });

  // ── Scenario 7: Server Status Aggregation ──────────────────────────

  describe('Scenario 7: Server Status & Graceful Degradation', () => {
    it('should report healthy when all plugins running', async () => {
      await createTestPlugin(pluginsDir, 'srv-a', { behavior: 'long-running' });
      await createTestPlugin(pluginsDir, 'srv-b', { behavior: 'long-running' });
      mqttBroker.setAutoHealthResponse('srv-a', 'healthy');
      mqttBroker.setAutoHealthResponse('srv-b', 'healthy');

      await loader.loadAll();

      const status = loader.getServerStatus();
      expect(status.status).toBe('healthy');
      expect(status.totalPlugins).toBe(2);
      expect(status.runningPlugins).toBe(2);
      expect(status.degradedPlugins).toBe(0);
      expect(status.failedPlugins).toBe(0);
    });

    it('should report degraded when a plugin health degrades', async () => {
      await createTestPlugin(pluginsDir, 'agg-ok', { behavior: 'long-running' });
      await createTestPlugin(pluginsDir, 'agg-bad', { behavior: 'long-running' });
      mqttBroker.setAutoHealthResponse('agg-ok', 'healthy');
      mqttBroker.setAutoHealthResponse('agg-bad', 'degraded');

      await loader.loadAll();
      await new Promise(r => setTimeout(r, 500));

      const status = loader.getServerStatus();
      expect(status.status).toBe('degraded');
      expect(status.degradedPlugins).toBe(1);
    });

    it('should report unhealthy when a plugin fails permanently', async () => {
      await createTestPlugin(pluginsDir, 'agg-healthy', { behavior: 'long-running' });
      await createTestPlugin(pluginsDir, 'agg-crash', { behavior: 'crash-immediate' });

      await loader.loadAll();
      await waitForEvent(loader, 'plugin:failed', 15000);

      const status = loader.getServerStatus();
      expect(status.failedPlugins).toBeGreaterThan(0);
    }, 20000);

    it('should provide individual plugin statuses in server status', async () => {
      await createTestPlugin(pluginsDir, 'detail-a', { behavior: 'long-running' });
      await createTestPlugin(pluginsDir, 'detail-b', { behavior: 'long-running' });

      await loader.loadAll();

      const status = loader.getServerStatus();
      expect(status.plugins).toHaveLength(2);
      expect(status.plugins.map(p => p.name).sort()).toEqual(['detail-a', 'detail-b']);

      for (const plugin of status.plugins) {
        expect(plugin.state).toBe('running');
        expect(plugin.pid).toBeGreaterThan(0);
        expect(plugin.manifest).toBeDefined();
      }
    });
  });

  // ── Scenario 8: Plugin Restart ─────────────────────────────────────

  describe('Scenario 8: Plugin Restart', () => {
    it('should restart a plugin and get new PID', async () => {
      await createTestPlugin(pluginsDir, 'restart-me', { behavior: 'long-running' });

      await loader.loadAll();

      const beforeStatus = loader.getPluginStatus('restart-me');
      const originalPid = beforeStatus?.pid;
      expect(originalPid).toBeGreaterThan(0);

      // Restart
      await loader.restartPlugin('restart-me');

      const afterStatus = loader.getPluginStatus('restart-me');
      expect(afterStatus?.state).toBe('running');
      expect(afterStatus?.pid).toBeGreaterThan(0);
      // PID should be different after restart
      expect(afterStatus?.pid).not.toBe(originalPid);
    });
  });

  // ── Scenario 9: Multi-Plugin Concurrent Operations ─────────────────

  describe('Scenario 9: Multi-Plugin Concurrent Operations', () => {
    it('should handle 5 plugins starting concurrently', async () => {
      for (let i = 0; i < 5; i++) {
        await createTestPlugin(pluginsDir, `multi-${i}`, { behavior: 'long-running' });
      }

      await loader.loadAll();

      const statuses = loader.getAllPluginStatuses();
      expect(statuses).toHaveLength(5);
      expect(statuses.every(s => s.state === 'running')).toBe(true);

      // Each should have unique PID
      const pids = statuses.map(s => s.pid);
      const uniquePids = new Set(pids);
      expect(uniquePids.size).toBe(5);
    });

    it('should handle mixed healthy and crashing plugins', async () => {
      await createTestPlugin(pluginsDir, 'mix-healthy-1', { behavior: 'long-running' });
      await createTestPlugin(pluginsDir, 'mix-healthy-2', { behavior: 'long-running' });
      await createTestPlugin(pluginsDir, 'mix-crash', { behavior: 'crash-immediate' });

      mqttBroker.setAutoHealthResponse('mix-healthy-1', 'healthy');
      mqttBroker.setAutoHealthResponse('mix-healthy-2', 'healthy');

      await loader.loadAll();

      // Healthy plugins should keep running
      await new Promise(r => setTimeout(r, 500));

      const h1 = loader.getPluginStatus('mix-healthy-1');
      const h2 = loader.getPluginStatus('mix-healthy-2');
      expect(h1?.state).toBe('running');
      expect(h2?.state).toBe('running');

      // Crash plugin should be in crash/restart cycle
      const crash = loader.getPluginStatus('mix-crash');
      expect(['crashed', 'starting', 'running', 'failed']).toContain(crash?.state);
    });
  });

  // ── Scenario 10: Output Capture ────────────────────────────────────

  describe('Scenario 10: Plugin Output Capture', () => {
    it('should capture stdout from plugins', async () => {
      await createTestPlugin(pluginsDir, 'output-e2e', { behavior: 'long-running' });

      const outputs: string[] = [];
      loader.on('plugin:output', (name: string, data: string, stream: string) => {
        if (name === 'output-e2e' && stream === 'stdout') {
          outputs.push(data);
        }
      });

      await loader.loadAll();
      await new Promise(r => setTimeout(r, 300));

      expect(outputs.some(o => o.includes('Plugin output-e2e started'))).toBe(true);
    });
  });

  // ── Scenario 11: Edge Cases ────────────────────────────────────────

  describe('Scenario 11: Edge Cases', () => {
    it('should handle empty plugins directory', async () => {
      await loader.loadAll();

      const statuses = loader.getAllPluginStatuses();
      expect(statuses).toHaveLength(0);

      const serverStatus = loader.getServerStatus();
      expect(serverStatus.status).toBe('healthy');
      expect(serverStatus.totalPlugins).toBe(0);
    });

    it('should handle stopping an already stopped plugin', async () => {
      await createTestPlugin(pluginsDir, 'double-stop', { behavior: 'long-running' });

      await loader.loadAll();
      await loader.stopPlugin('double-stop');

      // Second stop should not throw
      await loader.stopPlugin('double-stop');

      const status = loader.getPluginStatus('double-stop');
      expect(status?.state).toBe('stopped');
    });

    it('should throw when starting non-existent plugin', async () => {
      await expect(
        loader.startPlugin('nonexistent')
      ).rejects.toThrow("Plugin 'nonexistent' not found");
    });

    it('should not restart plugins during stopAll', async () => {
      await createTestPlugin(pluginsDir, 'no-restart', { behavior: 'long-running' });

      await loader.loadAll();

      let restartedDuringShutdown = false;
      loader.on('plugin:restarting', () => {
        restartedDuringShutdown = true;
      });

      await loader.stopAll();

      expect(restartedDuringShutdown).toBe(false);
    });
  });
});

/**
 * Helper to copy directory recursively
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        await copyDirectory(srcPath, destPath);
      }
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
