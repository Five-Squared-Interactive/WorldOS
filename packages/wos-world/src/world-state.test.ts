/**
 * World State API Tests
 *
 * Story 9.4: World Metadata API
 * Story 9.7: World Lifecycle Events
 *
 * Tests for world metadata and lifecycle management.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WorldManager,
  WorldMetadata,
  WorldPermissions,
  WorldType,
  WorldLifecycleEvent,
} from './world-state.js';

describe('World State API', () => {
  let worldManager: WorldManager;
  let mockMqttClient: any;

  beforeEach(() => {
    mockMqttClient = {
      publish: vi.fn(),
      subscribe: vi.fn(),
      on: vi.fn(),
    };
    worldManager = new WorldManager(mockMqttClient);
  });

  describe('WorldMetadata types', () => {
    it('should define WorldMetadata interface', () => {
      const metadata: WorldMetadata = {
        id: 'world-1',
        name: 'Test World',
        owner: 'user-123',
        type: 'space',
        permissions: {
          read: true,
          write: true,
          admin: false,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(metadata.id).toBe('world-1');
      expect(metadata.type).toBe('space');
    });

    it('should define WorldPermissions interface', () => {
      const permissions: WorldPermissions = {
        read: true,
        write: false,
        admin: false,
      };

      expect(permissions.read).toBe(true);
      expect(permissions.write).toBe(false);
    });

    it('should support space world type', () => {
      const type: WorldType = 'space';
      expect(type).toBe('space');
    });

    it('should support planet world type', () => {
      const type: WorldType = 'planet';
      expect(type).toBe('planet');
    });

    it('should support custom world type', () => {
      const type: WorldType = 'custom';
      expect(type).toBe('custom');
    });
  });

  describe('WorldManager', () => {
    it('should create world manager', () => {
      expect(worldManager).toBeDefined();
    });

    it('should have getMetadata method', () => {
      expect(typeof worldManager.getMetadata).toBe('function');
    });

    it('should have listWorlds method', () => {
      expect(typeof worldManager.listWorlds).toBe('function');
    });

    it('should have onLifecycle method', () => {
      expect(typeof worldManager.onLifecycle).toBe('function');
    });
  });

  describe('getMetadata', () => {
    it('should get world metadata', async () => {
      worldManager.setMockResponse('getMetadata', {
        id: 'world-1',
        name: 'Test World',
        owner: 'user-123',
        type: 'space',
        permissions: { read: true, write: true, admin: false },
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-02-01'),
      });

      const metadata = await worldManager.getMetadata('world-1');

      expect(metadata.id).toBe('world-1');
      expect(metadata.name).toBe('Test World');
      expect(metadata.owner).toBe('user-123');
    });

    it('should include world type', async () => {
      worldManager.setMockResponse('getMetadata', {
        id: 'world-1',
        name: 'Planet World',
        owner: 'user-123',
        type: 'planet',
        permissions: { read: true, write: false, admin: false },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const metadata = await worldManager.getMetadata('world-1');

      expect(metadata.type).toBe('planet');
    });

    it('should include permissions', async () => {
      worldManager.setMockResponse('getMetadata', {
        id: 'world-1',
        name: 'Test World',
        owner: 'user-123',
        type: 'space',
        permissions: { read: true, write: true, admin: true },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const metadata = await worldManager.getMetadata('world-1');

      expect(metadata.permissions.read).toBe(true);
      expect(metadata.permissions.write).toBe(true);
      expect(metadata.permissions.admin).toBe(true);
    });

    it('should include timestamps', async () => {
      const createdAt = new Date('2026-01-01');
      const updatedAt = new Date('2026-02-15');

      worldManager.setMockResponse('getMetadata', {
        id: 'world-1',
        name: 'Test World',
        owner: 'user-123',
        type: 'space',
        permissions: { read: true, write: false, admin: false },
        createdAt,
        updatedAt,
      });

      const metadata = await worldManager.getMetadata('world-1');

      expect(metadata.createdAt).toEqual(createdAt);
      expect(metadata.updatedAt).toEqual(updatedAt);
    });

    it('should throw error for non-existent world', async () => {
      worldManager.setMockError('getMetadata', {
        code: 'WORLD_NOT_FOUND',
        message: 'World not found',
      });

      try {
        await worldManager.getMetadata('invalid-world');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.code).toBe('WORLD_NOT_FOUND');
      }
    });
  });

  describe('listWorlds', () => {
    it('should list all accessible worlds', async () => {
      worldManager.setMockResponse('listWorlds', {
        worlds: [
          { id: 'world-1', name: 'World 1', type: 'space' },
          { id: 'world-2', name: 'World 2', type: 'planet' },
        ],
        total: 2,
      });

      const result = await worldManager.listWorlds();

      expect(result.worlds.length).toBe(2);
      expect(result.total).toBe(2);
    });

    it('should support pagination', async () => {
      worldManager.setMockResponse('listWorlds', {
        worlds: [{ id: 'world-1', name: 'World 1', type: 'space' }],
        total: 10,
        limit: 1,
        offset: 0,
      });

      const result = await worldManager.listWorlds({ limit: 1 });

      expect(result.worlds.length).toBe(1);
      expect(result.total).toBe(10);
    });

    it('should filter by type', async () => {
      worldManager.setMockResponse('listWorlds', {
        worlds: [{ id: 'world-1', name: 'Planet 1', type: 'planet' }],
        total: 1,
      });

      const result = await worldManager.listWorlds({ type: 'planet' });

      expect(result.worlds.every(w => w.type === 'planet')).toBe(true);
    });
  });

  describe('getLoadedWorlds', () => {
    it('should return currently loaded worlds', async () => {
      worldManager.setMockResponse('getLoadedWorlds', ['world-1', 'world-2']);

      const loaded = await worldManager.getLoadedWorlds();

      expect(loaded).toContain('world-1');
      expect(loaded).toContain('world-2');
    });

    it('should return empty array when no worlds loaded', async () => {
      worldManager.setMockResponse('getLoadedWorlds', []);

      const loaded = await worldManager.getLoadedWorlds();

      expect(loaded).toEqual([]);
    });
  });

  describe('lifecycle events', () => {
    it('should subscribe to lifecycle events', () => {
      const handler = vi.fn();

      const unsubscribe = worldManager.onLifecycle(handler);

      expect(typeof unsubscribe).toBe('function');
    });

    it('should receive world created event', () => {
      const handler = vi.fn();

      worldManager.onLifecycle(handler);
      worldManager.emitLifecycleEvent('created', 'world-1', {
        id: 'world-1',
        name: 'New World',
        type: 'space',
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'created',
          worldId: 'world-1',
        })
      );
    });

    it('should receive world loaded event', () => {
      const handler = vi.fn();

      worldManager.onLifecycle(handler);
      worldManager.emitLifecycleEvent('loaded', 'world-1', {
        id: 'world-1',
        name: 'Loaded World',
        type: 'space',
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'loaded',
          worldId: 'world-1',
          metadata: expect.objectContaining({ name: 'Loaded World' }),
        })
      );
    });

    it('should receive world unloaded event', () => {
      const handler = vi.fn();

      worldManager.onLifecycle(handler);
      worldManager.emitLifecycleEvent('unloaded', 'world-1');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'unloaded',
          worldId: 'world-1',
        })
      );
    });

    it('should receive world deleted event', () => {
      const handler = vi.fn();

      worldManager.onLifecycle(handler);
      worldManager.emitLifecycleEvent('deleted', 'world-1');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'deleted',
          worldId: 'world-1',
        })
      );
    });

    it('should unsubscribe from lifecycle events', () => {
      const handler = vi.fn();

      const unsubscribe = worldManager.onLifecycle(handler);
      unsubscribe();

      worldManager.emitLifecycleEvent('loaded', 'world-1');

      expect(handler).not.toHaveBeenCalled();
    });

    it('should include metadata in loaded event', () => {
      const handler = vi.fn();

      worldManager.onLifecycle(handler);
      worldManager.emitLifecycleEvent('loaded', 'world-1', {
        id: 'world-1',
        name: 'Test World',
        type: 'planet',
        owner: 'user-123',
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            name: 'Test World',
            type: 'planet',
          }),
        })
      );
    });
  });

  describe('checkPermission', () => {
    it('should check read permission', async () => {
      worldManager.setMockResponse('getMetadata', {
        id: 'world-1',
        name: 'Test World',
        owner: 'user-123',
        type: 'space',
        permissions: { read: true, write: false, admin: false },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const canRead = await worldManager.checkPermission('world-1', 'read');

      expect(canRead).toBe(true);
    });

    it('should check write permission', async () => {
      worldManager.setMockResponse('getMetadata', {
        id: 'world-1',
        name: 'Test World',
        owner: 'user-123',
        type: 'space',
        permissions: { read: true, write: false, admin: false },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const canWrite = await worldManager.checkPermission('world-1', 'write');

      expect(canWrite).toBe(false);
    });

    it('should check admin permission', async () => {
      worldManager.setMockResponse('getMetadata', {
        id: 'world-1',
        name: 'Test World',
        owner: 'user-123',
        type: 'space',
        permissions: { read: true, write: true, admin: true },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const canAdmin = await worldManager.checkPermission('world-1', 'admin');

      expect(canAdmin).toBe(true);
    });
  });
});
