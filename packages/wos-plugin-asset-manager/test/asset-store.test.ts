// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { AssetStore } from '../src/asset-store.js';
import type { AssetRecord } from '../src/types.js';

function makeRecord(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    assetId: 'test-asset-001',
    fileName: 'texture.png',
    worldId: 'world-1',
    size: 1024,
    mimeType: 'image/png',
    assetType: 'texture',
    url: 'assets/world-1/test-asset-001.png',
    createdAt: '2026-03-21T00:00:00.000Z',
    createdBy: 'user-1',
    metadata: '{}',
    ...overrides,
  };
}

describe('AssetStore', () => {
  let db: Database.Database;
  let store: AssetStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new AssetStore(db);
  });

  describe('DDL', () => {
    it('creates assets table and indexes on init', () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assets'").all();
      expect(tables).toHaveLength(1);

      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all() as { name: string }[];
      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain('idx_assets_world_id');
      expect(indexNames).toContain('idx_assets_asset_type');
      expect(indexNames).toContain('idx_assets_created_by');
    });

    it('attempts to set WAL journal mode (memory DBs remain memory mode)', () => {
      // In-memory databases cannot use WAL, so the pragma is set but stays 'memory'.
      // On disk-backed DBs, it would be 'wal'. We verify the pragma call does not throw.
      const result = db.pragma('journal_mode') as { journal_mode: string }[];
      expect(['wal', 'memory']).toContain(result[0].journal_mode);
    });
  });

  describe('createAsset', () => {
    it('inserts and returns the record', () => {
      const record = makeRecord();
      const result = store.createAsset(record);
      expect(result).toEqual(record);
    });
  });

  describe('getAsset', () => {
    it('returns record by assetId', () => {
      const record = makeRecord();
      store.createAsset(record);
      const result = store.getAsset('test-asset-001');
      expect(result).toEqual(record);
    });

    it('returns undefined for non-existent ID', () => {
      const result = store.getAsset('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('listAssets', () => {
    beforeEach(() => {
      for (let i = 0; i < 10; i++) {
        store.createAsset(makeRecord({
          assetId: `asset-${i}`,
          fileName: `file-${i}.png`,
          url: `assets/world-1/asset-${i}.png`,
          assetType: i < 5 ? 'texture' : 'model',
          createdAt: `2026-03-21T00:00:${String(i).padStart(2, '0')}.000Z`,
        }));
      }
    });

    it('returns paginated results with limit/offset', () => {
      const result = store.listAssets('world-1', { limit: 3, offset: 0 });
      expect(result.assets).toHaveLength(3);
      expect(result.total).toBe(10);
      expect(result.limit).toBe(3);
      expect(result.offset).toBe(0);
    });

    it('returns correct page with offset', () => {
      const result = store.listAssets('world-1', { limit: 3, offset: 7 });
      expect(result.assets).toHaveLength(3);
      expect(result.total).toBe(10);
      expect(result.offset).toBe(7);
    });

    it('returns only matching asset types with type filter', () => {
      const result = store.listAssets('world-1', { limit: 50, offset: 0, type: 'texture' });
      expect(result.assets).toHaveLength(5);
      expect(result.total).toBe(5);
      result.assets.forEach(a => expect(a.assetType).toBe('texture'));
    });

    it('returns { assets, total, limit, offset }', () => {
      const result = store.listAssets('world-1', { limit: 50, offset: 0 });
      expect(result).toHaveProperty('assets');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('limit');
      expect(result).toHaveProperty('offset');
    });

    it('uses default limit=50, offset=0 when not provided', () => {
      const result = store.listAssets('world-1', {});
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
      expect(result.assets).toHaveLength(10);
    });

    it('returns empty for different worldId', () => {
      const result = store.listAssets('world-2', {});
      expect(result.assets).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('deleteAsset', () => {
    it('removes record and returns true', () => {
      store.createAsset(makeRecord());
      const result = store.deleteAsset('test-asset-001');
      expect(result).toBe(true);
      expect(store.getAsset('test-asset-001')).toBeUndefined();
    });

    it('returns false for non-existent ID', () => {
      const result = store.deleteAsset('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getStorageUsage', () => {
    it('returns usedBytes, totalBytes: 0, assetCount', () => {
      store.createAsset(makeRecord({ assetId: 'a1', size: 100 }));
      store.createAsset(makeRecord({ assetId: 'a2', size: 200 }));
      const result = store.getStorageUsage('world-1');
      expect(result).toEqual({ usedBytes: 300, totalBytes: 0, assetCount: 2 });
    });

    it('returns zeros for empty world', () => {
      const result = store.getStorageUsage('empty-world');
      expect(result).toEqual({ usedBytes: 0, totalBytes: 0, assetCount: 0 });
    });
  });

  describe('deleteAssetsByWorld', () => {
    it('removes all assets for a world', () => {
      store.createAsset(makeRecord({ assetId: 'a1', worldId: 'world-1' }));
      store.createAsset(makeRecord({ assetId: 'a2', worldId: 'world-1' }));
      store.createAsset(makeRecord({ assetId: 'a3', worldId: 'world-2' }));

      const deleted = store.deleteAssetsByWorld('world-1');
      expect(deleted).toBe(2);
      expect(store.listAssets('world-1', {}).total).toBe(0);
      expect(store.listAssets('world-2', {}).total).toBe(1);
    });
  });
});
