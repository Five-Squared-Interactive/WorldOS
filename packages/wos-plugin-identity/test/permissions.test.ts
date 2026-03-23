// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import {
  hasPermission,
  isRoleAtLeast,
  canAccessResource,
  ROLE_HIERARCHY,
  type Role,
  type Action,
} from '../src/permissions.js';

describe('Permissions', () => {
  describe('ROLE_HIERARCHY', () => {
    it('should rank admin > user > guest', () => {
      expect(ROLE_HIERARCHY.admin).toBeGreaterThan(ROLE_HIERARCHY.user);
      expect(ROLE_HIERARCHY.user).toBeGreaterThan(ROLE_HIERARCHY.guest);
    });
  });

  describe('isRoleAtLeast', () => {
    it('should return true when role meets minimum', () => {
      expect(isRoleAtLeast('admin', 'admin')).toBe(true);
      expect(isRoleAtLeast('admin', 'user')).toBe(true);
      expect(isRoleAtLeast('admin', 'guest')).toBe(true);
      expect(isRoleAtLeast('user', 'user')).toBe(true);
      expect(isRoleAtLeast('user', 'guest')).toBe(true);
      expect(isRoleAtLeast('guest', 'guest')).toBe(true);
    });

    it('should return false when role is below minimum', () => {
      expect(isRoleAtLeast('guest', 'user')).toBe(false);
      expect(isRoleAtLeast('guest', 'admin')).toBe(false);
      expect(isRoleAtLeast('user', 'admin')).toBe(false);
    });
  });

  describe('hasPermission', () => {
    // Admin can do anything
    it('admin should have all permissions', () => {
      expect(hasPermission('admin', 'read')).toBe(true);
      expect(hasPermission('admin', 'create')).toBe(true);
      expect(hasPermission('admin', 'update')).toBe(true);
      expect(hasPermission('admin', 'delete')).toBe(true);
      expect(hasPermission('admin', 'manage-users')).toBe(true);
      expect(hasPermission('admin', 'manage-roles')).toBe(true);
    });

    // User can read, create, update own
    it('user should have read and create permissions', () => {
      expect(hasPermission('user', 'read')).toBe(true);
      expect(hasPermission('user', 'create')).toBe(true);
      expect(hasPermission('user', 'update')).toBe(true);
    });

    it('user should not have delete or manage permissions', () => {
      expect(hasPermission('user', 'delete')).toBe(false);
      expect(hasPermission('user', 'manage-users')).toBe(false);
      expect(hasPermission('user', 'manage-roles')).toBe(false);
    });

    // Guest can only read
    it('guest should only have read permission', () => {
      expect(hasPermission('guest', 'read')).toBe(true);
      expect(hasPermission('guest', 'create')).toBe(false);
      expect(hasPermission('guest', 'update')).toBe(false);
      expect(hasPermission('guest', 'delete')).toBe(false);
      expect(hasPermission('guest', 'manage-users')).toBe(false);
      expect(hasPermission('guest', 'manage-roles')).toBe(false);
    });
  });

  describe('canAccessResource', () => {
    it('admin can access any resource regardless of ownership', () => {
      expect(canAccessResource('admin', 'owner-1', 'admin-1', 'update')).toBe(true);
      expect(canAccessResource('admin', 'owner-1', 'admin-1', 'delete')).toBe(true);
    });

    it('user can read any resource', () => {
      expect(canAccessResource('user', 'other-user', 'user-1', 'read')).toBe(true);
    });

    it('user can update own resource', () => {
      expect(canAccessResource('user', 'user-1', 'user-1', 'update')).toBe(true);
    });

    it('user cannot update another users resource', () => {
      expect(canAccessResource('user', 'other-user', 'user-1', 'update')).toBe(false);
    });

    it('user cannot delete any resource', () => {
      expect(canAccessResource('user', 'user-1', 'user-1', 'delete')).toBe(false);
      expect(canAccessResource('user', 'other-user', 'user-1', 'delete')).toBe(false);
    });

    it('guest can read resources', () => {
      expect(canAccessResource('guest', 'owner-1', 'guest-1', 'read')).toBe(true);
    });

    it('guest cannot modify any resource', () => {
      expect(canAccessResource('guest', 'guest-1', 'guest-1', 'update')).toBe(false);
      expect(canAccessResource('guest', 'guest-1', 'guest-1', 'create')).toBe(false);
    });
  });
});
