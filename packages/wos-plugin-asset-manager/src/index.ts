// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import Database from 'better-sqlite3';
import { WOSPlugin } from '@worldos/plugin-sdk';
import { AssetStore } from './asset-store.js';
import { FileStorage } from './file-storage.js';
import { getMimeType, getAssetType } from './mime-types.js';
import { collectHealthStatus } from './health.js';
import type { AssetRecord } from './types.js';

const MAX_BASE64_LENGTH = 67_108_864; // ~50MB decoded
const MAX_TOKEN_CACHE_SIZE = 1000;

export class AssetManagerPlugin extends WOSPlugin {
  private _ctx: any;
  private db?: Database.Database;
  private assetStore?: AssetStore;
  private fileStorage?: FileStorage;
  private dataDir = '';

  // Auth
  private tokenCache = new Map<string, { decoded: any; expiresAt: number }>();
  private pendingAuth = new Map<string, { resolve: (v: any) => void; timer: ReturnType<typeof setTimeout>; token: string }>();
  private cacheCleanupTimer?: ReturnType<typeof setInterval>;

  async onStart(context: any): Promise<void> {
    this._ctx = context;
    const serverDir = context.serverDir ?? process.cwd();
    this.dataDir = path.join(serverDir, 'data');

    await fs.mkdir(this.dataDir, { recursive: true });

    const dbPath = path.join(this.dataDir, 'asset-manager.db');
    this.db = new Database(dbPath);
    this.assetStore = new AssetStore(this.db);
    this.fileStorage = new FileStorage(this.dataDir);

    this.cacheCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, val] of this.tokenCache) {
        if (val.expiresAt < now) this.tokenCache.delete(key);
      }
    }, 60_000);

    this.subscribeHandlers();
    this._ctx.logger.info('Asset manager started');
  }

  async onStop(): Promise<void> {
    if (this.cacheCleanupTimer) {
      clearInterval(this.cacheCleanupTimer);
      this.cacheCleanupTimer = undefined;
    }
    for (const pending of this.pendingAuth.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingAuth.clear();
    this.tokenCache.clear();
    if (this.db) {
      this.db.close();
      this.db = undefined;
    }
    this.assetStore = undefined;
    this.fileStorage = undefined;
  }

  async onHealthCheck(): Promise<any> {
    if (!this.assetStore) {
      return { status: 'unhealthy', details: { initialized: false, error: 'Not started' } };
    }
    return collectHealthStatus(this.assetStore, this.dataDir);
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

  private async withAuth(msg: any, handler: (userId: string) => void | Promise<void>): Promise<void> {
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
    try {
      await handler(auth.userId!);
    } catch (err: any) {
      this.respond(msg.topic, { correlationId: msg.payload?.correlationId, error: err.message ?? 'internal_error' });
    }
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

  // ── MQTT ─────────────────────────────────────────────────────────

  private respond(topic: string, payload: any): void {
    this._ctx.mqtt.publishRaw(`${topic}/response`, JSON.stringify(payload));
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
        if (p.valid && p.token === pending.token) {
          if (this.tokenCache.size >= MAX_TOKEN_CACHE_SIZE) {
            const oldest = this.tokenCache.keys().next().value!;
            this.tokenCache.delete(oldest);
          }
          this.tokenCache.set(pending.token, {
            decoded: { userId: p.userId, role: p.role },
            expiresAt: Date.now() + 30_000,
          });
          pending.resolve({ valid: true, userId: p.userId, role: p.role });
        } else if (p.valid && p.token !== pending.token) {
          pending.resolve({ valid: false });
        } else {
          pending.resolve({ valid: false });
        }
      }
    });

    // World lifecycle cleanup
    mqtt.subscribeWithHandler('wos/world-manager/lifecycle/reset', (msg: any) => {
      this.handleWorldReset(msg);
    });

    // Asset operations
    mqtt.subscribeWithHandler('wos/asset-manager/asset/create', (msg: any) => this.handleAssetCreate(msg));
    mqtt.subscribeWithHandler('wos/asset-manager/asset/get', (msg: any) => this.handleAssetGet(msg));
    mqtt.subscribeWithHandler('wos/asset-manager/asset/list', (msg: any) => this.handleAssetList(msg));
    mqtt.subscribeWithHandler('wos/asset-manager/asset/delete', (msg: any) => this.handleAssetDelete(msg));
    mqtt.subscribeWithHandler('wos/asset-manager/asset/usage', (msg: any) => this.handleAssetUsage(msg));
  }

  // ── Handlers ─────────────────────────────────────────────────────

  private async handleAssetCreate(msg: any): Promise<void> {
    if (!this.requireFields(msg, 'worldId', 'fileName', 'fileData')) return;

    const { fileData } = msg.payload;
    if (typeof fileData === 'string' && fileData.length > MAX_BASE64_LENGTH) {
      this.respond(msg.topic, { correlationId: msg.payload.correlationId, error: 'File too large (max 50MB)' });
      return;
    }

    await this.withAuth(msg, async (userId) => {
      const { worldId, fileName, metadata, mimeType: overrideMime, assetType: overrideType } = msg.payload;
      const assetId = crypto.randomUUID();
      const ext = this.getExtension(fileName);
      const detectedMime = overrideMime ?? getMimeType(fileName);
      const detectedType = overrideType ?? getAssetType(detectedMime);

      const url = await this.fileStorage!.writeFile(worldId, assetId, ext, fileData);

      const padding = (fileData.endsWith('==') ? 2 : fileData.endsWith('=') ? 1 : 0);
      const decodedSize = Math.floor(fileData.length * 3 / 4) - padding;

      const record: AssetRecord = {
        assetId, fileName, worldId,
        size: decodedSize,
        mimeType: detectedMime,
        assetType: detectedType,
        url,
        createdAt: new Date().toISOString(),
        createdBy: userId,
        metadata: metadata ? JSON.stringify(metadata) : '{}',
      };

      try {
        this.assetStore!.createAsset(record);
      } catch (err) {
        // Clean up orphan file
        try { await this.fileStorage!.deleteFile(worldId, assetId, ext); } catch { /* best effort */ }
        throw err;
      }

      this.respond(msg.topic, {
        correlationId: msg.payload.correlationId,
        id: assetId,
        url,
      });
    });
  }

  private async handleAssetGet(msg: any): Promise<void> {
    if (!this.requireFields(msg, 'worldId', 'assetId')) return;
    await this.withAuth(msg, async () => {
      const { worldId, assetId } = msg.payload;
      const record = this.assetStore!.getAsset(assetId);
      if (!record || record.worldId !== worldId) {
        this.respond(msg.topic, { correlationId: msg.payload.correlationId, error: 'Asset not found' });
        return;
      }
      const ext = this.getExtension(record.fileName);
      const fileData = await this.fileStorage!.readFile(worldId, assetId, ext);
      this.respond(msg.topic, {
        correlationId: msg.payload.correlationId,
        asset: {
          id: record.assetId,
          name: record.fileName,
          type: record.assetType,
          size: record.size,
          url: record.url,
          mimeType: record.mimeType,
          metadata: JSON.parse(record.metadata),
          createdAt: record.createdAt,
          createdBy: record.createdBy,
          worldId: record.worldId,
        },
        fileData,
      });
    });
  }

  private async handleAssetList(msg: any): Promise<void> {
    if (!this.requireFields(msg, 'worldId')) return;
    await this.withAuth(msg, async () => {
      const { worldId, limit, offset, type } = msg.payload;
      const result = this.assetStore!.listAssets(worldId, { limit, offset, type });
      this.respond(msg.topic, {
        correlationId: msg.payload.correlationId,
        assets: result.assets.map(r => ({
          id: r.assetId, name: r.fileName, type: r.assetType,
          size: r.size, url: r.url, mimeType: r.mimeType,
          createdAt: r.createdAt, worldId: r.worldId,
        })),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      });
    });
  }

  private async handleAssetDelete(msg: any): Promise<void> {
    if (!this.requireFields(msg, 'worldId', 'assetId')) return;
    await this.withAuth(msg, async () => {
      const { worldId, assetId } = msg.payload;
      const record = this.assetStore!.getAsset(assetId);
      if (!record || record.worldId !== worldId) {
        this.respond(msg.topic, { correlationId: msg.payload.correlationId, error: 'Asset not found' });
        return;
      }
      const ext = this.getExtension(record.fileName);
      const freedBytes = record.size;
      this.assetStore!.deleteAsset(assetId);
      try {
        await this.fileStorage!.deleteFile(worldId, assetId, ext);
      } catch {
        // Best effort — DB record already removed, orphan file is harmless
      }
      this.respond(msg.topic, {
        correlationId: msg.payload.correlationId,
        success: true,
        freedBytes,
      });
    });
  }

  private async handleAssetUsage(msg: any): Promise<void> {
    if (!this.requireFields(msg, 'worldId')) return;
    await this.withAuth(msg, async () => {
      const { worldId } = msg.payload;
      const usage = this.assetStore!.getStorageUsage(worldId);
      this.respond(msg.topic, {
        correlationId: msg.payload.correlationId,
        ...usage,
      });
    });
  }

  private async handleWorldReset(msg: any): Promise<void> {
    const worldId = msg.payload?.worldId;
    if (!worldId) return;
    try {
      this.assetStore?.deleteAssetsByWorld(worldId);
      await this.fileStorage?.deleteWorldDirectory(worldId);
      this._ctx.logger.info(`Cleaned up assets for world: ${worldId}`);
    } catch (err: any) {
      this._ctx.logger.error(`Failed to cleanup world assets for world: ${worldId}`);
    }
  }

  private getExtension(fileName: string): string {
    if (fileName.length > 255) {
      throw new Error('File name too long (max 255 characters)');
    }
    const dotIndex = fileName.lastIndexOf('.');
    if (dotIndex === -1) return 'bin';
    const ext = fileName.slice(dotIndex + 1).toLowerCase();
    if (ext.length > 32) {
      throw new Error('File extension too long (max 32 characters)');
    }
    return ext;
  }
}

export const plugin = new AssetManagerPlugin();
