// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

/**
 * Fixed roles for MVP — no dynamic registration.
 */
export type Role = 'admin' | 'user' | 'guest';

/**
 * Actions that can be checked against the permission matrix.
 */
export type Action = 'read' | 'create' | 'update' | 'delete' | 'manage-users' | 'manage-roles';

/**
 * Role hierarchy — higher number = more privileges.
 */
export const ROLE_HIERARCHY: Record<Role, number> = {
  guest: 0,
  user: 1,
  admin: 2,
};

/**
 * Permission matrix: which actions each role can perform.
 */
const PERMISSION_MATRIX: Record<Role, Set<Action>> = {
  admin: new Set(['read', 'create', 'update', 'delete', 'manage-users', 'manage-roles']),
  user: new Set(['read', 'create', 'update']),
  guest: new Set(['read']),
};

/**
 * Check if a role has a specific permission.
 */
export function hasPermission(role: Role, action: Action): boolean {
  return PERMISSION_MATRIX[role]?.has(action) ?? false;
}

/**
 * Check if a role meets or exceeds a minimum required role.
 */
export function isRoleAtLeast(role: Role, minimumRole: Role): boolean {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[minimumRole];
}

/**
 * Check if a user can access a specific resource, considering ownership.
 * Admin bypasses ownership checks. Users can update their own resources.
 * Guests can only read.
 */
export function canAccessResource(
  role: Role,
  resourceOwnerId: string,
  requestingUserId: string,
  action: Action
): boolean {
  // Admin can do anything
  if (role === 'admin') return true;

  // Check base permission first
  if (!hasPermission(role, action)) return false;

  // For write actions (update), users must own the resource
  if (action === 'update' && role === 'user') {
    return resourceOwnerId === requestingUserId;
  }

  return true;
}
