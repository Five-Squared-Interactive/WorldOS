// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { RegionStore } from '../src/region-store.js';
import { DEFAULT_PERMISSIONS } from '../src/types.js';

function createMockLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createWorldDb(dbPath: string, regions: Array<{ x: number; y: number; owner: string; owner_read?: number | null; owner_write?: number | null; other_read?: number | null; other_write?: number | null }> = []) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS region_registry (
      x_index INTEGER NOT NULL,
      y_index INTEGER NOT NULL,
      owner TEXT NOT NULL,
      owner_read INTEGER,
      owner_write INTEGER,
      other_read INTEGER,
      other_write INTEGER,
      owner_use INTEGER,
      other_use INTEGER,
      owner_take INTEGER,
      other_take INTEGER,
      PRIMARY KEY (x_index, y_index)
    )
  `);

  const insert = db.prepare('INSERT INTO region_registry (x_index, y_index, owner, owner_read, owner_write, other_read, other_write) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const r of regions) {
    insert.run(r.x, r.y, r.owner, r.owner_read ?? null, r.owner_write ?? null, r.other_read ?? null, r.other_write ?? null);
  }

  db.close();
}

function createRegionDb(dbPath: string, entities: Array<{ instance_id: string; owner: string; owner_write?: number | null; other_write?: number | null }> = []) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      instance_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      owner_write INTEGER,
      other_write INTEGER
    )
  `);

  const insert = db.prepare('INSERT INTO entities (instance_id, owner, owner_write, other_write) VALUES (?, ?, ?, ?)');
  for (const e of entities) {
    insert.run(e.instance_id, e.owner, e.owner_write ?? null, e.other_write ?? null);
  }

  db.close();
}

describe('RegionStore', () => {
  let tmpDir: string;
  let logger: ReturnType<typeof createMockLogger>;
  let store: RegionStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'region-store-test-'));
    logger = createMockLogger();
  });

  afterEach(() => {
    if (store) {
      store.cleanup();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('openWorld', () => {
    it('should open world.db and verify region_registry table exists', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      expect(store.isOpen).toBe(true);
    });

    it('should throw when world.db does not exist', () => {
      store = new RegionStore(path.join(tmpDir, 'missing.db'), tmpDir, logger as any);

      expect(() => store.openWorld()).toThrow();
    });

    it('should throw when region_registry table is missing', () => {
      const worldDbPath = path.join(tmpDir, 'empty.db');
      const db = new Database(worldDbPath);
      db.close();

      store = new RegionStore(worldDbPath, tmpDir, logger as any);

      expect(() => store.openWorld()).toThrow(/region_registry/);
    });
  });

  describe('closeWorld', () => {
    it('should close world.db and all region DBs', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();
      store.closeWorld();

      expect(store.isOpen).toBe(false);
    });
  });

  describe('getRegionDb', () => {
    it('should lazy-load correct region file path', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath);

      // Create region DB
      const regionDbPath = path.join(tmpDir, 'region_5_10.db');
      createRegionDb(regionDbPath);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      const regionDb = store.getRegionDb(5, 10);
      expect(regionDb).toBeDefined();
    });

    it('should return cached DB on second call', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath);

      const regionDbPath = path.join(tmpDir, 'region_3_7.db');
      createRegionDb(regionDbPath);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      const db1 = store.getRegionDb(3, 7);
      const db2 = store.getRegionDb(3, 7);
      expect(db1).toBe(db2); // Same reference
    });

    it('should return null when region DB file does not exist', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      const regionDb = store.getRegionDb(99, 99);
      expect(regionDb).toBeNull();
    });
  });

  describe('checkRegionReadPermission', () => {
    it('should return true for owner with owner_read=1', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath, [
        { x: 5, y: 10, owner: 'user-1', owner_read: 1, other_read: 0 },
      ]);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      expect(store.checkRegionReadPermission(5, 10, 'user-1')).toBe(true);
    });

    it('should return false for owner with owner_read=0', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath, [
        { x: 5, y: 10, owner: 'user-1', owner_read: 0, other_read: 1 },
      ]);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      expect(store.checkRegionReadPermission(5, 10, 'user-1')).toBe(false);
    });

    it('should return true for non-owner with other_read=1', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath, [
        { x: 5, y: 10, owner: 'owner-1', owner_read: 1, other_read: 1 },
      ]);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      expect(store.checkRegionReadPermission(5, 10, 'visitor')).toBe(true);
    });

    it('should return false for non-owner with other_read=0', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath, [
        { x: 5, y: 10, owner: 'owner-1', owner_read: 1, other_read: 0 },
      ]);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      expect(store.checkRegionReadPermission(5, 10, 'visitor')).toBe(false);
    });

    it('should return false for missing region row', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      expect(store.checkRegionReadPermission(99, 99, 'user-1')).toBe(false);
    });

    it('should apply DEFAULT_PERMISSIONS when DB fields are NULL (owner)', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath, [
        { x: 5, y: 10, owner: 'user-1' }, // NULL fields
      ]);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      // DEFAULT_PERMISSIONS.ownerRead = 1, so owner should have read
      expect(store.checkRegionReadPermission(5, 10, 'user-1')).toBe(DEFAULT_PERMISSIONS.ownerRead === 1);
    });

    it('should apply DEFAULT_PERMISSIONS when DB fields are NULL (non-owner)', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath, [
        { x: 5, y: 10, owner: 'owner-1' }, // NULL fields
      ]);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      // DEFAULT_PERMISSIONS.otherRead = 1
      expect(store.checkRegionReadPermission(5, 10, 'visitor')).toBe(DEFAULT_PERMISSIONS.otherRead === 1);
    });
  });

  describe('checkRegionWritePermission', () => {
    it('should return true for owner with owner_write=1', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath, [
        { x: 5, y: 10, owner: 'user-1', owner_write: 1, other_write: 0 },
      ]);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      expect(store.checkRegionWritePermission(5, 10, 'user-1')).toBe(true);
    });

    it('should return false for non-owner with other_write=0', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath, [
        { x: 5, y: 10, owner: 'owner-1', owner_write: 1, other_write: 0 },
      ]);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      expect(store.checkRegionWritePermission(5, 10, 'visitor')).toBe(false);
    });

    it('should apply DEFAULT_PERMISSIONS for NULL write fields', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath, [
        { x: 5, y: 10, owner: 'owner-1' }, // NULL
      ]);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      // DEFAULT_PERMISSIONS.otherWrite = 0
      expect(store.checkRegionWritePermission(5, 10, 'visitor')).toBe(false);
      // DEFAULT_PERMISSIONS.ownerWrite = 1
      expect(store.checkRegionWritePermission(5, 10, 'owner-1')).toBe(true);
    });

    it('should return false for missing region row (F10)', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      expect(store.checkRegionWritePermission(99, 99, 'user-1')).toBe(false);
    });

    it('should return false on DB error (F11)', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();
      store.closeWorld();

      expect(store.checkRegionWritePermission(5, 10, 'user-1')).toBe(false);
    });
  });

  describe('checkEntityWritePermission', () => {
    it('should return true for entity owner with owner_write=1', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath);

      const regionDbPath = path.join(tmpDir, 'region_5_10.db');
      createRegionDb(regionDbPath, [
        { instance_id: 'ent-1', owner: 'user-1', owner_write: 1, other_write: 0 },
      ]);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      expect(store.checkEntityWritePermission(5, 10, 'ent-1', 'user-1')).toBe(true);
    });

    it('should return false for non-owner with other_write=0', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath);

      const regionDbPath = path.join(tmpDir, 'region_5_10.db');
      createRegionDb(regionDbPath, [
        { instance_id: 'ent-1', owner: 'owner-1', owner_write: 1, other_write: 0 },
      ]);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      expect(store.checkEntityWritePermission(5, 10, 'ent-1', 'visitor')).toBe(false);
    });

    it('should return false when entity does not exist', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath);

      const regionDbPath = path.join(tmpDir, 'region_5_10.db');
      createRegionDb(regionDbPath);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      expect(store.checkEntityWritePermission(5, 10, 'missing-ent', 'user-1')).toBe(false);
    });

    it('should return false when region DB does not exist (fail closed)', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      expect(store.checkEntityWritePermission(99, 99, 'ent-1', 'user-1')).toBe(false);
    });

    it('should return false on entity DB error when region file missing (F11)', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath);

      // No region DB file created — getRegionDb returns null → false
      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      expect(store.checkEntityWritePermission(99, 99, 'ent-1', 'user-1')).toBe(false);
    });

    it('should apply DEFAULT_PERMISSIONS for NULL entity write fields', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath);

      const regionDbPath = path.join(tmpDir, 'region_5_10.db');
      createRegionDb(regionDbPath, [
        { instance_id: 'ent-1', owner: 'owner-1' }, // NULL fields
      ]);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      // DEFAULT_PERMISSIONS: ownerWrite=1, otherWrite=0
      expect(store.checkEntityWritePermission(5, 10, 'ent-1', 'owner-1')).toBe(true);
      expect(store.checkEntityWritePermission(5, 10, 'ent-1', 'visitor')).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should close all DBs without error', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath);

      const regionDbPath = path.join(tmpDir, 'region_1_1.db');
      createRegionDb(regionDbPath);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();
      store.getRegionDb(1, 1); // Load a region DB

      expect(() => store.cleanup()).not.toThrow();
      expect(store.isOpen).toBe(false);
    });
  });

  describe('openWorld with path override (F5)', () => {
    it('should accept a worldDbPath argument', () => {
      const worldDbPath1 = path.join(tmpDir, 'world1.db');
      const worldDbPath2 = path.join(tmpDir, 'world2.db');
      createWorldDb(worldDbPath1, [{ x: 1, y: 1, owner: 'a' }]);
      createWorldDb(worldDbPath2, [{ x: 2, y: 2, owner: 'b' }]);

      store = new RegionStore(worldDbPath1, tmpDir, logger as any);
      store.openWorld();
      expect(store.checkRegionReadPermission(1, 1, 'a')).toBe(true);
      expect(store.checkRegionReadPermission(2, 2, 'b')).toBe(false);

      // Re-open with different DB
      store.openWorld(worldDbPath2);
      expect(store.checkRegionReadPermission(2, 2, 'b')).toBe(true);
      expect(store.checkRegionReadPermission(1, 1, 'a')).toBe(false);
    });
  });

  describe('double open safety (F14)', () => {
    it('should close existing DB when openWorld called twice', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath, [{ x: 1, y: 1, owner: 'a' }]);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();
      store.openWorld(); // Should not leak

      expect(store.isOpen).toBe(true);
      expect(store.checkRegionReadPermission(1, 1, 'a')).toBe(true);
    });
  });

  describe('DB error handling', () => {
    it('should return false on DB error (fail closed)', () => {
      const worldDbPath = path.join(tmpDir, 'world.db');
      createWorldDb(worldDbPath);

      store = new RegionStore(worldDbPath, tmpDir, logger as any);
      store.openWorld();

      // Close the DB to force an error on next query
      store.closeWorld();

      expect(store.checkRegionReadPermission(5, 10, 'user-1')).toBe(false);
    });
  });
});
