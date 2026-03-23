// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

/**
 * WorldOS World Manager Plugin
 *
 * Manages a single world per server instance: world metadata/settings,
 * entity instance CRUD, entity templates, terrain queries, and
 * lifecycle events.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import Database from 'better-sqlite3';
import { WOSPlugin } from '@worldos/plugin-sdk';
import { WorldStore } from './world-store.js';
import { EntityStore } from './entity-store.js';
import { TemplateLoader } from './template-loader.js';
import { TerrainService } from './terrain-service.js';
import { checkWorldPermission, checkEntityPermission } from './permissions.js';
import { collectHealthStatus } from './health.js';
import type { WorldType, InitWorldInput } from './types.js';

interface PluginConfig {
  world_name?: string;
  world_type?: string;
  world_owner?: string;
  default_template?: string;
  templates_path?: string;
  data_dir?: string;
}

export class WorldManagerPlugin extends WOSPlugin {
  private _ctx: any;
  private _pluginConfig!: PluginConfig;
  private db?: Database.Database;
  private worldStore?: WorldStore;
  private entityStore?: EntityStore;
  private templateLoader?: TemplateLoader;
  private terrainService?: TerrainService;
  private tokenCache = new Map<string, { decoded: any; expiresAt: number }>();
  private cacheCleanupTimer?: ReturnType<typeof setInterval>;

  async onStart(context: any): Promise<void> {
    this._ctx = context;
    this._pluginConfig = (context.config ?? {}) as PluginConfig;

    const serverDir = context.serverDir ?? process.cwd();
    const dataDir = path.resolve(serverDir, this._pluginConfig.data_dir ?? './data');
    const dbPath = path.join(dataDir, 'world.db');

    // Ensure data directory exists
    await fs.mkdir(dataDir, { recursive: true });

    // Open database
    this.db = new Database(dbPath);
    this.worldStore = new WorldStore(this.db);
    this.entityStore = new EntityStore(this.db);

    // Template loader
    this.templateLoader = new TemplateLoader(
      serverDir,
      this._pluginConfig.templates_path ?? './templates',
    );
    await this.templateLoader.loadConfig();

    // Auto-initialize world if not initialized
    const wasInitialized = this.worldStore.isInitialized();
    if (!wasInitialized) {
      const input: InitWorldInput = {
        name: this._pluginConfig.world_name ?? 'My World',
        owner: this._pluginConfig.world_owner ?? 'system',
        type: (this._pluginConfig.world_type ?? 'space') as WorldType,
      };

      // Apply default template if configured
      if (this._pluginConfig.default_template) {
        input.template = this._pluginConfig.default_template;
        const data = await this.templateLoader.loadTemplateData(this._pluginConfig.default_template);
        if (data) {
          input.name = data.metadata.name ?? input.name;
          input.description = data.metadata.description;
          input.type = data.metadata.type ?? input.type;
          input.settings = data.metadata.settings;
        }
      }

      this.worldStore.initWorld(input);

      this._ctx.mqtt.publishRaw(
        'wos/world-manager/lifecycle/initialized',
        { name: input.name, type: input.type, timestamp: new Date().toISOString() },
      );
    }

    // Terrain service
    const meta = this.worldStore.getMetadata();
    this.terrainService = new TerrainService(
      this._ctx.mqtt,
      (meta?.type ?? 'space') as WorldType,
    );

    // Token cache cleanup
    this.cacheCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, val] of this.tokenCache) {
        if (val.expiresAt < now) this.tokenCache.delete(key);
      }
    }, 60_000);

    // Subscribe to MQTT topics
    this.subscribeHandlers();

    this._ctx.logger.info(`World manager started: ${meta?.name ?? 'uninitialized'}`);
  }

  async onStop(): Promise<void> {
    if (this.cacheCleanupTimer) {
      clearInterval(this.cacheCleanupTimer);
      this.cacheCleanupTimer = undefined;
    }
    this.tokenCache.clear();
    if (this.db) {
      this.db.close();
      this.db = undefined;
    }
    this.worldStore = undefined;
    this.entityStore = undefined;
  }

  onHealthCheck(): any {
    if (!this.worldStore || !this.entityStore) {
      return { status: 'unhealthy', details: { initialized: false, error: 'Not started' } };
    }
    return collectHealthStatus(this.worldStore, this.entityStore);
  }

  private subscribeHandlers(): void {
    const mqtt = this._ctx.mqtt;

    // World operations
    mqtt.subscribeWithHandler('wos/world-manager/world/get', (msg: any) => this.handleWorldGet(msg));
    mqtt.subscribeWithHandler('wos/world-manager/world/update', (msg: any) => this.handleWorldUpdate(msg));
    mqtt.subscribeWithHandler('wos/world-manager/world/init', (msg: any) => this.handleWorldInit(msg));
    mqtt.subscribeWithHandler('wos/world-manager/world/reset', (msg: any) => this.handleWorldReset(msg));

    // Entity CRUD
    mqtt.subscribeWithHandler('wos/world-manager/entity/create', (msg: any) => this.handleEntityCreate(msg));
    mqtt.subscribeWithHandler('wos/world-manager/entity/query', (msg: any) => this.handleEntityQuery(msg));
    mqtt.subscribeWithHandler('wos/world-manager/entity/get', (msg: any) => this.handleEntityGet(msg));
    mqtt.subscribeWithHandler('wos/world-manager/entity/update', (msg: any) => this.handleEntityUpdate(msg));
    mqtt.subscribeWithHandler('wos/world-manager/entity/delete', (msg: any) => this.handleEntityDelete(msg));

    // Templates
    mqtt.subscribeWithHandler('wos/world-manager/template/list', (msg: any) => this.handleTemplateList(msg));
    mqtt.subscribeWithHandler('wos/world-manager/template/get', (msg: any) => this.handleTemplateGet(msg));
    mqtt.subscribeWithHandler('wos/world-manager/template/create', (msg: any) => this.handleTemplateCreate(msg));
    mqtt.subscribeWithHandler('wos/world-manager/template/delete', (msg: any) => this.handleTemplateDelete(msg));
    mqtt.subscribeWithHandler('wos/world-manager/template/instantiate', (msg: any) => this.handleTemplateInstantiate(msg));

    // Terrain
    mqtt.subscribeWithHandler('wos/world-manager/terrain/height', (msg: any) => this.handleTerrain(msg, 'getHeight'));
    mqtt.subscribeWithHandler('wos/world-manager/terrain/heights', (msg: any) => this.handleTerrain(msg, 'getHeights'));
    mqtt.subscribeWithHandler('wos/world-manager/terrain/biome', (msg: any) => this.handleTerrain(msg, 'getBiome'));
    mqtt.subscribeWithHandler('wos/world-manager/terrain/normal', (msg: any) => this.handleTerrain(msg, 'getNormal'));
    mqtt.subscribeWithHandler('wos/world-manager/terrain/region', (msg: any) => this.handleTerrain(msg, 'queryRegion'));
    mqtt.subscribeWithHandler('wos/world-manager/terrain/geo-to-world', (msg: any) => this.handleTerrain(msg, 'geoToWorld'));
    mqtt.subscribeWithHandler('wos/world-manager/terrain/world-to-geo', (msg: any) => this.handleTerrain(msg, 'worldToGeo'));

    // World templates
    mqtt.subscribeWithHandler('wos/world-manager/world-template/list', (msg: any) => this.handleWorldTemplateList(msg));
    mqtt.subscribeWithHandler('wos/world-manager/world-template/get', (msg: any) => this.handleWorldTemplateGet(msg));
    mqtt.subscribeWithHandler('wos/world-manager/world-template/validate', (msg: any) => this.handleWorldTemplateValidate(msg));

    // Admin panel queries
    mqtt.subscribeWithHandler('wos/world-manager/admin/stats', (msg: any) => this.handleAdminStats(msg));

    // Auth response
    mqtt.subscribeWithHandler('wos/identity/token/validate/response', (msg: any) => {
      // Handled inline by pending auth requests
    });
  }

  private respond(topic: string, payload: any): void {
    this._ctx.mqtt.publishRaw(`${topic}/response`, payload);
  }

  // ── Admin Handlers ─────────────────────────────────────────────

  private handleAdminStats(msg: any): void {
    const p = msg.payload;
    const meta = this.worldStore!.getMetadata();
    const entities = this.entityStore!.queryEntities({});
    const templates = this.entityStore!.listTemplates({});
    this._ctx.mqtt.publishRaw('wos/world-manager/admin/stats/response', {
      correlationId: p?.correlationId,
      world: meta ? { name: meta.name, type: meta.type, owner: meta.owner } : null,
      entityCount: entities.total,
      templateCount: templates.total,
      entities: entities.entities.slice(0, 50),
      templates: templates.templates,
    });
  }

  // ── World Handlers ─────────────────────────────────────────────

  private handleWorldGet(msg: any): void {
    const p = msg.payload;
    const meta = this.worldStore!.getMetadata();
    if (!meta) {
      this.respond('wos/world-manager/world/get', { correlationId: p.correlationId, error: 'not_initialized' });
      return;
    }
    this.respond('wos/world-manager/world/get', { correlationId: p.correlationId, ...meta });
  }

  private handleWorldUpdate(msg: any): void {
    const p = msg.payload;
    try {
      const updated = this.worldStore!.updateMetadata({
        name: p.name,
        description: p.description,
        settings: p.settings,
      });
      this.respond('wos/world-manager/world/update', { correlationId: p.correlationId, ...updated });
      this._ctx.mqtt.publishRaw(
        'wos/world-manager/lifecycle/updated',
        { name: updated.name, timestamp: new Date().toISOString() },
      );
    } catch (err: any) {
      this.respond('wos/world-manager/world/update', { correlationId: p.correlationId, error: err.message });
    }
  }

  private handleWorldInit(msg: any): void {
    const p = msg.payload;
    if (this.worldStore!.isInitialized()) {
      this.respond('wos/world-manager/world/init', { correlationId: p.correlationId, error: 'already_initialized' });
      return;
    }
    try {
      const meta = this.worldStore!.initWorld({
        name: p.name ?? 'My World',
        owner: p.owner ?? 'system',
        type: p.type ?? 'space',
        description: p.description,
        template: p.template,
        settings: p.settings,
      });
      this.respond('wos/world-manager/world/init', { correlationId: p.correlationId, ...meta });
      this._ctx.mqtt.publishRaw(
        'wos/world-manager/lifecycle/initialized',
        { name: meta.name, type: meta.type, timestamp: new Date().toISOString() },
      );
    } catch (err: any) {
      this.respond('wos/world-manager/world/init', { correlationId: p.correlationId, error: err.message });
    }
  }

  private handleWorldReset(msg: any): void {
    const p = msg.payload;
    try {
      const meta = this.worldStore!.resetWorld({
        name: p.name ?? this._pluginConfig.world_name ?? 'My World',
        owner: p.owner ?? this._pluginConfig.world_owner ?? 'system',
        type: p.type ?? (this._pluginConfig.world_type as WorldType) ?? 'space',
        description: p.description,
        template: p.template,
        settings: p.settings,
      });
      this.respond('wos/world-manager/world/reset', { correlationId: p.correlationId, ...meta });
      this._ctx.mqtt.publishRaw(
        'wos/world-manager/lifecycle/reset',
        { name: meta.name, type: meta.type, timestamp: new Date().toISOString() },
      );
    } catch (err: any) {
      this.respond('wos/world-manager/world/reset', { correlationId: p.correlationId, error: err.message });
    }
  }

  // ── Entity Handlers ────────────────────────────────────────────

  private handleEntityCreate(msg: any): void {
    const p = msg.payload;
    try {
      const entity = this.entityStore!.createEntity({
        type: p.type,
        position: p.position,
        rotation: p.rotation,
        scale: p.scale,
        properties: p.properties,
        owner: p.owner,
        permissions: p.permissions,
        parentId: p.parentId,
        frozen: p.frozen,
      });
      this.respond('wos/world-manager/entity/create', { correlationId: p.correlationId, ...entity });
    } catch (err: any) {
      this.respond('wos/world-manager/entity/create', { correlationId: p.correlationId, error: err.message });
    }
  }

  private handleEntityQuery(msg: any): void {
    const p = msg.payload;
    const result = this.entityStore!.queryEntities({
      type: p.type,
      parentId: p.parentId,
      limit: p.limit,
      offset: p.offset,
    });
    this.respond('wos/world-manager/entity/query', { correlationId: p.correlationId, ...result });
  }

  private handleEntityGet(msg: any): void {
    const p = msg.payload;
    const entity = this.entityStore!.getEntity(p.id);
    if (!entity) {
      this.respond('wos/world-manager/entity/get', { correlationId: p.correlationId, error: 'not_found' });
      return;
    }
    this.respond('wos/world-manager/entity/get', { correlationId: p.correlationId, ...entity });
  }

  private handleEntityUpdate(msg: any): void {
    const p = msg.payload;
    const entity = this.entityStore!.updateEntity(p.id, {
      position: p.position,
      rotation: p.rotation,
      scale: p.scale,
      properties: p.properties,
      owner: p.owner,
      permissions: p.permissions,
      frozen: p.frozen,
    });
    if (!entity) {
      this.respond('wos/world-manager/entity/update', { correlationId: p.correlationId, error: 'not_found' });
      return;
    }
    this.respond('wos/world-manager/entity/update', { correlationId: p.correlationId, ...entity });
  }

  private handleEntityDelete(msg: any): void {
    const p = msg.payload;
    const success = this.entityStore!.deleteEntity(p.id);
    this.respond('wos/world-manager/entity/delete', { correlationId: p.correlationId, success });
  }

  // ── Template Handlers ──────────────────────────────────────────

  private handleTemplateList(msg: any): void {
    const p = msg.payload;
    const result = this.entityStore!.listTemplates({
      type: p.type,
      limit: p.limit,
      offset: p.offset,
    });
    this.respond('wos/world-manager/template/list', { correlationId: p.correlationId, ...result });
  }

  private handleTemplateGet(msg: any): void {
    const p = msg.payload;
    const template = this.entityStore!.getTemplate(p.id);
    if (!template) {
      this.respond('wos/world-manager/template/get', { correlationId: p.correlationId, error: 'not_found' });
      return;
    }
    this.respond('wos/world-manager/template/get', { correlationId: p.correlationId, ...template });
  }

  private handleTemplateCreate(msg: any): void {
    const p = msg.payload;
    try {
      const template = this.entityStore!.createTemplate({
        name: p.name,
        type: p.type,
        properties: p.properties,
        components: p.components,
        defaultPosition: p.defaultPosition,
        defaultRotation: p.defaultRotation,
        defaultScale: p.defaultScale,
      });
      this.respond('wos/world-manager/template/create', { correlationId: p.correlationId, ...template });
    } catch (err: any) {
      this.respond('wos/world-manager/template/create', { correlationId: p.correlationId, error: err.message });
    }
  }

  private handleTemplateDelete(msg: any): void {
    const p = msg.payload;
    const success = this.entityStore!.deleteTemplate(p.id);
    this.respond('wos/world-manager/template/delete', { correlationId: p.correlationId, success });
  }

  private handleTemplateInstantiate(msg: any): void {
    const p = msg.payload;
    const entity = this.entityStore!.instantiateTemplate(p.templateId, {
      position: p.position,
      rotation: p.rotation,
      scale: p.scale,
      properties: p.properties,
      owner: p.owner,
      parentId: p.parentId,
    });
    if (!entity) {
      this.respond('wos/world-manager/template/instantiate', { correlationId: p.correlationId, error: 'template_not_found' });
      return;
    }
    this.respond('wos/world-manager/template/instantiate', { correlationId: p.correlationId, ...entity });
  }

  // ── Terrain Handlers ───────────────────────────────────────────

  private async handleTerrain(msg: any, method: string): Promise<void> {
    const p = msg.payload;
    const topic = msg.topic;
    const service = this.terrainService!;

    let result: any;
    switch (method) {
      case 'getHeight': result = await service.getHeight(p.lat, p.lon); break;
      case 'getHeights': result = await service.getHeights(p.points); break;
      case 'getBiome': result = await service.getBiome(p.lat, p.lon); break;
      case 'getNormal': result = await service.getNormal(p.lat, p.lon); break;
      case 'queryRegion': result = await service.queryRegion(p); break;
      case 'geoToWorld': result = await service.geoToWorld(p.lat, p.lon); break;
      case 'worldToGeo': result = await service.worldToGeo(p.x, p.y, p.z); break;
    }

    this.respond(topic, { correlationId: p.correlationId, ...result });
  }

  // ── World Template Handlers ────────────────────────────────────

  private handleWorldTemplateList(msg: any): void {
    const p = msg.payload;
    const templates = this.templateLoader!.listTemplates(p.worldType);
    this.respond('wos/world-manager/world-template/list', { correlationId: p.correlationId, templates });
  }

  private handleWorldTemplateGet(msg: any): void {
    const p = msg.payload;
    const template = this.templateLoader!.getTemplate(p.name);
    if (!template) {
      this.respond('wos/world-manager/world-template/get', { correlationId: p.correlationId, error: 'not_found' });
      return;
    }
    this.respond('wos/world-manager/world-template/get', { correlationId: p.correlationId, ...template });
  }

  private handleWorldTemplateValidate(msg: any): void {
    const p = msg.payload;
    const result = this.templateLoader!.validateTemplate(p.name, p.worldType);
    this.respond('wos/world-manager/world-template/validate', { correlationId: p.correlationId, ...result });
  }
}

// Singleton plugin instance
export const plugin = new WorldManagerPlugin();

// Re-export sub-modules
export { WorldStore } from './world-store.js';
export { EntityStore } from './entity-store.js';
export { TemplateLoader } from './template-loader.js';
export { TerrainService } from './terrain-service.js';
export { checkWorldPermission, checkEntityPermission } from './permissions.js';
export { collectHealthStatus, collectMetrics } from './health.js';
export * from './types.js';
export * as cli from './cli/index.js';

// Auto-start when spawned as a child process by wos-server
if (process.env.WOS_PLUGIN_NAME) {
  // Bridge WOS_MQTT_HOST/PORT to WOS_MQTT_URL for the SDK client
  if (!process.env.WOS_MQTT_URL && process.env.WOS_MQTT_HOST) {
    process.env.WOS_MQTT_URL = `mqtt://${process.env.WOS_MQTT_HOST}:${process.env.WOS_MQTT_PORT || '1883'}`;
  }

  const handleHealthCheck = (data: Buffer) => {
    for (const line of data.toString().split('\n')) {
      try {
        const msg = JSON.parse(line.trim());
        if (msg.type === 'health_check') {
          Promise.resolve(plugin.onHealthCheck()).then((health: any) => {
            process.stdout.write(JSON.stringify({
              type: 'health_response',
              correlationId: msg.correlationId,
              status: health?.status === 'ok' ? 'healthy' : (health?.status ?? 'healthy'),
              timestamp: new Date().toISOString(),
              details: health?.details,
            }) + '\n');
          }).catch(() => {});
        }
      } catch { /* not JSON */ }
    }
  };

  plugin.start().then(() => {
    process.stdin.on('data', handleHealthCheck);
  }).catch((err: Error) => {
    console.error(`[world-manager] Failed to start: ${err.message}`);
    process.exit(1);
  });

  const shutdown = () => {
    plugin.stop().then(() => process.exit(0)).catch(() => process.exit(1));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
