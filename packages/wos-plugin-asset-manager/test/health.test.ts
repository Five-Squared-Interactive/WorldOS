// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { AssetStore } from '../src/asset-store.js';
import { collectHealthStatus } from '../src/health.js';

describe('collectHealthStatus', () => {
  let tmpDir: string;
  let db: Database.Database;
  let store: AssetStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-test-'));
    db = new Database(':memory:');
    store = new AssetStore(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns ok when DB is accessible and asset dir exists', async () => {
    fs.mkdirSync(path.join(tmpDir, 'assets'), { recursive: true });
    store.createAsset({
      assetId: 'a1', fileName: 'f.png', worldId: 'w1', size: 100,
      mimeType: 'image/png', assetType: 'texture', url: 'assets/w1/a1.png',
      createdAt: '2026-01-01T00:00:00Z', createdBy: 'u1', metadata: '{}',
    });

    const result = await collectHealthStatus(store, tmpDir);
    expect(result.status).toBe('ok');
    expect(result.details.totalAssets).toBe(1);
    expect(result.details.totalSizeBytes).toBe(100);
    expect(result.details.worldCount).toBe(1);
  });

  it('returns degraded when asset dir missing but DB works', async () => {
    const result = await collectHealthStatus(store, path.join(tmpDir, 'nonexistent'));
    expect(result.status).toBe('degraded');
  });

  it('returns unhealthy when DB query fails', async () => {
    db.close();
    const result = await collectHealthStatus(store, tmpDir);
    expect(result.status).toBe('unhealthy');
  });

  it('includes metrics: totalAssets, totalSizeBytes, worldCount', async () => {
    fs.mkdirSync(path.join(tmpDir, 'assets'), { recursive: true });
    store.createAsset({
      assetId: 'a1', fileName: 'f.png', worldId: 'w1', size: 100,
      mimeType: 'image/png', assetType: 'texture', url: 'assets/w1/a1.png',
      createdAt: '2026-01-01T00:00:00Z', createdBy: 'u1', metadata: '{}',
    });
    store.createAsset({
      assetId: 'a2', fileName: 'g.png', worldId: 'w2', size: 200,
      mimeType: 'image/png', assetType: 'texture', url: 'assets/w2/a2.png',
      createdAt: '2026-01-01T00:00:00Z', createdBy: 'u1', metadata: '{}',
    });

    const result = await collectHealthStatus(store, tmpDir);
    expect(result.details.totalAssets).toBe(2);
    expect(result.details.totalSizeBytes).toBe(300);
    expect(result.details.worldCount).toBe(2);
  });
});
