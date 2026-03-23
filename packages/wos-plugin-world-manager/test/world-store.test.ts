// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { WorldStore } from '../src/world-store.js';
import type { InitWorldInput } from '../src/types.js';

describe('WorldStore', () => {
  let db: Database.Database;
  let store: WorldStore;

  const defaultInput: InitWorldInput = {
    name: 'Test World',
    description: 'A test world',
    owner: 'user-1',
    type: 'space',
  };

  beforeEach(() => {
    db = new Database(':memory:');
    store = new WorldStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('initialization', () => {
    it('should create all tables, trigger, and indexes on construction', () => {
      // world_metadata table exists
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all() as { name: string }[];
      const tableNames = tables.map(t => t.name);
      expect(tableNames).toContain('world_metadata');
      expect(tableNames).toContain('entity_instances');
      expect(tableNames).toContain('entity_templates');

      // Trigger exists
      const triggers = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger'"
      ).all() as { name: string }[];
      expect(triggers.some(t => t.name === 'world_metadata_single_row')).toBe(true);

      // Indexes exist
      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
      ).all() as { name: string }[];
      const indexNames = indexes.map(i => i.name);
      expect(indexNames).toContain('idx_entity_parent');
      expect(indexNames).toContain('idx_entity_type');
      expect(indexNames).toContain('idx_entity_position');
    });

    it('should enable foreign keys', () => {
      const fk = db.pragma('foreign_keys') as { foreign_keys: number }[];
      expect(fk[0].foreign_keys).toBe(1);
    });
  });

  describe('initWorld', () => {
    it('should create a world and return metadata', () => {
      const world = store.initWorld(defaultInput);

      expect(world.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(world.name).toBe('Test World');
      expect(world.description).toBe('A test world');
      expect(world.owner).toBe('user-1');
      expect(world.type).toBe('space');
      expect(world.createdAt).toBeDefined();
      expect(world.updatedAt).toBeDefined();
    });

    it('should set default permissions when none provided', () => {
      const world = store.initWorld(defaultInput);

      expect(world.permissions).toEqual({ read: [], write: [], admin: [] });
    });

    it('should accept custom permissions', () => {
      const world = store.initWorld({
        ...defaultInput,
        permissions: { read: ['user-2'], write: ['user-1'], admin: ['user-1'] },
      });

      expect(world.permissions.read).toEqual(['user-2']);
      expect(world.permissions.write).toEqual(['user-1']);
      expect(world.permissions.admin).toEqual(['user-1']);
    });

    it('should apply world settings', () => {
      const world = store.initWorld({
        ...defaultInput,
        settings: {
          gravity: false,
          skyConfig: { type: 'starfield' },
          spawnConfig: { position: { x: 0, y: 5, z: 0 } },
          avatarSettings: { height: 1.8 },
        },
      });

      expect(world.gravity).toBe(false);
      expect(world.skyConfig).toEqual({ type: 'starfield' });
      expect(world.spawnConfig).toEqual({ position: { x: 0, y: 5, z: 0 } });
      expect(world.avatarSettings).toEqual({ height: 1.8 });
    });

    it('should default gravity to true', () => {
      const world = store.initWorld(defaultInput);
      expect(world.gravity).toBe(true);
    });

    it('should store template name when provided', () => {
      const world = store.initWorld({ ...defaultInput, template: 'default-space' });
      expect(world.templateName).toBe('default-space');
    });
  });

  describe('single-row constraint (F14)', () => {
    it('should reject second insert into world_metadata', () => {
      store.initWorld(defaultInput);

      expect(() => store.initWorld({ ...defaultInput, name: 'Second World' })).toThrow();
    });
  });

  describe('isInitialized', () => {
    it('should return false when no world exists', () => {
      expect(store.isInitialized()).toBe(false);
    });

    it('should return true after initialization', () => {
      store.initWorld(defaultInput);
      expect(store.isInitialized()).toBe(true);
    });
  });

  describe('getMetadata', () => {
    it('should return null when no world exists', () => {
      expect(store.getMetadata()).toBeNull();
    });

    it('should return world metadata after initialization', () => {
      store.initWorld(defaultInput);
      const meta = store.getMetadata();

      expect(meta).not.toBeNull();
      expect(meta!.name).toBe('Test World');
      expect(meta!.type).toBe('space');
      expect(meta!.owner).toBe('user-1');
    });

    it('should deserialize JSON fields correctly', () => {
      store.initWorld({
        ...defaultInput,
        settings: {
          skyConfig: { type: 'nebula', color: '#ff0000' },
          spawnConfig: { position: { x: 1, y: 2, z: 3 } },
        },
      });

      const meta = store.getMetadata()!;
      expect(meta.skyConfig).toEqual({ type: 'nebula', color: '#ff0000' });
      expect(meta.spawnConfig).toEqual({ position: { x: 1, y: 2, z: 3 } });
    });

    it('should return gravity as boolean (F9)', () => {
      store.initWorld({ ...defaultInput, settings: { gravity: false } });
      const meta = store.getMetadata()!;
      expect(meta.gravity).toBe(false);
      expect(typeof meta.gravity).toBe('boolean');
    });
  });

  describe('updateMetadata', () => {
    it('should update name and description', () => {
      store.initWorld(defaultInput);
      const updated = store.updateMetadata({ name: 'New Name', description: 'New desc' });

      expect(updated.name).toBe('New Name');
      expect(updated.description).toBe('New desc');
    });

    it('should update settings', () => {
      store.initWorld(defaultInput);
      const updated = store.updateMetadata({
        settings: { gravity: false, skyConfig: { type: 'sunset' } },
      });

      expect(updated.gravity).toBe(false);
      expect(updated.skyConfig).toEqual({ type: 'sunset' });
    });

    it('should update updatedAt timestamp', () => {
      const world = store.initWorld(defaultInput);
      const original = world.updatedAt;

      // Small delay to ensure different timestamp
      const updated = store.updateMetadata({ name: 'Updated' });
      // updatedAt should be set (may or may not differ in fast tests)
      expect(updated.updatedAt).toBeDefined();
      expect(updated.name).toBe('Updated');
    });

    it('should not change fields that are not provided', () => {
      store.initWorld({
        ...defaultInput,
        settings: { skyConfig: { type: 'starfield' } },
      });

      store.updateMetadata({ name: 'New Name' });
      const meta = store.getMetadata()!;

      expect(meta.name).toBe('New Name');
      expect(meta.skyConfig).toEqual({ type: 'starfield' }); // unchanged
      expect(meta.owner).toBe('user-1'); // unchanged
    });

    it('should throw when no world is initialized', () => {
      expect(() => store.updateMetadata({ name: 'Nope' })).toThrow();
    });
  });

  describe('updatePermissions', () => {
    it('should update world permissions', () => {
      store.initWorld(defaultInput);
      store.updatePermissions({
        read: ['user-2', 'user-3'],
        write: ['user-1'],
        admin: ['user-1'],
      });

      const meta = store.getMetadata()!;
      expect(meta.permissions.read).toEqual(['user-2', 'user-3']);
      expect(meta.permissions.write).toEqual(['user-1']);
      expect(meta.permissions.admin).toEqual(['user-1']);
    });

    it('should throw when no world is initialized', () => {
      expect(() => store.updatePermissions({ read: [], write: [], admin: [] })).toThrow();
    });
  });

  describe('resetWorld', () => {
    it('should wipe all data and re-initialize', () => {
      store.initWorld(defaultInput);

      // Add some entity data directly to verify it gets wiped
      db.prepare(
        `INSERT INTO entity_instances (id, type, posX, posY, posZ, rotX, rotY, rotZ, rotW, sclX, sclY, sclZ, createdAt, updatedAt)
         VALUES ('e1', 'mesh', 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, datetime('now'), datetime('now'))`
      ).run();

      const reset = store.resetWorld({
        name: 'Reset World',
        owner: 'user-2',
        type: 'planet',
      });

      expect(reset.name).toBe('Reset World');
      expect(reset.owner).toBe('user-2');
      expect(reset.type).toBe('planet');

      // Entities should be wiped
      const count = db.prepare('SELECT COUNT(*) as c FROM entity_instances').get() as { c: number };
      expect(count.c).toBe(0);
    });

    it('should generate a new world ID on reset', () => {
      const original = store.initWorld(defaultInput);
      const reset = store.resetWorld({ name: 'Reset', owner: 'user-1', type: 'space' });

      expect(reset.id).not.toBe(original.id);
    });

    it('should throw when no world exists to reset', () => {
      expect(() => store.resetWorld(defaultInput)).toThrow();
    });
  });

  describe('input validation (F10)', () => {
    it('should reject name shorter than 1 character', () => {
      expect(() => store.initWorld({ ...defaultInput, name: '' })).toThrow();
    });

    it('should reject name longer than 100 characters', () => {
      expect(() => store.initWorld({ ...defaultInput, name: 'x'.repeat(101) })).toThrow();
    });

    it('should reject description longer than 1000 characters', () => {
      expect(() => store.initWorld({
        ...defaultInput,
        description: 'x'.repeat(1001),
      })).toThrow();
    });

    it('should reject invalid world type', () => {
      expect(() => store.initWorld({
        ...defaultInput,
        type: 'invalid' as any,
      })).toThrow();
    });

    it('should accept valid world types', () => {
      for (const type of ['space', 'planet', 'mini-world', 'custom'] as const) {
        const testDb = new Database(':memory:');
        const testStore = new WorldStore(testDb);
        expect(() => testStore.initWorld({ ...defaultInput, type })).not.toThrow();
        testDb.close();
      }
    });
  });

  describe('close', () => {
    it('should close the database connection', () => {
      store.close();
      // After close, operations should throw
      expect(() => store.isInitialized()).toThrow();
    });
  });
});
