// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// ── Mock SDK ────────────────────────────────────────────────────────────────
vi.mock('@worldos/plugin-sdk', () => {
  class WOSPlugin {
    get name() { return 'container-manager'; }
    get version() { return '1.0.0'; }
  }
  return { WOSPlugin };
});

// ── Mock Docker Client ──────────────────────────────────────────────────────
// Stateful mock that tracks created/started/stopped containers
const dockerState = {
  containers: new Map<string, { id: string; name: string; running: boolean; image: string; ports: any }>(),
  images: new Map<string, { id: string; tags: string[]; size: number; created: string }>(),
  available: true,
  nextId: 1,
  reset() {
    this.containers.clear();
    this.images.clear();
    this.available = true;
    this.nextId = 1;
    this.images.set('test:latest', { id: 'sha256:abc123', tags: ['test:latest'], size: 100_000_000, created: '2026-01-01T00:00:00Z' });
    this.images.set('other:latest', { id: 'sha256:def456', tags: ['other:latest'], size: 50_000_000, created: '2026-01-15T00:00:00Z' });
  },
};

class MockDockerApiError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}

vi.mock('../src/docker-client.js', () => ({
  DockerClient: vi.fn().mockImplementation(() => ({
    ping: vi.fn().mockImplementation(async () => {
      if (!dockerState.available) throw new Error('connect ENOENT');
      return true;
    }),
    listContainers: vi.fn().mockImplementation(async () => {
      return Array.from(dockerState.containers.values()).map((c) => ({
        Id: c.id, Names: [`/${c.name}`], State: c.running ? 'running' : 'exited',
        Status: c.running ? 'Up 1 hour' : 'Exited (0)', Image: c.image,
        Ports: [],
      }));
    }),
    createContainer: vi.fn().mockImplementation(async (config: any) => {
      if (!dockerState.available) throw new Error('connect ENOENT');
      const id = `docker-${dockerState.nextId++}`;
      dockerState.containers.set(config.name, {
        id, name: config.name, running: false, image: config.image,
        ports: config.ports,
      });
      return { id };
    }),
    inspectContainer: vi.fn().mockImplementation(async (nameOrId: string) => {
      if (!dockerState.available) throw new MockDockerApiError(500, 'connect ENOENT');
      const c = dockerState.containers.get(nameOrId)
        ?? Array.from(dockerState.containers.values()).find((x) => x.id === nameOrId);
      if (!c) throw new MockDockerApiError(404, 'No such container');
      const portBindings: Record<string, Array<{ HostPort: string }> | null> = {};
      if (c.ports) {
        for (const p of c.ports) {
          portBindings[`${p.container}/tcp`] = [{ HostPort: String(p.host) }];
        }
      }
      return {
        Id: c.id, Name: `/${c.name}`,
        State: { Status: c.running ? 'running' : 'exited', Running: c.running, Pid: c.running ? 42 : 0, ExitCode: 0 },
        NetworkSettings: { Ports: portBindings },
        Config: { Env: [], Image: c.image },
        HostConfig: { RestartPolicy: { Name: 'unless-stopped' } },
      };
    }),
    startContainer: vi.fn().mockImplementation(async (id: string) => {
      const c = Array.from(dockerState.containers.values()).find((x) => x.id === id);
      if (c) c.running = true;
    }),
    stopContainer: vi.fn().mockImplementation(async (id: string) => {
      const c = Array.from(dockerState.containers.values()).find((x) => x.id === id);
      if (c) c.running = false;
    }),
    restartContainer: vi.fn().mockImplementation(async (id: string) => {
      const c = Array.from(dockerState.containers.values()).find((x) => x.id === id);
      if (c) c.running = true;
    }),
    removeContainer: vi.fn().mockImplementation(async (id: string) => {
      for (const [name, c] of dockerState.containers) {
        if (c.id === id) { dockerState.containers.delete(name); return; }
      }
    }),
    getContainerLogs: vi.fn().mockResolvedValue('2026-01-01 container started\n2026-01-01 listening on port 5525'),
    imageExists: vi.fn().mockImplementation(async (image: string) => {
      return dockerState.images.has(image);
    }),
    pullImage: vi.fn().mockImplementation(async (image: string, tag?: string) => {
      const fullImage = tag ? `${image}:${tag}` : image;
      dockerState.images.set(fullImage, {
        id: `sha256:pulled-${dockerState.nextId++}`,
        tags: [fullImage], size: 75_000_000, created: new Date().toISOString(),
      });
    }),
    listImages: vi.fn().mockImplementation(async () => {
      return Array.from(dockerState.images.values());
    }),
  })),
  DockerApiError: MockDockerApiError,
}));

const { ContainerManagerPlugin } = await import('../src/index.js');
import type { ContainerConfig } from '../src/types.js';

// ── Test Helpers ────────────────────────────────────────────────────────────

function makeTestConfig(): ContainerConfig {
  return {
    defaults: {
      network: 'wos-network',
      volumeBasePath: './data',
      portRangeStart: 32768,
      portRangeEnd: 60999,
    },
    services: [
      {
        id: 'websvc',
        name: 'Web Service',
        image: 'test:latest',
        ports: [{ container: 5525, host: 'dynamic' as any }],
        environment: { NODE_ENV: 'production' },
        restart: 'unless-stopped',
        instances: [
          { instanceId: 'instance-0' },
        ],
      },
      {
        id: 'worker',
        name: 'Worker Service',
        image: 'test:latest',
        ports: [{ container: 8080, host: 'dynamic' as any }],
        environment: { ROLE: 'worker' },
        restart: 'always',
        instances: [],
      },
    ],
  };
}

function createMockContext(tmpDir: string) {
  const handlers = new Map<string, (msg: any) => void>();
  const published: Array<{ topic: string; payload: any }> = [];
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    config: {},
    mqtt: {
      subscribeWithHandler: vi.fn((topic: string, handler: any) => {
        handlers.set(topic, handler);
        return Promise.resolve();
      }),
      publishRaw: vi.fn((topic: string, payload: string) => {
        published.push({ topic, payload: JSON.parse(payload) });
      }),
    },
    manifest: { name: 'container-manager' },
    serverDir: tmpDir,
    _handlers: handlers,
    _published: published,
  };
}

async function sendMessage(ctx: any, topic: string, payload: any): Promise<any> {
  const handler = ctx._handlers.get(topic);
  if (!handler) throw new Error(`No handler for topic: ${topic}`);
  await handler({ topic, payload, timestamp: Date.now() });
}

/** Simulate identity plugin auth response for a pending validation request */
function simulateAuth(ctx: any, options: { valid: boolean; userId?: string; role?: string; token?: string }) {
  // Find the most recent token/validate publish
  const authRequests = ctx._published.filter((p: any) => p.topic === 'wos/identity/token/validate');
  if (authRequests.length === 0) return;
  const lastReq = authRequests[authRequests.length - 1];
  const authHandler = ctx._handlers.get('wos/identity/token/validate/response');
  if (authHandler) {
    authHandler({
      topic: 'wos/identity/token/validate/response',
      payload: {
        correlationId: lastReq.payload.correlationId,
        valid: options.valid,
        userId: options.userId ?? 'admin-user',
        role: options.role ?? 'admin',
        token: options.token ?? lastReq.payload.token,
      },
    });
  }
}

/** Send an authed MQTT request: fires the message, immediately responds to the auth challenge */
async function sendAuthedMessage(ctx: any, topic: string, payload: any): Promise<any> {
  const promise = sendMessage(ctx, topic, {
    ...payload,
    token: payload.token ?? 'valid-token',
  });
  // The handler calls validateToken which publishes to identity — respond immediately
  simulateAuth(ctx, { valid: true, userId: 'admin-user', role: 'admin', token: payload.token ?? 'valid-token' });
  await promise;

  // Return the response published to topic/response
  const responseTopic = `${topic}/response`;
  const responses = ctx._published.filter((p: any) => p.topic === responseTopic);
  return responses.length > 0 ? responses[responses.length - 1].payload : null;
}

function getLifecycleEvents(ctx: any, event?: string): any[] {
  const prefix = 'wos/container-manager/lifecycle/';
  return ctx._published.filter((p: any) =>
    event ? p.topic === `${prefix}${event}` : p.topic.startsWith(prefix),
  ).map((p: any) => p.payload);
}

// ── E2E Tests ───────────────────────────────────────────────────────────────

describe('Container Manager E2E', () => {
  let plugin: InstanceType<typeof ContainerManagerPlugin>;
  let tmpDir: string;
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(async () => {
    dockerState.reset();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cm-e2e-'));
    const configDir = path.join(tmpDir, 'config');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'containers.json'), JSON.stringify(makeTestConfig(), null, 2));

    ctx = createMockContext(tmpDir);
    plugin = new ContainerManagerPlugin();
    await plugin.onStart(ctx as any);
  });

  afterEach(async () => {
    try { await plugin.onStop(); } catch { /* ignore */ }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Full Lifecycle Flow ─────────────────────────────────────────────────

  describe('full instance lifecycle', () => {
    it('should create → start → status → stop → remove an instance', async () => {
      // 1. List services — should have 2 services
      const listResult = await sendAuthedMessage(ctx, 'wos/container-manager/service/list', {
        correlationId: 'list-1',
      });
      expect(listResult.services).toHaveLength(2);
      expect(listResult.services[0].id).toBe('websvc');
      expect(listResult.services[1].id).toBe('worker');

      // 2. Create instance on worker service
      const createResult = await sendAuthedMessage(ctx, 'wos/container-manager/instance/create', {
        correlationId: 'create-1',
        serviceId: 'worker',
      });
      expect(createResult.status).toBe('created');
      expect(createResult.serviceId).toBe('worker');
      expect(createResult.instanceId).toBe('instance-0');
      expect(createResult.containerId).toBeDefined();

      // Lifecycle event published
      const createEvents = getLifecycleEvents(ctx, 'created');
      expect(createEvents.length).toBeGreaterThan(0);
      expect(createEvents[createEvents.length - 1].serviceId).toBe('worker');

      // 3. Start instance
      const startResult = await sendAuthedMessage(ctx, 'wos/container-manager/instance/start', {
        correlationId: 'start-1',
        serviceId: 'worker',
        instanceId: 'instance-0',
      });
      expect(startResult.status).toBe('started');

      const startEvents = getLifecycleEvents(ctx, 'started');
      expect(startEvents.length).toBeGreaterThan(0);

      // 4. Check status — should be running
      const statusResult = await sendAuthedMessage(ctx, 'wos/container-manager/instance/status', {
        correlationId: 'status-1',
        serviceId: 'worker',
        instanceId: 'instance-0',
      });
      expect(statusResult.running).toBe(true);
      expect(statusResult.exists).toBe(true);
      expect(statusResult.status).toBe('running');

      // 5. Stop instance
      const stopResult = await sendAuthedMessage(ctx, 'wos/container-manager/instance/stop', {
        correlationId: 'stop-1',
        serviceId: 'worker',
        instanceId: 'instance-0',
      });
      expect(stopResult.status).toBe('stopped');

      const stopEvents = getLifecycleEvents(ctx, 'stopped');
      expect(stopEvents.length).toBeGreaterThan(0);

      // 6. Check status again — should be stopped
      const statusResult2 = await sendAuthedMessage(ctx, 'wos/container-manager/instance/status', {
        correlationId: 'status-2',
        serviceId: 'worker',
        instanceId: 'instance-0',
      });
      expect(statusResult2.running).toBe(false);

      // 7. Remove instance
      const removeResult = await sendAuthedMessage(ctx, 'wos/container-manager/instance/remove', {
        correlationId: 'remove-1',
        serviceId: 'worker',
        instanceId: 'instance-0',
      });
      expect(removeResult.status).toBe('removed');

      const removeEvents = getLifecycleEvents(ctx, 'removed');
      expect(removeEvents.length).toBeGreaterThan(0);

      // 8. Status of removed instance — should be not_found
      const statusResult3 = await sendAuthedMessage(ctx, 'wos/container-manager/instance/status', {
        correlationId: 'status-3',
        serviceId: 'worker',
        instanceId: 'instance-0',
      });
      expect(statusResult3.exists).toBe(false);
      expect(statusResult3.status).toBe('not_found');
    });
  });

  // ── Scaling ──────────────────────────────────────────────────────────────

  describe('service scaling', () => {
    it('should scale up from 0 to 3 instances then down to 1', async () => {
      // Scale up worker from 0 to 3
      const scaleUp = await sendAuthedMessage(ctx, 'wos/container-manager/service/scale', {
        correlationId: 'scale-up',
        serviceId: 'worker',
        count: 3,
      });
      expect(scaleUp.targetCount).toBe(3);
      const created = scaleUp.instances.filter((i: any) => i.action === 'created');
      expect(created).toHaveLength(3);

      // Verify lifecycle events
      const scaledEvents = getLifecycleEvents(ctx, 'scaled');
      expect(scaledEvents.length).toBeGreaterThan(0);

      // Verify all 3 containers exist in Docker state
      expect(dockerState.containers.size).toBe(3);

      // List instances to confirm
      const listResult = await sendAuthedMessage(ctx, 'wos/container-manager/instance/list', {
        correlationId: 'list-inst',
        serviceId: 'worker',
      });
      expect(listResult.instances).toHaveLength(3);

      // Scale down to 1
      const scaleDown = await sendAuthedMessage(ctx, 'wos/container-manager/service/scale', {
        correlationId: 'scale-down',
        serviceId: 'worker',
        count: 1,
      });
      expect(scaleDown.targetCount).toBe(1);
      const removed = scaleDown.instances.filter((i: any) => i.action === 'removed');
      expect(removed).toHaveLength(2);
      const unchanged = scaleDown.instances.filter((i: any) => i.action === 'unchanged');
      expect(unchanged).toHaveLength(1);

      // Verify Docker state has 1 container for worker (removed containers cleaned up)
      const listResult2 = await sendAuthedMessage(ctx, 'wos/container-manager/instance/list', {
        correlationId: 'list-inst-2',
        serviceId: 'worker',
      });
      expect(listResult2.instances).toHaveLength(1);
    });

    it('should reject negative scale count', async () => {
      const result = await sendAuthedMessage(ctx, 'wos/container-manager/service/scale', {
        correlationId: 'scale-neg',
        serviceId: 'worker',
        count: -1,
      });
      expect(result.error).toBe('invalid_count');
    });

    it('should reject fractional scale count', async () => {
      const result = await sendAuthedMessage(ctx, 'wos/container-manager/service/scale', {
        correlationId: 'scale-frac',
        serviceId: 'worker',
        count: 3.7,
      });
      expect(result.error).toBe('invalid_count');
    });

    it('should reject scale count exceeding max', async () => {
      const result = await sendAuthedMessage(ctx, 'wos/container-manager/service/scale', {
        correlationId: 'scale-max',
        serviceId: 'worker',
        count: 999,
      });
      expect(result.error).toBe('max_instances_exceeded');
    });

    it('should scale unchanged when target equals current count', async () => {
      // websvc has 1 instance already
      const result = await sendAuthedMessage(ctx, 'wos/container-manager/service/scale', {
        correlationId: 'scale-noop',
        serviceId: 'websvc',
        count: 1,
      });
      expect(result.instances).toHaveLength(1);
      expect(result.instances[0].action).toBe('unchanged');
    });
  });

  // ── Image Operations ─────────────────────────────────────────────────────

  describe('image operations', () => {
    it('should check if an image exists', async () => {
      const result = await sendAuthedMessage(ctx, 'wos/container-manager/image/check', {
        correlationId: 'img-check',
        image: 'test:latest',
      });
      expect(result.image).toBe('test:latest');
      expect(result.exists).toBe(true);
    });

    it('should report missing image', async () => {
      const result = await sendAuthedMessage(ctx, 'wos/container-manager/image/check', {
        correlationId: 'img-check-miss',
        image: 'nonexistent:v1',
      });
      expect(result.exists).toBe(false);
    });

    it('should pull an image', async () => {
      const result = await sendAuthedMessage(ctx, 'wos/container-manager/image/pull', {
        correlationId: 'img-pull',
        image: 'newimage',
        tag: 'v2',
      });
      expect(result.status).toBe('pulled');
      expect(dockerState.images.has('newimage:v2')).toBe(true);
    });

    it('should list images', async () => {
      const result = await sendAuthedMessage(ctx, 'wos/container-manager/image/list', {
        correlationId: 'img-list',
      });
      expect(result.images.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Bulk Operations ──────────────────────────────────────────────────────

  describe('bulk operations', () => {
    it('should start all instances for a service', async () => {
      const result = await sendAuthedMessage(ctx, 'wos/container-manager/bulk/start', {
        correlationId: 'bulk-start',
        serviceId: 'websvc',
      });
      expect(result.results).toBeDefined();
      expect(result.results.length).toBeGreaterThanOrEqual(1);
    });

    it('should stop all instances for a service', async () => {
      // First start them
      await sendAuthedMessage(ctx, 'wos/container-manager/bulk/start', {
        correlationId: 'pre-stop',
        serviceId: 'websvc',
      });

      const result = await sendAuthedMessage(ctx, 'wos/container-manager/bulk/stop', {
        correlationId: 'bulk-stop',
        serviceId: 'websvc',
      });
      expect(result.results).toBeDefined();
    });
  });

  // ── Service Get ───────────────────────────────────────────────────────────

  describe('service get', () => {
    it('should get service details', async () => {
      const result = await sendAuthedMessage(ctx, 'wos/container-manager/service/get', {
        correlationId: 'svc-get',
        serviceId: 'websvc',
      });
      expect(result.id).toBe('websvc');
      expect(result.name).toBe('Web Service');
      expect(result.image).toBe('test:latest');
      expect(result.instanceCount).toBe(1);
    });

    it('should return error for nonexistent service', async () => {
      const result = await sendAuthedMessage(ctx, 'wos/container-manager/service/get', {
        correlationId: 'svc-get-miss',
        serviceId: 'nonexistent',
      });
      expect(result.error).toBe('service_not_found');
    });
  });

  // ── Logs ──────────────────────────────────────────────────────────────────

  describe('instance logs', () => {
    it('should retrieve container logs', async () => {
      // Create and start an instance so it exists in Docker
      await sendAuthedMessage(ctx, 'wos/container-manager/instance/create', {
        correlationId: 'log-create',
        serviceId: 'worker',
      });
      await sendAuthedMessage(ctx, 'wos/container-manager/instance/start', {
        correlationId: 'log-start',
        serviceId: 'worker',
        instanceId: 'instance-0',
      });

      const result = await sendAuthedMessage(ctx, 'wos/container-manager/instance/logs', {
        correlationId: 'logs-1',
        serviceId: 'worker',
        instanceId: 'instance-0',
        tail: 100,
      });
      expect(result.logs).toContain('container started');
      expect(result.serviceId).toBe('worker');
      expect(result.instanceId).toBe('instance-0');
    });
  });

  // ── Restart ───────────────────────────────────────────────────────────────

  describe('instance restart', () => {
    it('should restart a running instance', async () => {
      await sendAuthedMessage(ctx, 'wos/container-manager/instance/create', {
        correlationId: 'rst-create',
        serviceId: 'worker',
      });
      await sendAuthedMessage(ctx, 'wos/container-manager/instance/start', {
        correlationId: 'rst-start',
        serviceId: 'worker',
        instanceId: 'instance-0',
      });

      const result = await sendAuthedMessage(ctx, 'wos/container-manager/instance/restart', {
        correlationId: 'rst-1',
        serviceId: 'worker',
        instanceId: 'instance-0',
      });
      expect(result.status).toBe('restarted');
    });
  });

  // ── Auth Flows ────────────────────────────────────────────────────────────

  describe('auth flows', () => {
    it('should reject requests with no token', async () => {
      await sendMessage(ctx, 'wos/container-manager/service/list', {
        correlationId: 'no-token',
      });
      const responses = ctx._published.filter((p) =>
        p.topic === 'wos/container-manager/service/list/response',
      );
      expect(responses.length).toBeGreaterThan(0);
      expect(responses[responses.length - 1].payload.error).toBe('unauthorized');
    });

    it('should reject invalid tokens', async () => {
      const promise = sendMessage(ctx, 'wos/container-manager/service/list', {
        correlationId: 'bad-token',
        token: 'bad-token',
      });
      // Simulate identity plugin rejecting
      simulateAuth(ctx, { valid: false, token: 'bad-token' });
      await promise;

      const responses = ctx._published.filter((p) =>
        p.topic === 'wos/container-manager/service/list/response',
      );
      expect(responses.length).toBeGreaterThan(0);
      expect(responses[responses.length - 1].payload.error).toBe('unauthorized');
    });

    it('should use cached token for repeated requests', async () => {
      // First request — triggers auth validation
      await sendAuthedMessage(ctx, 'wos/container-manager/service/list', {
        correlationId: 'cache-1',
        token: 'cached-token',
      });

      const authPublishes1 = ctx._published.filter((p) =>
        p.topic === 'wos/identity/token/validate',
      );
      const countBefore = authPublishes1.length;

      // Second request with same token — should use cache, no new auth publish
      await sendAuthedMessage(ctx, 'wos/container-manager/service/list', {
        correlationId: 'cache-2',
        token: 'cached-token',
      });

      const authPublishes2 = ctx._published.filter((p) =>
        p.topic === 'wos/identity/token/validate',
      );
      // Should NOT have published a new auth request (token is cached)
      expect(authPublishes2.length).toBe(countBefore);
    });

    it('should handle auth timeout', async () => {
      vi.useFakeTimers();

      const promise = sendMessage(ctx, 'wos/container-manager/service/list', {
        correlationId: 'timeout-test',
        token: 'slow-token',
      });
      // Don't simulate auth response — let it timeout
      await vi.advanceTimersByTimeAsync(2100);
      await promise;

      const responses = ctx._published.filter((p) =>
        p.topic === 'wos/container-manager/service/list/response',
      );
      expect(responses.length).toBeGreaterThan(0);
      expect(responses[responses.length - 1].payload.error).toBe('unauthorized');

      vi.useRealTimers();
    });
  });

  // ── Error Handling ────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('should reject missing required fields with clean error', async () => {
      // instance/start requires serviceId and instanceId
      await sendMessage(ctx, 'wos/container-manager/instance/start', {
        correlationId: 'missing-fields',
        token: 'valid-token',
      });
      const responses = ctx._published.filter((p) =>
        p.topic === 'wos/container-manager/instance/start/response',
      );
      expect(responses.length).toBeGreaterThan(0);
      expect(responses[responses.length - 1].payload.error).toBe('missing_serviceId');
    });

    it('should reject instanceId with path traversal characters', async () => {
      const result = await sendAuthedMessage(ctx, 'wos/container-manager/instance/create', {
        correlationId: 'traversal',
        serviceId: 'worker',
        instanceId: '../../etc',
      });
      expect(result.error).toBe('invalid_instance_id');
    });

    it('should reject instanceId with special characters', async () => {
      const result = await sendAuthedMessage(ctx, 'wos/container-manager/instance/create', {
        correlationId: 'special-chars',
        serviceId: 'worker',
        instanceId: 'foo bar',
      });
      expect(result.error).toBe('invalid_instance_id');
    });

    it('should handle Docker unavailable during operations', async () => {
      // Create an instance first while Docker is available
      await sendAuthedMessage(ctx, 'wos/container-manager/instance/create', {
        correlationId: 'err-create',
        serviceId: 'worker',
      });

      // Make Docker unavailable
      dockerState.available = false;

      // Try to start — should return error
      const result = await sendAuthedMessage(ctx, 'wos/container-manager/instance/start', {
        correlationId: 'err-start',
        serviceId: 'worker',
        instanceId: 'instance-0',
      });
      expect(result.error).toBeDefined();
    });

    it('should handle instance not found on stop', async () => {
      const result = await sendAuthedMessage(ctx, 'wos/container-manager/instance/stop', {
        correlationId: 'err-stop',
        serviceId: 'websvc',
        instanceId: 'nonexistent',
      });
      expect(result.error).toBeDefined();
    });

    it('should handle service not found on scale', async () => {
      const result = await sendAuthedMessage(ctx, 'wos/container-manager/service/scale', {
        correlationId: 'err-scale',
        serviceId: 'nonexistent-svc',
        count: 3,
      });
      expect(result.error).toBeDefined();
    });

    it('should return health as degraded when Docker is down', async () => {
      dockerState.available = false;
      const health = await plugin.onHealthCheck();
      expect(['degraded', 'unhealthy']).toContain(health.status);
    });
  });

  // ── Config Persistence ────────────────────────────────────────────────────

  describe('config persistence', () => {
    it('should persist config changes after create and remove', async () => {
      // Create an instance
      await sendAuthedMessage(ctx, 'wos/container-manager/instance/create', {
        correlationId: 'persist-create',
        serviceId: 'worker',
      });

      // Read config file — should have the new instance
      const configStr = await fs.readFile(path.join(tmpDir, 'config', 'containers.json'), 'utf-8');
      const config = JSON.parse(configStr);
      const workerSvc = config.services.find((s: any) => s.id === 'worker');
      expect(workerSvc.instances).toHaveLength(1);
      expect(workerSvc.instances[0].instanceId).toBe('instance-0');

      // Remove the instance
      await sendAuthedMessage(ctx, 'wos/container-manager/instance/remove', {
        correlationId: 'persist-remove',
        serviceId: 'worker',
        instanceId: 'instance-0',
      });

      // Re-read — instance should be gone
      const configStr2 = await fs.readFile(path.join(tmpDir, 'config', 'containers.json'), 'utf-8');
      const config2 = JSON.parse(configStr2);
      const workerSvc2 = config2.services.find((s: any) => s.id === 'worker');
      expect(workerSvc2.instances).toHaveLength(0);
    });
  });

  // ── Health Check ──────────────────────────────────────────────────────────

  describe('health check', () => {
    it('should report healthy when Docker is available', async () => {
      const health = await plugin.onHealthCheck();
      expect(['ok', 'degraded']).toContain(health.status);
      expect(health.details).toBeDefined();
    });

    it('should report unhealthy before start', async () => {
      const freshPlugin = new ContainerManagerPlugin();
      const health = await freshPlugin.onHealthCheck();
      expect(health.status).toBe('unhealthy');
      expect(health.details.initialized).toBe(false);
    });
  });

  // ── Lifecycle Events ──────────────────────────────────────────────────────

  describe('lifecycle events comprehensive', () => {
    it('should emit timestamp on all lifecycle events', async () => {
      await sendAuthedMessage(ctx, 'wos/container-manager/instance/create', {
        correlationId: 'ts-create',
        serviceId: 'worker',
      });

      const events = getLifecycleEvents(ctx);
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect(e.timestamp).toBeDefined();
        expect(new Date(e.timestamp).getTime()).not.toBeNaN();
      }
    });
  });
});
