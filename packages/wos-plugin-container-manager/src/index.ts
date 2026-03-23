// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

/**
 * WorldOS Container Manager Plugin
 *
 * Manages Docker container lifecycle via the Docker Engine REST API.
 * Provides service config, instance CRUD, scaling, port allocation,
 * and status monitoring through MQTT topics.
 */

import * as path from 'path';
import * as crypto from 'crypto';
import { WOSPlugin } from '@worldos/plugin-sdk';
import { DockerClient } from './docker-client.js';
import { ConfigLoader } from './config-loader.js';
import { PortAllocator } from './port-allocator.js';
import { InstanceManager } from './instance-manager.js';
import { collectHealthStatus } from './health.js';
import type { InstanceConfig } from './types.js';

interface PluginConfig {
  config_path?: string;
  docker_socket?: string;
}

export class ContainerManagerPlugin extends WOSPlugin {
  private _ctx: any;
  private _pluginConfig!: PluginConfig;
  private dockerClient?: DockerClient;
  private configLoader?: ConfigLoader;
  private portAllocator?: PortAllocator;
  private instanceManager?: InstanceManager;
  private dockerAvailable = false;

  // Auth
  private tokenCache = new Map<string, { decoded: any; expiresAt: number }>();
  private pendingAuth = new Map<string, { resolve: (v: any) => void; timer: ReturnType<typeof setTimeout>; token: string }>();
  private cacheCleanupTimer?: ReturnType<typeof setInterval>;

  async onStart(context: any): Promise<void> {
    this._ctx = context;
    this._pluginConfig = (context.config ?? {}) as PluginConfig;

    const serverDir = context.serverDir ?? process.cwd();
    const configPath = path.resolve(serverDir, this._pluginConfig.config_path ?? './config/containers.json');

    // 1. Docker client
    this.dockerClient = new DockerClient(
      this._pluginConfig.docker_socket ? { socketPath: this._pluginConfig.docker_socket } : undefined,
    );

    try {
      this.dockerAvailable = await this.dockerClient.ping();
      if (!this.dockerAvailable) {
        this._ctx.logger.warn('Docker is not available — starting in degraded mode');
      }
    } catch {
      this.dockerAvailable = false;
      this._ctx.logger.warn('Docker ping failed — starting in degraded mode');
    }

    // 2. Config loader
    this.configLoader = new ConfigLoader(configPath);
    await this.configLoader.load();

    // 3. Port allocator
    const defaults = this.configLoader.getDefaults();
    this.portAllocator = new PortAllocator(defaults.portRangeStart, defaults.portRangeEnd);
    const savedAllocations = this.configLoader.getPortAllocations();
    this.portAllocator.restore(savedAllocations);

    // 4. Instance manager
    this.instanceManager = new InstanceManager(
      this.dockerClient, this.configLoader, this.portAllocator, this._ctx.logger,
    );

    // 5. Auth cache cleanup
    this.cacheCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, val] of this.tokenCache) {
        if (val.expiresAt < now) this.tokenCache.delete(key);
      }
    }, 60_000);

    // 6. Subscribe to MQTT topics
    this.subscribeHandlers();

    this._ctx.logger.info(`Container manager started (Docker ${this.dockerAvailable ? 'available' : 'unavailable'})`);
  }

  async onStop(): Promise<void> {
    if (this.cacheCleanupTimer) {
      clearInterval(this.cacheCleanupTimer);
      this.cacheCleanupTimer = undefined;
    }
    this.tokenCache.clear();
    for (const pending of this.pendingAuth.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingAuth.clear();
    // Does NOT stop running Docker containers — they continue independently
    this.dockerClient = undefined;
    this.configLoader = undefined;
    this.portAllocator = undefined;
    this.instanceManager = undefined;
  }

  async onHealthCheck(): Promise<any> {
    if (!this.dockerClient || !this.configLoader || !this.instanceManager) {
      return { status: 'unhealthy', details: { initialized: false, error: 'Not started' } };
    }
    return collectHealthStatus(this.dockerClient, this.configLoader, this.instanceManager);
  }

  // ── Auth ─────────────────────────────────────────────────────────

  private async validateToken(token: string): Promise<{ valid: boolean; userId?: string; role?: string }> {
    const cached = this.tokenCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return { valid: true, ...cached.decoded };
    }

    const correlationId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingAuth.delete(correlationId);
        resolve({ valid: false });
      }, 2000);

      this.pendingAuth.set(correlationId, { resolve, timer, token });

      this._ctx.mqtt.publishRaw('wos/identity/token/validate', JSON.stringify({
        correlationId, token,
      }));
    });
  }

  private async withAuth(msg: any, requiredRole: string, handler: (userId: string, role: string) => void | Promise<void>): Promise<void> {
    const token = msg.payload?.token;
    if (!token) {
      this.respond(msg.topic, { correlationId: msg.payload?.correlationId, error: 'unauthorized' });
      return;
    }
    const auth = await this.validateToken(token);
    if (!auth.valid) {
      this.respond(msg.topic, { correlationId: msg.payload?.correlationId, error: 'unauthorized' });
      return;
    }
    if (requiredRole === 'admin' && auth.role !== 'admin') {
      this.respond(msg.topic, { correlationId: msg.payload?.correlationId, error: 'forbidden' });
      return;
    }
    try {
      await handler(auth.userId!, auth.role!);
    } catch (err: any) {
      this.respond(msg.topic, { correlationId: msg.payload?.correlationId, error: err.message ?? 'internal_error' });
    }
  }

  // ── MQTT ─────────────────────────────────────────────────────────

  private respond(topic: string, payload: any): void {
    this._ctx.mqtt.publishRaw(`${topic}/response`, JSON.stringify(payload));
  }

  private publishLifecycle(event: string, data: any): void {
    this._ctx.mqtt.publishRaw(
      `wos/container-manager/lifecycle/${event}`,
      JSON.stringify({ ...data, timestamp: new Date().toISOString() }),
    );
  }

  private subscribeHandlers(): void {
    const mqtt = this._ctx.mqtt;

    // Auth response
    mqtt.subscribeWithHandler('wos/identity/token/validate/response', (msg: any) => {
      const p = msg.payload;
      const pending = this.pendingAuth.get(p.correlationId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingAuth.delete(p.correlationId);
        // Verify response token matches what we sent to prevent cache poisoning
        if (p.valid && p.token === pending.token) {
          this.tokenCache.set(pending.token, {
            decoded: { userId: p.userId, role: p.role },
            expiresAt: Date.now() + 30_000,
          });
          pending.resolve({ valid: true, userId: p.userId, role: p.role });
        } else if (p.valid && p.token !== pending.token) {
          // Token mismatch — reject as invalid (potential spoofing)
          pending.resolve({ valid: false });
        } else {
          pending.resolve({ valid: false, userId: p.userId, role: p.role });
        }
      }
    });

    // Service operations
    mqtt.subscribeWithHandler('wos/container-manager/service/list', (msg: any) => this.handleServiceList(msg));
    mqtt.subscribeWithHandler('wos/container-manager/service/get', (msg: any) => this.handleServiceGet(msg));
    mqtt.subscribeWithHandler('wos/container-manager/service/scale', (msg: any) => this.handleServiceScale(msg));

    // Instance lifecycle
    mqtt.subscribeWithHandler('wos/container-manager/instance/create', (msg: any) => this.handleInstanceCreate(msg));
    mqtt.subscribeWithHandler('wos/container-manager/instance/start', (msg: any) => this.handleInstanceStart(msg));
    mqtt.subscribeWithHandler('wos/container-manager/instance/stop', (msg: any) => this.handleInstanceStop(msg));
    mqtt.subscribeWithHandler('wos/container-manager/instance/restart', (msg: any) => this.handleInstanceRestart(msg));
    mqtt.subscribeWithHandler('wos/container-manager/instance/remove', (msg: any) => this.handleInstanceRemove(msg));
    mqtt.subscribeWithHandler('wos/container-manager/instance/status', (msg: any) => this.handleInstanceStatus(msg));
    mqtt.subscribeWithHandler('wos/container-manager/instance/list', (msg: any) => this.handleInstanceList(msg));
    mqtt.subscribeWithHandler('wos/container-manager/instance/logs', (msg: any) => this.handleInstanceLogs(msg));

    // Image operations
    mqtt.subscribeWithHandler('wos/container-manager/image/check', (msg: any) => this.handleImageCheck(msg));
    mqtt.subscribeWithHandler('wos/container-manager/image/pull', (msg: any) => this.handleImagePull(msg));
    mqtt.subscribeWithHandler('wos/container-manager/image/list', (msg: any) => this.handleImageList(msg));

    // Bulk operations
    mqtt.subscribeWithHandler('wos/container-manager/bulk/start', (msg: any) => this.handleBulkStart(msg));
    mqtt.subscribeWithHandler('wos/container-manager/bulk/stop', (msg: any) => this.handleBulkStop(msg));
  }

  // ── Handlers ─────────────────────────────────────────────────────

  private async handleServiceList(msg: any): Promise<void> {
    await this.withAuth(msg, 'admin', async () => {
      const services = this.configLoader!.getServices();
      const result = await Promise.all(services.map(async (svc) => {
        const statuses = await this.instanceManager!.listInstances(svc.id);
        return {
          id: svc.id,
          name: svc.name,
          image: svc.image,
          instanceCount: statuses.length,
          runningCount: statuses.filter((s) => s.running).length,
          instances: statuses,
        };
      }));
      this.respond(msg.topic, { correlationId: msg.payload.correlationId, services: result });
    });
  }

  private async handleServiceGet(msg: any): Promise<void> {
    if (!this.requireFields(msg, 'serviceId')) return;
    await this.withAuth(msg, 'admin', async () => {
      const { serviceId } = msg.payload;
      const svc = this.configLoader!.getService(serviceId);
      if (!svc) {
        this.respond(msg.topic, { correlationId: msg.payload.correlationId, error: 'service_not_found' });
        return;
      }
      const statuses = await this.instanceManager!.listInstances(serviceId);
      this.respond(msg.topic, {
        correlationId: msg.payload.correlationId,
        id: svc.id, name: svc.name, image: svc.image,
        instanceCount: statuses.length,
        runningCount: statuses.filter((s) => s.running).length,
        instances: statuses,
      });
    });
  }

  private static MAX_INSTANCES = 100;

  private async handleServiceScale(msg: any): Promise<void> {
    if (!this.requireFields(msg, 'serviceId')) return;
    await this.withAuth(msg, 'admin', async () => {
      const { serviceId, count } = msg.payload;
      if (typeof count !== 'number' || !Number.isFinite(count) || !Number.isInteger(count) || count < 0) {
        this.respond(msg.topic, { correlationId: msg.payload.correlationId, error: 'invalid_count' });
        return;
      }
      if (count > ContainerManagerPlugin.MAX_INSTANCES) {
        this.respond(msg.topic, { correlationId: msg.payload.correlationId, error: 'max_instances_exceeded', max: ContainerManagerPlugin.MAX_INSTANCES });
        return;
      }
      const result = await this.instanceManager!.scaleService(serviceId, count);
      this.publishLifecycle('scaled', {
        serviceId, previousCount: result.instances.filter((i) => i.action === 'unchanged').length,
        targetCount: count, instances: result.instances.map((i) => ({ instanceId: i.instanceId, action: i.action })),
      });
      this.respond(msg.topic, { correlationId: msg.payload.correlationId, ...result });
    });
  }

  private requireFields(msg: any, ...fields: string[]): boolean {
    for (const field of fields) {
      if (msg.payload?.[field] == null || msg.payload[field] === '') {
        this.respond(msg.topic, { correlationId: msg.payload?.correlationId, error: `missing_${field}` });
        return false;
      }
    }
    return true;
  }

  private validateInstanceId(id: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(id);
  }

  private async handleInstanceCreate(msg: any): Promise<void> {
    if (!this.requireFields(msg, 'serviceId')) return;
    await this.withAuth(msg, 'admin', async () => {
      const { serviceId, instanceId, environment, ports, volumes } = msg.payload;
      if (!this.configLoader!.getService(serviceId)) {
        this.respond(msg.topic, { correlationId: msg.payload.correlationId, error: 'service_not_found' });
        return;
      }
      const resolvedId = instanceId ?? this.generateInstanceId(serviceId);
      if (!this.validateInstanceId(resolvedId)) {
        this.respond(msg.topic, { correlationId: msg.payload.correlationId, error: 'invalid_instance_id' });
        return;
      }
      const input: Partial<InstanceConfig> & { instanceId: string } = {
        instanceId: resolvedId,
        environment, ports, volumes,
      };
      const result = await this.instanceManager!.createInstance(serviceId, input);
      this.publishLifecycle('created', {
        serviceId, instanceId: result.instanceId, containerName: result.containerName,
        containerId: result.containerId, ports: result.ports,
      });
      this.respond(msg.topic, { correlationId: msg.payload.correlationId, ...result });
    });
  }

  private async handleInstanceStart(msg: any): Promise<void> {
    if (!this.requireFields(msg, 'serviceId', 'instanceId')) return;
    await this.withAuth(msg, 'admin', async () => {
      const { serviceId, instanceId } = msg.payload;
      const result = await this.instanceManager!.startInstance(serviceId, instanceId);
      this.publishLifecycle('started', {
        serviceId, instanceId, containerName: result.containerName,
        containerId: result.containerId, ports: result.ports,
      });
      this.respond(msg.topic, { correlationId: msg.payload.correlationId, ...result });
    });
  }

  private async handleInstanceStop(msg: any): Promise<void> {
    if (!this.requireFields(msg, 'serviceId', 'instanceId')) return;
    await this.withAuth(msg, 'admin', async () => {
      const { serviceId, instanceId, timeout } = msg.payload;
      const result = await this.instanceManager!.stopInstance(serviceId, instanceId, timeout);
      this.publishLifecycle('stopped', { serviceId, instanceId, containerName: result.containerName });
      this.respond(msg.topic, { correlationId: msg.payload.correlationId, ...result });
    });
  }

  private async handleInstanceRestart(msg: any): Promise<void> {
    if (!this.requireFields(msg, 'serviceId', 'instanceId')) return;
    await this.withAuth(msg, 'admin', async () => {
      const { serviceId, instanceId } = msg.payload;
      const result = await this.instanceManager!.restartInstance(serviceId, instanceId);
      this.respond(msg.topic, { correlationId: msg.payload.correlationId, ...result });
    });
  }

  private async handleInstanceRemove(msg: any): Promise<void> {
    if (!this.requireFields(msg, 'serviceId', 'instanceId')) return;
    await this.withAuth(msg, 'admin', async () => {
      const { serviceId, instanceId, force, removeVolumes } = msg.payload;
      const result = await this.instanceManager!.removeInstance(serviceId, instanceId, { force: force ?? true, removeVolumes: removeVolumes ?? false });
      this.publishLifecycle('removed', { serviceId, instanceId, containerName: result.containerName });
      this.respond(msg.topic, { correlationId: msg.payload.correlationId, ...result });
    });
  }

  private async handleInstanceStatus(msg: any): Promise<void> {
    if (!this.requireFields(msg, 'serviceId', 'instanceId')) return;
    await this.withAuth(msg, 'admin', async () => {
      const { serviceId, instanceId } = msg.payload;
      const status = await this.instanceManager!.getStatus(serviceId, instanceId);
      this.respond(msg.topic, { correlationId: msg.payload.correlationId, ...status });
    });
  }

  private async handleInstanceList(msg: any): Promise<void> {
    if (!this.requireFields(msg, 'serviceId')) return;
    await this.withAuth(msg, 'admin', async () => {
      const { serviceId } = msg.payload;
      const instances = await this.instanceManager!.listInstances(serviceId);
      this.respond(msg.topic, { correlationId: msg.payload.correlationId, serviceId, instances });
    });
  }

  private async handleInstanceLogs(msg: any): Promise<void> {
    if (!this.requireFields(msg, 'serviceId', 'instanceId')) return;
    await this.withAuth(msg, 'admin', async () => {
      const { serviceId, instanceId, tail, since } = msg.payload;
      const logs = await this.instanceManager!.getLogs(serviceId, instanceId, tail, since);
      this.respond(msg.topic, { correlationId: msg.payload.correlationId, serviceId, instanceId, logs });
    });
  }

  private async handleImageCheck(msg: any): Promise<void> {
    if (!this.requireFields(msg, 'image')) return;
    await this.withAuth(msg, 'admin', async () => {
      const { image } = msg.payload;
      const exists = await this.dockerClient!.imageExists(image);
      this.respond(msg.topic, { correlationId: msg.payload.correlationId, image, exists });
    });
  }

  private async handleImagePull(msg: any): Promise<void> {
    if (!this.requireFields(msg, 'image')) return;
    await this.withAuth(msg, 'admin', async () => {
      const { image, tag } = msg.payload;
      await this.dockerClient!.pullImage(image, tag);
      this.respond(msg.topic, { correlationId: msg.payload.correlationId, image, status: 'pulled' });
    });
  }

  private async handleImageList(msg: any): Promise<void> {
    await this.withAuth(msg, 'admin', async () => {
      const images = await this.dockerClient!.listImages();
      this.respond(msg.topic, { correlationId: msg.payload.correlationId, images });
    });
  }

  private async handleBulkStart(msg: any): Promise<void> {
    await this.withAuth(msg, 'admin', async () => {
      const { serviceId } = msg.payload;
      const results = await this.instanceManager!.startAll(serviceId);
      this.respond(msg.topic, { correlationId: msg.payload.correlationId, results });
    });
  }

  private async handleBulkStop(msg: any): Promise<void> {
    await this.withAuth(msg, 'admin', async () => {
      const { serviceId, timeout } = msg.payload;
      const results = await this.instanceManager!.stopAll(serviceId, timeout);
      this.respond(msg.topic, { correlationId: msg.payload.correlationId, results });
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private generateInstanceId(serviceId: string): string {
    const instances = this.configLoader!.getInstances(serviceId);
    let maxIdx = 0;
    for (const inst of instances) {
      const match = inst.instanceId.match(/^instance-(\d+)$/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n >= maxIdx) maxIdx = n + 1;
      }
    }
    return `instance-${maxIdx}`;
  }
}

export const plugin = new ContainerManagerPlugin();
export * from './types.js';
