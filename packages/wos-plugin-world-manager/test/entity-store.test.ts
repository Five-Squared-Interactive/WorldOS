// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { WorldStore } from '../src/world-store.js';
import { EntityStore } from '../src/entity-store.js';
import type { CreateEntityInput, CreateTemplateInput } from '../src/types.js';

describe('EntityStore', () => {
  let db: Database.Database;
  let worldStore: WorldStore;
  let entityStore: EntityStore;

  beforeEach(() => {
    db = new Database(':memory:');
    worldStore = new WorldStore(db);
    entityStore = new EntityStore(db);

    // Initialize a world (required for FK constraints context)
    worldStore.initWorld({
      name: 'Test World',
      owner: 'user-1',
      type: 'space',
    });
  });

  afterEach(() => {
    db.close();
  });

  // ── Entity Instance CRUD ───────────────────────────────────────────

  describe('createEntity', () => {
    it('should create an entity with defaults', () => {
      const entity = entityStore.createEntity({ type: 'mesh' });

      expect(entity.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(entity.type).toBe('mesh');
      expect(entity.position).toEqual({ x: 0, y: 0, z: 0 });
      expect(entity.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
      expect(entity.scale).toEqual({ x: 1, y: 1, z: 1 });
      expect(entity.parentId).toBeNull();
      expect(entity.properties).toBeNull();
      expect(entity.owner).toBeNull();
      expect(entity.permissions).toBeNull();
      expect(entity.frozen).toBe(false);
      expect(entity.createdAt).toBeDefined();
      expect(entity.updatedAt).toBeDefined();
    });

    it('should create an entity with all fields', () => {
      const input: CreateEntityInput = {
        type: 'light',
        position: { x: 1, y: 2, z: 3 },
        rotation: { x: 0, y: 0.7, z: 0, w: 0.7 },
        scale: { x: 2, y: 2, z: 2 },
        properties: { intensity: 1.5, color: '#ffffff' },
        owner: 'user-1',
        permissions: { ownerRead: true, ownerWrite: true, otherRead: true, otherWrite: false },
        frozen: true,
      };

      const entity = entityStore.createEntity(input);

      expect(entity.type).toBe('light');
      expect(entity.position).toEqual({ x: 1, y: 2, z: 3 });
      expect(entity.rotation).toEqual({ x: 0, y: 0.7, z: 0, w: 0.7 });
      expect(entity.scale).toEqual({ x: 2, y: 2, z: 2 });
      expect(entity.properties).toEqual({ intensity: 1.5, color: '#ffffff' });
      expect(entity.owner).toBe('user-1');
      expect(entity.permissions).toEqual({ ownerRead: true, ownerWrite: true, otherRead: true, otherWrite: false });
      expect(entity.frozen).toBe(true);
    });

    it('should create an entity with parent', () => {
      const parent = entityStore.createEntity({ type: 'group' });
      const child = entityStore.createEntity({ type: 'mesh', parentId: parent.id });

      expect(child.parentId).toBe(parent.id);
    });
  });

  describe('getEntity', () => {
    it('should return entity by ID', () => {
      const created = entityStore.createEntity({ type: 'mesh' });
      const fetched = entityStore.getEntity(created.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.type).toBe('mesh');
    });

    it('should return null for non-existent entity', () => {
      expect(entityStore.getEntity('nonexistent')).toBeNull();
    });

    it('should return children IDs (F5)', () => {
      const parent = entityStore.createEntity({ type: 'group' });
      const child1 = entityStore.createEntity({ type: 'mesh', parentId: parent.id });
      const child2 = entityStore.createEntity({ type: 'light', parentId: parent.id });

      const fetched = entityStore.getEntity(parent.id)!;
      expect(fetched.children).toBeDefined();
      expect(fetched.children).toHaveLength(2);
      expect(fetched.children).toContain(child1.id);
      expect(fetched.children).toContain(child2.id);
    });

    it('should return empty children array for leaf entity', () => {
      const entity = entityStore.createEntity({ type: 'mesh' });
      const fetched = entityStore.getEntity(entity.id)!;
      expect(fetched.children).toEqual([]);
    });
  });

  describe('queryEntities', () => {
    it('should return all entities', () => {
      entityStore.createEntity({ type: 'mesh' });
      entityStore.createEntity({ type: 'light' });
      entityStore.createEntity({ type: 'mesh' });

      const result = entityStore.queryEntities();
      expect(result.entities).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it('should filter by type', () => {
      entityStore.createEntity({ type: 'mesh' });
      entityStore.createEntity({ type: 'light' });
      entityStore.createEntity({ type: 'mesh' });

      const result = entityStore.queryEntities({ type: 'mesh' });
      expect(result.entities).toHaveLength(2);
      expect(result.total).toBe(2);
      result.entities.forEach(e => expect(e.type).toBe('mesh'));
    });

    it('should filter by parentId', () => {
      const parent = entityStore.createEntity({ type: 'group' });
      entityStore.createEntity({ type: 'mesh', parentId: parent.id });
      entityStore.createEntity({ type: 'mesh', parentId: parent.id });
      entityStore.createEntity({ type: 'mesh' }); // root entity

      const result = entityStore.queryEntities({ parentId: parent.id });
      expect(result.entities).toHaveLength(2);
    });

    it('should filter by null parentId (root entities)', () => {
      const parent = entityStore.createEntity({ type: 'group' });
      entityStore.createEntity({ type: 'mesh', parentId: parent.id });
      entityStore.createEntity({ type: 'light' }); // root

      const result = entityStore.queryEntities({ parentId: null });
      expect(result.entities).toHaveLength(2); // parent + light
    });

    it('should paginate results', () => {
      for (let i = 0; i < 10; i++) {
        entityStore.createEntity({ type: 'mesh' });
      }

      const page1 = entityStore.queryEntities({ limit: 3, offset: 0 });
      expect(page1.entities).toHaveLength(3);
      expect(page1.total).toBe(10);
      expect(page1.limit).toBe(3);
      expect(page1.offset).toBe(0);

      const page2 = entityStore.queryEntities({ limit: 3, offset: 3 });
      expect(page2.entities).toHaveLength(3);
      expect(page2.offset).toBe(3);
    });

    it('should not populate children in query results', () => {
      const parent = entityStore.createEntity({ type: 'group' });
      entityStore.createEntity({ type: 'mesh', parentId: parent.id });

      const result = entityStore.queryEntities();
      const parentResult = result.entities.find(e => e.id === parent.id)!;
      expect(parentResult.children).toBeUndefined();
    });
  });

  describe('updateEntity', () => {
    it('should update position', () => {
      const entity = entityStore.createEntity({ type: 'mesh' });
      const updated = entityStore.updateEntity(entity.id, {
        position: { x: 10, y: 20, z: 30 },
      });

      expect(updated).not.toBeNull();
      expect(updated!.position).toEqual({ x: 10, y: 20, z: 30 });
    });

    it('should update rotation and scale', () => {
      const entity = entityStore.createEntity({ type: 'mesh' });
      const updated = entityStore.updateEntity(entity.id, {
        rotation: { x: 0, y: 1, z: 0, w: 0 },
        scale: { x: 3, y: 3, z: 3 },
      });

      expect(updated!.rotation).toEqual({ x: 0, y: 1, z: 0, w: 0 });
      expect(updated!.scale).toEqual({ x: 3, y: 3, z: 3 });
    });

    it('should update properties', () => {
      const entity = entityStore.createEntity({ type: 'mesh' });
      const updated = entityStore.updateEntity(entity.id, {
        properties: { material: 'wood', roughness: 0.8 },
      });

      expect(updated!.properties).toEqual({ material: 'wood', roughness: 0.8 });
    });

    it('should update frozen flag', () => {
      const entity = entityStore.createEntity({ type: 'mesh' });
      const updated = entityStore.updateEntity(entity.id, { frozen: true });

      expect(updated!.frozen).toBe(true);
    });

    it('should return null for non-existent entity', () => {
      expect(entityStore.updateEntity('nonexistent', { frozen: true })).toBeNull();
    });

    it('should update updatedAt', () => {
      const entity = entityStore.createEntity({ type: 'mesh' });
      const updated = entityStore.updateEntity(entity.id, {
        position: { x: 1, y: 2, z: 3 },
      });

      expect(updated!.updatedAt).toBeDefined();
    });
  });

  describe('deleteEntity', () => {
    it('should delete an entity', () => {
      const entity = entityStore.createEntity({ type: 'mesh' });
      const result = entityStore.deleteEntity(entity.id);

      expect(result).toBe(true);
      expect(entityStore.getEntity(entity.id)).toBeNull();
    });

    it('should return false for non-existent entity', () => {
      expect(entityStore.deleteEntity('nonexistent')).toBe(false);
    });

    it('should set children parentId to NULL on delete (F11)', () => {
      const parent = entityStore.createEntity({ type: 'group' });
      const child = entityStore.createEntity({ type: 'mesh', parentId: parent.id });

      entityStore.deleteEntity(parent.id);

      const orphan = entityStore.getEntity(child.id)!;
      expect(orphan.parentId).toBeNull();
    });
  });

  // ── Entity Templates ───────────────────────────────────────────────

  describe('createTemplate', () => {
    it('should create a template', () => {
      const input: CreateTemplateInput = {
        name: 'tree',
        type: 'vegetation',
        properties: { height: 5 },
        components: ['mesh', 'collider'],
        defaultPosition: { x: 0, y: 0, z: 0 },
        defaultScale: { x: 1, y: 3, z: 1 },
      };

      const template = entityStore.createTemplate(input);

      expect(template.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(template.name).toBe('tree');
      expect(template.type).toBe('vegetation');
      expect(template.properties).toEqual({ height: 5 });
      expect(template.components).toEqual(['mesh', 'collider']);
      expect(template.defaultPosition).toEqual({ x: 0, y: 0, z: 0 });
      expect(template.defaultScale).toEqual({ x: 1, y: 3, z: 1 });
    });

    it('should enforce unique template names', () => {
      entityStore.createTemplate({ name: 'tree', type: 'vegetation' });

      expect(() => entityStore.createTemplate({ name: 'tree', type: 'plant' })).toThrow();
    });
  });

  describe('getTemplate', () => {
    it('should return template by ID', () => {
      const created = entityStore.createTemplate({ name: 'rock', type: 'terrain' });
      const fetched = entityStore.getTemplate(created.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe('rock');
    });

    it('should return null for non-existent template', () => {
      expect(entityStore.getTemplate('nonexistent')).toBeNull();
    });
  });

  describe('listTemplates', () => {
    it('should list all templates', () => {
      entityStore.createTemplate({ name: 'tree', type: 'vegetation' });
      entityStore.createTemplate({ name: 'rock', type: 'terrain' });
      entityStore.createTemplate({ name: 'bush', type: 'vegetation' });

      const result = entityStore.listTemplates();
      expect(result.templates).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it('should filter by type', () => {
      entityStore.createTemplate({ name: 'tree', type: 'vegetation' });
      entityStore.createTemplate({ name: 'rock', type: 'terrain' });

      const result = entityStore.listTemplates({ type: 'vegetation' });
      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].name).toBe('tree');
    });

    it('should paginate', () => {
      for (let i = 0; i < 5; i++) {
        entityStore.createTemplate({ name: `t-${i}`, type: 'mesh' });
      }

      const page = entityStore.listTemplates({ limit: 2, offset: 0 });
      expect(page.templates).toHaveLength(2);
      expect(page.total).toBe(5);
    });
  });

  describe('deleteTemplate', () => {
    it('should delete a template', () => {
      const template = entityStore.createTemplate({ name: 'rock', type: 'terrain' });
      const result = entityStore.deleteTemplate(template.id);

      expect(result).toBe(true);
      expect(entityStore.getTemplate(template.id)).toBeNull();
    });

    it('should return false for non-existent template', () => {
      expect(entityStore.deleteTemplate('nonexistent')).toBe(false);
    });
  });

  describe('instantiateTemplate', () => {
    it('should create entity from template with defaults', () => {
      const template = entityStore.createTemplate({
        name: 'lamp',
        type: 'light',
        properties: { intensity: 1.0 },
        defaultPosition: { x: 0, y: 5, z: 0 },
        defaultScale: { x: 0.5, y: 0.5, z: 0.5 },
      });

      const entity = entityStore.instantiateTemplate(template.id);

      expect(entity).not.toBeNull();
      expect(entity!.type).toBe('light');
      expect(entity!.position).toEqual({ x: 0, y: 5, z: 0 });
      expect(entity!.scale).toEqual({ x: 0.5, y: 0.5, z: 0.5 });
      expect(entity!.properties).toEqual({ intensity: 1.0 });
    });

    it('should allow caller overrides', () => {
      const template = entityStore.createTemplate({
        name: 'lamp',
        type: 'light',
        properties: { intensity: 1.0 },
        defaultPosition: { x: 0, y: 5, z: 0 },
      });

      const entity = entityStore.instantiateTemplate(template.id, {
        position: { x: 10, y: 10, z: 10 },
        owner: 'user-1',
        properties: { intensity: 2.0, color: 'red' },
      });

      expect(entity!.position).toEqual({ x: 10, y: 10, z: 10 });
      expect(entity!.owner).toBe('user-1');
      expect(entity!.properties).toEqual({ intensity: 2.0, color: 'red' });
    });

    it('should return null for non-existent template', () => {
      expect(entityStore.instantiateTemplate('nonexistent')).toBeNull();
    });
  });

  // ── No updateTemplate (F7) ────────────────────────────────────────

  describe('immutable templates (F7)', () => {
    it('should not expose an updateTemplate method', () => {
      expect((entityStore as any).updateTemplate).toBeUndefined();
    });
  });

  // ── Input Validation (F10) ────────────────────────────────────────

  describe('input validation', () => {
    it('should reject entity type shorter than 1 character', () => {
      expect(() => entityStore.createEntity({ type: '' })).toThrow();
    });

    it('should reject entity type longer than 100 characters', () => {
      expect(() => entityStore.createEntity({ type: 'x'.repeat(101) })).toThrow();
    });

    it('should reject properties JSON larger than 64KB', () => {
      const largeProps: Record<string, unknown> = {};
      // Create a property that will serialize to > 64KB
      largeProps.data = 'x'.repeat(65536);

      expect(() => entityStore.createEntity({ type: 'mesh', properties: largeProps })).toThrow();
    });

    it('should reject template name shorter than 1 character', () => {
      expect(() => entityStore.createTemplate({ name: '', type: 'mesh' })).toThrow();
    });

    it('should reject template name longer than 100 characters', () => {
      expect(() => entityStore.createTemplate({ name: 'x'.repeat(101), type: 'mesh' })).toThrow();
    });
  });

  // ── Entity Count ──────────────────────────────────────────────────

  describe('getEntityCount', () => {
    it('should return total entity count', () => {
      entityStore.createEntity({ type: 'mesh' });
      entityStore.createEntity({ type: 'light' });
      entityStore.createEntity({ type: 'mesh' });

      expect(entityStore.getEntityCount()).toBe(3);
    });

    it('should return 0 when no entities exist', () => {
      expect(entityStore.getEntityCount()).toBe(0);
    });
  });

  describe('getEntityCountByType', () => {
    it('should return counts grouped by type', () => {
      entityStore.createEntity({ type: 'mesh' });
      entityStore.createEntity({ type: 'mesh' });
      entityStore.createEntity({ type: 'light' });

      const counts = entityStore.getEntityCountByType();
      expect(counts).toEqual({ mesh: 2, light: 1 });
    });
  });

  describe('getTemplateCount', () => {
    it('should return total template count', () => {
      entityStore.createTemplate({ name: 'a', type: 'mesh' });
      entityStore.createTemplate({ name: 'b', type: 'mesh' });

      expect(entityStore.getTemplateCount()).toBe(2);
    });
  });
});
