/**
 * Plugin Loader Integration Tests
 *
 * Epic 1: Plugin Process Isolation
 *
 * End-to-end integration tests that exercise the full plugin lifecycle:
 * - Plugin discovery and startup
 * - Health check protocol via MQTT
 * - Crash detection and automatic restart with backoff
 * - Graceful shutdown
 * - Graceful degradation status
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { PluginLoader } from './plugin-loader.js';
import { MqttClient, createHealthResponse } from './health-monitor.js';
import type { PluginStatus, HealthStatus } from './types.js';

/**
 * Mock MQTT client that simulates broker behavior
 */
class MockMqttBroker extends EventEmitter implements MqttClient {
  connected = true;
  subscriptions: Set<string> = new Set();
  publishedMessages: Array<{ topic: string; message: string; timestamp: number }> = [];

  async publish(topic: string, message: string): Promise<void> {
    this.publishedMessages.push({ topic, message, timestamp: Date.now() });

    // If this is a health request, we can auto-respond for testing
    if (topic.includes('/health/request')) {
      // Extract plugin name from topic
      const match = topic.match(/wos\/plugin\/([^/]+)\/health\/request/);
      if (match) {
        const pluginName = match[1];
        // Check if we should auto-respond
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

  // Auto-respond configuration
  private autoRespondHealth: Map<string, 'healthy' | 'degraded' | 'unhealthy'> = new Map();

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
 * Helper to create a test plugin with customizable behavior
 */
async function createTestPlugin(
  pluginsDir: string,
  name: string,
  options: {
    behavior?: 'long-running' | 'crash-immediate' | 'crash-after-delay' | 'exit-clean';
    crashDelayMs?: number;
    dependencies?: string[];
  } = {}
): Promise<string> {
  const pluginDir = path.join(pluginsDir, name);
  await fs.mkdir(pluginDir, { recursive: true });

  // Create manifest
  const manifest = {
    name,
    version: '1.0.0',
    runtime: 'node',
    entrypoint: 'index.js',
    ...(options.dependencies && { dependencies: options.dependencies }),
  };
  await fs.writeFile(
    path.join(pluginDir, 'wos-plugin.yaml'),
    Object.entries(manifest)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? '\n  - ' + v.join('\n  - ') : v}`)
      .join('\n')
  );

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
        // Long-running plugin
        console.log('Plugin ${name} started');
        setInterval(() => {
          console.log('Plugin ${name} heartbeat');
        }, 1000);

        // Handle graceful shutdown
        process.on('SIGTERM', () => {
          console.log('Plugin ${name} received SIGTERM, shutting down...');
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
 * Wait for a condition with polling
 */
async function waitForCondition(
  condition: () => boolean,
  timeoutMs = 5000,
  intervalMs = 50
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Timeout waiting for condition');
}

describe('Plugin Loader Integration Tests', () => {
  let testDir: string;
  let pluginsDir: string;
  let loader: PluginLoader;
  let mqttBroker: MockMqttBroker;

  beforeEach(async () => {
    // Create test environment
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-integration-'));
    pluginsDir = path.join(testDir, 'plugins');
    await fs.mkdir(pluginsDir);

    // Create loader with fast health check intervals for testing
    loader = new PluginLoader({
      serverDir: testDir,
      mqttHost: 'localhost',
      mqttPort: 1883,
      healthCheck: {
        intervalMs: 500,      // Fast interval for testing
        timeoutMs: 200,       // Fast timeout
        failureThreshold: 3,
        gracefulShutdownMs: 1000,
      },
      restartPolicy: {
        initialBackoffMs: 100,    // Fast backoff for testing
        maxBackoffMs: 1000,
        backoffMultiplier: 2,
        stableThresholdMs: 2000,
        circuitBreakerThreshold: 5,
        circuitBreakerWindowMs: 10000,
      },
    });

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

  describe('Full Plugin Lifecycle', () => {
    it('should discover, start, and stop a plugin', async () => {
      // Create a test plugin
      await createTestPlugin(pluginsDir, 'lifecycle-test', { behavior: 'long-running' });

      // Track events
      const events: string[] = [];
      loader.on('plugin:discovered', () => events.push('discovered'));
      loader.on('plugin:starting', () => events.push('starting'));
      loader.on('plugin:started', () => events.push('started'));
      loader.on('plugin:stopping', () => events.push('stopping'));
      loader.on('plugin:stopped', () => events.push('stopped'));

      // Load plugins
      await loader.loadAll();

      // Verify startup sequence
      expect(events).toContain('discovered');
      expect(events).toContain('starting');
      expect(events).toContain('started');

      // Verify running state
      const status = loader.getPluginStatus('lifecycle-test');
      expect(status?.state).toBe('running');
      expect(status?.pid).toBeGreaterThan(0);

      // Stop plugin
      await loader.stopPlugin('lifecycle-test');

      // Verify shutdown
      expect(events).toContain('stopping');
      expect(events).toContain('stopped');

      const finalStatus = loader.getPluginStatus('lifecycle-test');
      expect(finalStatus?.state).toBe('stopped');
    });

    it('should start plugins in dependency order', async () => {
      // Create plugins with dependencies: C depends on B, B depends on A
      await createTestPlugin(pluginsDir, 'plugin-c', {
        behavior: 'long-running',
        dependencies: ['plugin-b'],
      });
      await createTestPlugin(pluginsDir, 'plugin-b', {
        behavior: 'long-running',
        dependencies: ['plugin-a'],
      });
      await createTestPlugin(pluginsDir, 'plugin-a', {
        behavior: 'long-running',
      });

      // Track start order
      const startOrder: string[] = [];
      loader.on('plugin:started', (status: PluginStatus) => {
        startOrder.push(status.name);
      });

      await loader.loadAll();

      // Verify order: A, B, C
      expect(startOrder).toEqual(['plugin-a', 'plugin-b', 'plugin-c']);
    });
  });

  describe('Health Check Integration', () => {
    it('should send health check requests via MQTT', async () => {
      await createTestPlugin(pluginsDir, 'health-test', { behavior: 'long-running' });

      await loader.loadAll();

      // Wait for health check request
      await new Promise(r => setTimeout(r, 600));

      const requests = mqttBroker.getHealthRequests('health-test');
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0].correlationId).toBeDefined();
    });

    it('should handle healthy response and emit event', async () => {
      await createTestPlugin(pluginsDir, 'health-ok-test', { behavior: 'long-running' });
      mqttBroker.setAutoHealthResponse('health-ok-test', 'healthy');

      const healthEvents: Array<{ name: string; status: HealthStatus }> = [];
      loader.on('plugin:health', (name: string, status: HealthStatus) => {
        healthEvents.push({ name, status });
      });

      await loader.loadAll();

      // Wait for health check cycle
      await new Promise(r => setTimeout(r, 700));

      expect(healthEvents.some(e => e.name === 'health-ok-test' && e.status === 'ok')).toBe(true);
    });

    it('should mark plugin as degraded on degraded health response', async () => {
      await createTestPlugin(pluginsDir, 'degraded-test', { behavior: 'long-running' });
      mqttBroker.setAutoHealthResponse('degraded-test', 'degraded');

      await loader.loadAll();

      // Wait for health check to process
      await new Promise(r => setTimeout(r, 700));

      const status = loader.getPluginStatus('degraded-test');
      expect(status?.state).toBe('degraded');
      expect(status?.lastHealthStatus).toBe('degraded');
    });
  });

  describe('Crash Detection and Restart', () => {
    it('should detect crash and emit event', async () => {
      await createTestPlugin(pluginsDir, 'crash-detect-test', { behavior: 'crash-immediate' });

      const crashPromise = waitForEvent<PluginStatus>(loader, 'plugin:crashed');

      await loader.loadAll();

      const crashedStatus = await crashPromise;
      expect(crashedStatus.name).toBe('crash-detect-test');
      expect(crashedStatus.state).toBe('crashed');
    });

    it('should automatically restart crashed plugin', async () => {
      await createTestPlugin(pluginsDir, 'restart-test', { behavior: 'crash-immediate' });

      // Capture restart event data
      const restartData = await new Promise<{ name: string; attempt: number; delay: number }>(
        (resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
          loader.once('plugin:restarting', (name: string, attempt: number, delay: number) => {
            clearTimeout(timeout);
            resolve({ name, attempt, delay });
          });
          loader.loadAll();
        }
      );

      expect(restartData.name).toBe('restart-test');
      expect(restartData.attempt).toBe(1);
      expect(restartData.delay).toBe(100); // Initial backoff
    });

    it('should apply exponential backoff on repeated crashes', async () => {
      await createTestPlugin(pluginsDir, 'backoff-test', { behavior: 'crash-immediate' });

      const restartDelays: number[] = [];
      loader.on('plugin:restarting', (_name: string, _attempt: number, delay: number) => {
        restartDelays.push(delay);
      });

      await loader.loadAll();

      // Wait for multiple restart attempts
      await new Promise(r => setTimeout(r, 2000));

      // Verify exponential backoff: 100, 200, 400, ...
      expect(restartDelays.length).toBeGreaterThanOrEqual(2);
      if (restartDelays.length >= 2) {
        expect(restartDelays[1]).toBeGreaterThan(restartDelays[0]);
      }
    });

    it('should trip circuit breaker after too many failures', async () => {
      await createTestPlugin(pluginsDir, 'circuit-test', { behavior: 'crash-immediate' });

      const failedPromise = waitForEvent<PluginStatus>(
        loader,
        'plugin:failed',
        15000
      );

      await loader.loadAll();

      const failedStatus = await failedPromise;
      expect(failedStatus.name).toBe('circuit-test');
      expect(failedStatus.state).toBe('failed');
      expect(failedStatus.error).toContain('Circuit breaker');
    }, 20000);
  });

  describe('Graceful Degradation', () => {
    it('should report healthy server status when all plugins running', async () => {
      await createTestPlugin(pluginsDir, 'healthy-1', { behavior: 'long-running' });
      await createTestPlugin(pluginsDir, 'healthy-2', { behavior: 'long-running' });

      await loader.loadAll();

      const serverStatus = loader.getServerStatus();
      expect(serverStatus.status).toBe('healthy');
      expect(serverStatus.totalPlugins).toBe(2);
      expect(serverStatus.runningPlugins).toBe(2);
      expect(serverStatus.failedPlugins).toBe(0);
    });

    it('should report degraded status when plugin is degraded', async () => {
      await createTestPlugin(pluginsDir, 'ok-plugin', { behavior: 'long-running' });
      await createTestPlugin(pluginsDir, 'degraded-plugin', { behavior: 'long-running' });

      mqttBroker.setAutoHealthResponse('ok-plugin', 'healthy');
      mqttBroker.setAutoHealthResponse('degraded-plugin', 'degraded');

      await loader.loadAll();

      // Wait for health checks
      await new Promise(r => setTimeout(r, 700));

      const serverStatus = loader.getServerStatus();
      expect(serverStatus.status).toBe('degraded');
      expect(serverStatus.degradedPlugins).toBe(1);
    });

    it('should report unhealthy status when plugin fails', async () => {
      await createTestPlugin(pluginsDir, 'good-plugin', { behavior: 'long-running' });
      await createTestPlugin(pluginsDir, 'bad-plugin', { behavior: 'crash-immediate' });

      await loader.loadAll();

      // Wait for crash and circuit breaker
      await waitForEvent(loader, 'plugin:failed', 15000);

      const serverStatus = loader.getServerStatus();
      expect(serverStatus.failedPlugins).toBeGreaterThan(0);
    }, 20000);
  });

  describe('Manual Recovery', () => {
    it('should allow manual circuit breaker reset', async () => {
      await createTestPlugin(pluginsDir, 'recovery-test', { behavior: 'crash-immediate' });

      await loader.loadAll();

      // Wait for circuit breaker to trip
      await waitForEvent(loader, 'plugin:failed', 15000);

      let status = loader.getPluginStatus('recovery-test');
      expect(status?.state).toBe('failed');

      // Reset circuit breaker
      loader.resetCircuitBreaker('recovery-test');

      status = loader.getPluginStatus('recovery-test');
      expect(status?.state).toBe('pending');
      expect(status?.restartCount).toBe(0);
    }, 20000);

    it('should allow manual restart after failure', async () => {
      // Create plugin that crashes once then runs
      const pluginDir = await createTestPlugin(pluginsDir, 'manual-restart', {
        behavior: 'crash-immediate',
      });

      await loader.loadAll();

      // Wait for failure
      await waitForEvent(loader, 'plugin:failed', 15000);

      // Fix the plugin (replace with long-running version)
      await fs.writeFile(
        path.join(pluginDir, 'index.js'),
        'setInterval(() => {}, 1000);'
      );

      // Reset and restart
      loader.resetCircuitBreaker('manual-restart');
      await loader.startPlugin('manual-restart');

      const status = loader.getPluginStatus('manual-restart');
      expect(status?.state).toBe('running');
    }, 20000);
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple plugins starting concurrently', async () => {
      // Create 5 plugins
      for (let i = 0; i < 5; i++) {
        await createTestPlugin(pluginsDir, `concurrent-${i}`, { behavior: 'long-running' });
      }

      await loader.loadAll();

      const statuses = loader.getAllPluginStatuses();
      expect(statuses).toHaveLength(5);
      expect(statuses.every(s => s.state === 'running')).toBe(true);
    });

    it('should handle stopAll gracefully', async () => {
      for (let i = 0; i < 3; i++) {
        await createTestPlugin(pluginsDir, `stopall-${i}`, { behavior: 'long-running' });
      }

      await loader.loadAll();

      // All running
      expect(loader.getAllPluginStatuses().every(s => s.state === 'running')).toBe(true);

      // Stop all
      await loader.stopAll();

      // All stopped
      expect(loader.getAllPluginStatuses().every(s => s.state === 'stopped')).toBe(true);
    });
  });

  describe('Output Capture', () => {
    it('should capture plugin stdout output', async () => {
      await createTestPlugin(pluginsDir, 'output-test', { behavior: 'long-running' });

      const outputs: string[] = [];
      loader.on('plugin:output', (name: string, data: string, stream: string) => {
        if (name === 'output-test' && stream === 'stdout') {
          outputs.push(data);
        }
      });

      await loader.loadAll();

      // Wait for output
      await new Promise(r => setTimeout(r, 500));

      expect(outputs.some(o => o.includes('Plugin output-test started'))).toBe(true);
    });
  });
});
