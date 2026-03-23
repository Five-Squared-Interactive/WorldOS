// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import type { WorldMetadata, EntityInstance } from './types.js';

type PermissionLevel = 'read' | 'write' | 'admin';

/**
 * Check if a user has the given permission level on a world.
 *
 * Rules:
 * - World owner always has admin access
 * - Identity role 'admin' bypasses all checks
 * - Identity role 'guest' can only read (never write/admin)
 * - User in admin list → admin+write+read
 * - User in write list → write+read
 * - User in read list → read
 * - Empty read list = public read access
 */
export function checkWorldPermission(
  world: WorldMetadata,
  userId: string,
  identityRole: string,
  level: PermissionLevel,
): boolean {
  // Identity admin bypasses all
  if (identityRole === 'admin') return true;

  // World owner is always admin
  if (userId === world.owner) return true;

  // Guest can only read
  if (identityRole === 'guest' && level !== 'read') return false;

  const perms = world.permissions;

  // Check from highest permission down
  if (perms.admin.includes(userId)) return true; // admin implies all

  if (level === 'admin') return false; // not in admin list

  if (perms.write.includes(userId)) return true; // write implies read

  if (level === 'write') return false; // not in write list

  // Read check
  if (perms.read.length === 0) return true; // public read
  return perms.read.includes(userId);
}

/**
 * Check entity-level permissions.
 *
 * Rules:
 * - Identity role 'admin' bypasses all entity permissions
 * - If entity has no permissions set → default open (anyone can read/write)
 * - Entity owner: check ownerRead/ownerWrite
 * - Non-owner: check otherRead/otherWrite
 */
export function checkEntityPermission(
  entity: EntityInstance,
  userId: string,
  identityRole: string,
  level: 'read' | 'write',
): boolean {
  // Admin bypasses entity permissions
  if (identityRole === 'admin') return true;

  // No permissions set = default open
  if (!entity.permissions) return true;

  const isOwner = entity.owner === userId;

  if (isOwner) {
    return level === 'read' ? entity.permissions.ownerRead : entity.permissions.ownerWrite;
  }

  return level === 'read' ? entity.permissions.otherRead : entity.permissions.otherWrite;
}
