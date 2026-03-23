/**
 * Entity Query API Tests
 *
 * Story 9.1: Entity Query API
 *
 * Tests for querying entities within worlds.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EntityManager,
  Entity,
  EntityFilter,
  EntityQueryResult,
  Vector3,
  Quaternion,
} from './entities.js';

describe('Entity Query API', () => {
  let entityManager: EntityManager;
  let mockMqttClient: any;

  beforeEach(() => {
    mockMqttClient = {
      publish: vi.fn(),
      subscribe: vi.fn(),
      on: vi.fn(),
    };
    entityManager = new EntityManager(mockMqttClient);
  });

  describe('Entity types', () => {
    it('should define Entity interface', () => {
      const entity: Entity = {
        id: 'entity-1',
        type: 'mesh',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
        properties: {},
      };

      expect(entity.id).toBe('entity-1');
      expect(entity.type).toBe('mesh');
    });

    it('should support Vector3 for position and scale', () => {
      const pos: Vector3 = { x: 1, y: 2, z: 3 };
      const scale: Vector3 = { x: 1, y: 1, z: 1 };

      expect(pos.x).toBe(1);
      expect(scale.y).toBe(1);
    });

    it('should support Quaternion for rotation', () => {
      const rot: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

      expect(rot.w).toBe(1);
    });
  });

  describe('EntityManager', () => {
    it('should create entity manager', () => {
      expect(entityManager).toBeDefined();
    });

    it('should have query method', () => {
      expect(typeof entityManager.query).toBe('function');
    });

    it('should have create method', () => {
      expect(typeof entityManager.create).toBe('function');
    });

    it('should have update method', () => {
      expect(typeof entityManager.update).toBe('function');
    });

    it('should have delete method', () => {
      expect(typeof entityManager.delete).toBe('function');
    });
  });

  describe('query', () => {
    it('should query entities by type', async () => {
      // Setup mock response
      entityManager.setMockResponse('query', {
        entities: [
          { id: 'e1', type: 'mesh', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 }, properties: {} },
        ],
        total: 1,
      });

      const result = await entityManager.query('world-1', { type: 'mesh' });

      expect(result.entities.length).toBe(1);
      expect(result.entities[0].type).toBe('mesh');
    });

    it('should filter by multiple criteria', async () => {
      entityManager.setMockResponse('query', {
        entities: [
          { id: 'e1', type: 'light', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 }, properties: { color: 'red' } },
        ],
        total: 1,
      });

      const result = await entityManager.query('world-1', {
        type: 'light',
        properties: { color: 'red' },
      });

      expect(result.entities.length).toBe(1);
      expect(result.entities[0].properties.color).toBe('red');
    });

    it('should support pagination with limit', async () => {
      entityManager.setMockResponse('query', {
        entities: [{ id: 'e1', type: 'mesh', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 }, properties: {} }],
        total: 100,
        limit: 10,
        offset: 0,
      });

      const result = await entityManager.query('world-1', {}, { limit: 10 });

      expect(result.limit).toBe(10);
      expect(result.total).toBe(100);
    });

    it('should support pagination with offset', async () => {
      entityManager.setMockResponse('query', {
        entities: [],
        total: 100,
        limit: 10,
        offset: 90,
      });

      const result = await entityManager.query('world-1', {}, { limit: 10, offset: 90 });

      expect(result.offset).toBe(90);
    });

    it('should include total count in response', async () => {
      entityManager.setMockResponse('query', {
        entities: [],
        total: 500,
      });

      const result = await entityManager.query('world-1', {});

      expect(result.total).toBe(500);
    });

    it('should throw error for non-existent world', async () => {
      entityManager.setMockError('query', {
        code: 'WORLD_NOT_FOUND',
        message: 'World not found: invalid-world',
      });

      try {
        await entityManager.query('invalid-world', {});
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.code).toBe('WORLD_NOT_FOUND');
      }
    });

    it('should include world ID in error', async () => {
      entityManager.setMockError('query', {
        code: 'WORLD_NOT_FOUND',
        message: 'World not found: invalid-world',
        worldId: 'invalid-world',
      });

      try {
        await entityManager.query('invalid-world', {});
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.worldId).toBe('invalid-world');
      }
    });
  });

  describe('query filter building', () => {
    it('should build filter for type', () => {
      const filter: EntityFilter = { type: 'mesh' };

      expect(entityManager.buildFilterQuery(filter)).toEqual({ type: 'mesh' });
    });

    it('should build filter for properties', () => {
      const filter: EntityFilter = {
        properties: { visible: true, layer: 'foreground' },
      };

      expect(entityManager.buildFilterQuery(filter)).toEqual({
        properties: { visible: true, layer: 'foreground' },
      });
    });

    it('should build filter for id', () => {
      const filter: EntityFilter = { id: 'entity-123' };

      expect(entityManager.buildFilterQuery(filter)).toEqual({ id: 'entity-123' });
    });

    it('should combine multiple filter criteria', () => {
      const filter: EntityFilter = {
        type: 'light',
        properties: { intensity: 1.0 },
      };

      expect(entityManager.buildFilterQuery(filter)).toEqual({
        type: 'light',
        properties: { intensity: 1.0 },
      });
    });
  });

  describe('create', () => {
    it('should create entity with type and position', async () => {
      entityManager.setMockResponse('create', { id: 'new-entity-1' });

      const result = await entityManager.create('world-1', {
        type: 'mesh',
        position: { x: 10, y: 5, z: 0 },
      });

      expect(result.id).toBe('new-entity-1');
    });

    it('should create entity with properties', async () => {
      entityManager.setMockResponse('create', { id: 'new-entity-2' });

      const result = await entityManager.create('world-1', {
        type: 'light',
        position: { x: 0, y: 10, z: 0 },
        properties: { color: 'white', intensity: 1.0 },
      });

      expect(result.id).toBe('new-entity-2');
    });

    it('should return created entity ID', async () => {
      entityManager.setMockResponse('create', { id: 'generated-uuid' });

      const result = await entityManager.create('world-1', {
        type: 'mesh',
        position: { x: 0, y: 0, z: 0 },
      });

      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe('string');
    });
  });

  describe('update', () => {
    it('should update entity position', async () => {
      entityManager.setMockResponse('update', { success: true });

      const result = await entityManager.update('world-1', 'entity-1', {
        position: { x: 100, y: 50, z: 25 },
      });

      expect(result.success).toBe(true);
    });

    it('should update entity properties', async () => {
      entityManager.setMockResponse('update', { success: true });

      const result = await entityManager.update('world-1', 'entity-1', {
        properties: { color: 'blue' },
      });

      expect(result.success).toBe(true);
    });

    it('should support partial updates', async () => {
      entityManager.setMockResponse('update', { success: true, fieldsUpdated: ['position'] });

      const result = await entityManager.update('world-1', 'entity-1', {
        position: { x: 0, y: 0, z: 0 },
      });

      expect(result.success).toBe(true);
    });

    it('should throw for non-existent entity', async () => {
      entityManager.setMockError('update', {
        code: 'ENTITY_NOT_FOUND',
        message: 'Entity not found',
      });

      try {
        await entityManager.update('world-1', 'invalid-entity', { position: { x: 0, y: 0, z: 0 } });
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.code).toBe('ENTITY_NOT_FOUND');
      }
    });
  });

  describe('delete', () => {
    it('should delete entity', async () => {
      entityManager.setMockResponse('delete', { success: true });

      const result = await entityManager.delete('world-1', 'entity-1');

      expect(result.success).toBe(true);
    });

    it('should throw for non-existent entity', async () => {
      entityManager.setMockError('delete', {
        code: 'ENTITY_NOT_FOUND',
        message: 'Entity not found',
      });

      try {
        await entityManager.delete('world-1', 'invalid-entity');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.code).toBe('ENTITY_NOT_FOUND');
      }
    });
  });

  describe('subscribe', () => {
    it('should subscribe to entity events', () => {
      const handler = vi.fn();

      const unsubscribe = entityManager.subscribe('world-1', { type: 'mesh' }, handler);

      expect(typeof unsubscribe).toBe('function');
    });

    it('should call handler on entity created event', async () => {
      const handler = vi.fn();

      entityManager.subscribe('world-1', { type: 'mesh' }, handler);
      entityManager.emitEvent('world-1', 'created', {
        id: 'new-entity',
        type: 'mesh',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
        properties: {},
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'created',
          entity: expect.objectContaining({ id: 'new-entity' }),
        })
      );
    });

    it('should call handler on entity modified event', async () => {
      const handler = vi.fn();

      entityManager.subscribe('world-1', {}, handler);
      entityManager.emitEvent('world-1', 'modified', {
        id: 'entity-1',
        type: 'mesh',
        position: { x: 10, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
        properties: {},
      }, { position: { x: 0, y: 0, z: 0 } });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'modified',
          entity: expect.objectContaining({ id: 'entity-1' }),
          previousValues: expect.objectContaining({ position: { x: 0, y: 0, z: 0 } }),
        })
      );
    });

    it('should call handler on entity deleted event', async () => {
      const handler = vi.fn();

      entityManager.subscribe('world-1', {}, handler);
      entityManager.emitEvent('world-1', 'deleted', { id: 'entity-1', type: 'mesh' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'deleted',
          entity: expect.objectContaining({ id: 'entity-1' }),
        })
      );
    });

    it('should filter events by type', async () => {
      const handler = vi.fn();

      entityManager.subscribe('world-1', { type: 'light' }, handler);
      entityManager.emitEvent('world-1', 'created', {
        id: 'mesh-1',
        type: 'mesh',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
        properties: {},
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should unsubscribe and stop receiving events', async () => {
      const handler = vi.fn();

      const unsubscribe = entityManager.subscribe('world-1', {}, handler);
      unsubscribe();

      entityManager.emitEvent('world-1', 'created', {
        id: 'new-entity',
        type: 'mesh',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
        properties: {},
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
