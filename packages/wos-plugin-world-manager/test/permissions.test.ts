// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import {
  checkWorldPermission,
  checkEntityPermission,
} from '../src/permissions.js';
import type { WorldMetadata, EntityInstance } from '../src/types.js';

const makeWorld = (overrides?: Partial<WorldMetadata>): WorldMetadata => ({
  id: 'world-1',
  name: 'Test',
  owner: 'owner-1',
  type: 'space',
  permissions: { read: [], write: [], admin: [] },
  gravity: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeEntity = (overrides?: Partial<EntityInstance>): EntityInstance => ({
  id: 'entity-1',
  type: 'mesh',
  parentId: null,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
  properties: null,
  owner: 'entity-owner',
  permissions: null,
  frozen: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('Permissions', () => {
  describe('checkWorldPermission', () => {
    it('owner always has admin access', () => {
      const world = makeWorld();
      expect(checkWorldPermission(world, 'owner-1', 'user', 'admin')).toBe(true);
      expect(checkWorldPermission(world, 'owner-1', 'user', 'write')).toBe(true);
      expect(checkWorldPermission(world, 'owner-1', 'user', 'read')).toBe(true);
    });

    it('identity admin role grants full access', () => {
      const world = makeWorld();
      expect(checkWorldPermission(world, 'random-user', 'admin', 'admin')).toBe(true);
      expect(checkWorldPermission(world, 'random-user', 'admin', 'write')).toBe(true);
      expect(checkWorldPermission(world, 'random-user', 'admin', 'read')).toBe(true);
    });

    it('user in read list can read', () => {
      const world = makeWorld({ permissions: { read: ['user-2'], write: [], admin: [] } });
      expect(checkWorldPermission(world, 'user-2', 'user', 'read')).toBe(true);
    });

    it('user in write list can write', () => {
      const world = makeWorld({ permissions: { read: [], write: ['user-2'], admin: [] } });
      expect(checkWorldPermission(world, 'user-2', 'user', 'write')).toBe(true);
    });

    it('user in admin list has admin access', () => {
      const world = makeWorld({ permissions: { read: [], write: [], admin: ['user-2'] } });
      expect(checkWorldPermission(world, 'user-2', 'user', 'admin')).toBe(true);
    });

    it('admin permission implies write and read', () => {
      const world = makeWorld({ permissions: { read: [], write: [], admin: ['user-2'] } });
      expect(checkWorldPermission(world, 'user-2', 'user', 'write')).toBe(true);
      expect(checkWorldPermission(world, 'user-2', 'user', 'read')).toBe(true);
    });

    it('write permission implies read', () => {
      const world = makeWorld({ permissions: { read: [], write: ['user-2'], admin: [] } });
      expect(checkWorldPermission(world, 'user-2', 'user', 'read')).toBe(true);
    });

    it('user not in any list denied (non-owner)', () => {
      const world = makeWorld({ permissions: { read: ['other'], write: ['other'], admin: [] } });
      expect(checkWorldPermission(world, 'user-2', 'user', 'write')).toBe(false);
      expect(checkWorldPermission(world, 'user-2', 'user', 'admin')).toBe(false);
    });

    it('empty read list = public read', () => {
      const world = makeWorld({ permissions: { read: [], write: [], admin: [] } });
      expect(checkWorldPermission(world, 'anyone', 'user', 'read')).toBe(true);
      expect(checkWorldPermission(world, 'anyone', 'guest', 'read')).toBe(true);
    });

    it('non-empty read list restricts read access', () => {
      const world = makeWorld({ permissions: { read: ['user-2'], write: [], admin: [] } });
      expect(checkWorldPermission(world, 'user-3', 'user', 'read')).toBe(false);
    });

    it('guest role gets read-only on public worlds', () => {
      const world = makeWorld();
      expect(checkWorldPermission(world, 'guest-1', 'guest', 'read')).toBe(true);
      expect(checkWorldPermission(world, 'guest-1', 'guest', 'write')).toBe(false);
    });
  });

  describe('checkEntityPermission', () => {
    it('entity with no permissions = default open', () => {
      const entity = makeEntity({ permissions: null });
      expect(checkEntityPermission(entity, 'anyone', 'user', 'read')).toBe(true);
      expect(checkEntityPermission(entity, 'anyone', 'user', 'write')).toBe(true);
    });

    it('entity owner can read/write own entity', () => {
      const entity = makeEntity({
        owner: 'user-1',
        permissions: { ownerRead: true, ownerWrite: true, otherRead: false, otherWrite: false },
      });
      expect(checkEntityPermission(entity, 'user-1', 'user', 'read')).toBe(true);
      expect(checkEntityPermission(entity, 'user-1', 'user', 'write')).toBe(true);
    });

    it('non-owner blocked by otherWrite: false (F8)', () => {
      const entity = makeEntity({
        owner: 'user-1',
        permissions: { ownerRead: true, ownerWrite: true, otherRead: true, otherWrite: false },
      });
      expect(checkEntityPermission(entity, 'user-2', 'user', 'write')).toBe(false);
    });

    it('non-owner allowed by otherWrite: true', () => {
      const entity = makeEntity({
        owner: 'user-1',
        permissions: { ownerRead: true, ownerWrite: true, otherRead: true, otherWrite: true },
      });
      expect(checkEntityPermission(entity, 'user-2', 'user', 'write')).toBe(true);
    });

    it('non-owner blocked by otherRead: false', () => {
      const entity = makeEntity({
        owner: 'user-1',
        permissions: { ownerRead: true, ownerWrite: true, otherRead: false, otherWrite: false },
      });
      expect(checkEntityPermission(entity, 'user-2', 'user', 'read')).toBe(false);
    });

    it('world admin bypasses entity permissions', () => {
      const entity = makeEntity({
        owner: 'user-1',
        permissions: { ownerRead: true, ownerWrite: true, otherRead: false, otherWrite: false },
      });
      expect(checkEntityPermission(entity, 'admin-user', 'admin', 'read')).toBe(true);
      expect(checkEntityPermission(entity, 'admin-user', 'admin', 'write')).toBe(true);
    });
  });
});
