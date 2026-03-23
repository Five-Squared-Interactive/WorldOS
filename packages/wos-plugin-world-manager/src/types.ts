// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

/**
 * World Manager Plugin - Shared Types
 *
 * Plugin-local server-side types. These are intentionally different from
 * the client-side types in @worldos/world (e.g. permissions use userId
 * arrays instead of booleans, timestamps are ISO strings not Dates).
 */

// ── World Types ──────────────────────────────────────────────────────

export type WorldType = 'space' | 'planet' | 'mini-world' | 'custom';

export interface WorldPermissions {
  read: string[];   // userIds (empty = public read)
  write: string[];  // userIds
  admin: string[];  // userIds
}

export interface WorldMetadata {
  id: string;
  name: string;
  description?: string;
  owner: string;
  type: WorldType;
  permissions: WorldPermissions;
  avatarSettings?: Record<string, unknown>;
  spawnConfig?: Record<string, unknown>;
  skyConfig?: Record<string, unknown>;
  gravity: boolean;
  templateName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorldSettings {
  avatarSettings?: Record<string, unknown>;
  spawnConfig?: Record<string, unknown>;
  skyConfig?: Record<string, unknown>;
  gravity?: boolean;
}

export interface InitWorldInput {
  name: string;
  description?: string;
  owner: string;
  type: WorldType;
  permissions?: Partial<WorldPermissions>;
  template?: string;
  settings?: WorldSettings;
}

// ── Entity Types ─────────────────────────────────────────────────────

export interface EntityPermissions {
  ownerRead: boolean;
  ownerWrite: boolean;
  otherRead: boolean;
  otherWrite: boolean;
}

export interface EntityInstance {
  id: string;
  type: string;
  parentId: string | null;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  scale: { x: number; y: number; z: number };
  properties: Record<string, unknown> | null;
  owner: string | null;
  permissions: EntityPermissions | null;
  frozen: boolean;
  children?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateEntityInput {
  type: string;
  parentId?: string;
  position?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number; w: number };
  scale?: { x: number; y: number; z: number };
  properties?: Record<string, unknown>;
  owner?: string;
  permissions?: EntityPermissions;
  frozen?: boolean;
}

export interface UpdateEntityInput {
  position?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number; w: number };
  scale?: { x: number; y: number; z: number };
  properties?: Record<string, unknown>;
  owner?: string;
  permissions?: EntityPermissions;
  frozen?: boolean;
}

export interface EntityQueryOptions {
  type?: string;
  parentId?: string | null;
  limit?: number;
  offset?: number;
}

export interface EntityQueryResult {
  entities: EntityInstance[];
  total: number;
  limit: number;
  offset: number;
}

// ── Template Types ───────────────────────────────────────────────────

export interface EntityTemplateRecord {
  id: string;
  name: string;
  type: string;
  properties: Record<string, unknown> | null;
  components: string[] | null;
  defaultPosition: { x: number; y: number; z: number } | null;
  defaultRotation: { x: number; y: number; z: number; w: number } | null;
  defaultScale: { x: number; y: number; z: number } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateInput {
  name: string;
  type: string;
  properties?: Record<string, unknown>;
  components?: string[];
  defaultPosition?: { x: number; y: number; z: number };
  defaultRotation?: { x: number; y: number; z: number; w: number };
  defaultScale?: { x: number; y: number; z: number };
}

export interface TemplateListOptions {
  type?: string;
  limit?: number;
  offset?: number;
}

export interface TemplateListResult {
  templates: EntityTemplateRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface InstantiateTemplateInput {
  position?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number; w: number };
  scale?: { x: number; y: number; z: number };
  properties?: Record<string, unknown>;
  owner?: string;
  parentId?: string;
}

// ── World Template Types ─────────────────────────────────────────────

export interface WorldTemplateInfo {
  name: string;
  description: string;
  allowedTypes: WorldType[];
  file: string;
}

export interface WorldTemplatesConfig {
  templates: WorldTemplateInfo[];
}

export interface WorldTemplateData {
  metadata: {
    name: string;
    description?: string;
    type: WorldType;
    settings?: WorldSettings;
  };
  entityTemplates?: CreateTemplateInput[];
  entities?: (CreateEntityInput & { templateName?: string })[];
}

// ── Validation Result ────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  error?: string;
}
