// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import crypto from 'crypto';
import type Database from 'better-sqlite3';
import type {
  EntityInstance,
  EntityPermissions,
  CreateEntityInput,
  UpdateEntityInput,
  EntityQueryOptions,
  EntityQueryResult,
  EntityTemplateRecord,
  CreateTemplateInput,
  TemplateListOptions,
  TemplateListResult,
  InstantiateTemplateInput,
} from './types.js';

const MAX_PROPERTIES_BYTES = 65536; // 64KB

interface EntityRow {
  id: string;
  type: string;
  parentId: string | null;
  posX: number; posY: number; posZ: number;
  rotX: number; rotY: number; rotZ: number; rotW: number;
  sclX: number; sclY: number; sclZ: number;
  properties: string | null;
  owner: string | null;
  permissions: string | null;
  frozen: number;
  createdAt: string;
  updatedAt: string;
}

interface TemplateRow {
  id: string;
  name: string;
  type: string;
  properties: string | null;
  components: string | null;
  defaultPosX: number | null; defaultPosY: number | null; defaultPosZ: number | null;
  defaultRotX: number | null; defaultRotY: number | null; defaultRotZ: number | null; defaultRotW: number | null;
  defaultSclX: number | null; defaultSclY: number | null; defaultSclZ: number | null;
  createdAt: string;
  updatedAt: string;
}

export class EntityStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ── Entity Instance CRUD ─────────────────────────────────────────

  createEntity(input: CreateEntityInput): EntityInstance {
    this.validateEntityInput(input);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const pos = input.position ?? { x: 0, y: 0, z: 0 };
    const rot = input.rotation ?? { x: 0, y: 0, z: 0, w: 1 };
    const scl = input.scale ?? { x: 1, y: 1, z: 1 };

    this.db.prepare(`
      INSERT INTO entity_instances
        (id, type, parentId, posX, posY, posZ, rotX, rotY, rotZ, rotW, sclX, sclY, sclZ,
         properties, owner, permissions, frozen, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.type,
      input.parentId ?? null,
      pos.x, pos.y, pos.z,
      rot.x, rot.y, rot.z, rot.w,
      scl.x, scl.y, scl.z,
      input.properties ? JSON.stringify(input.properties) : null,
      input.owner ?? null,
      input.permissions ? JSON.stringify(input.permissions) : null,
      input.frozen ? 1 : 0,
      now, now,
    );

    return this.rowToEntity(
      this.db.prepare('SELECT * FROM entity_instances WHERE id = ?').get(id) as EntityRow,
    );
  }

  getEntity(id: string): EntityInstance | null {
    const row = this.db.prepare('SELECT * FROM entity_instances WHERE id = ?').get(id) as EntityRow | undefined;
    if (!row) return null;

    const entity = this.rowToEntity(row);

    // Populate children IDs (F5)
    const children = this.db.prepare(
      'SELECT id FROM entity_instances WHERE parentId = ?'
    ).all(id) as { id: string }[];
    entity.children = children.map(c => c.id);

    return entity;
  }

  queryEntities(options?: EntityQueryOptions): EntityQueryResult {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }
    if (options?.parentId !== undefined) {
      if (options.parentId === null) {
        conditions.push('parentId IS NULL');
      } else {
        conditions.push('parentId = ?');
        params.push(options.parentId);
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    const total = (this.db.prepare(
      `SELECT COUNT(*) as c FROM entity_instances ${where}`
    ).get(...params) as { c: number }).c;

    const rows = this.db.prepare(
      `SELECT * FROM entity_instances ${where} LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as EntityRow[];

    return {
      entities: rows.map(r => this.rowToEntity(r)),
      total,
      limit,
      offset,
    };
  }

  updateEntity(id: string, input: UpdateEntityInput): EntityInstance | null {
    const existing = this.db.prepare('SELECT id FROM entity_instances WHERE id = ?').get(id);
    if (!existing) return null;

    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.position) {
      sets.push('posX = ?, posY = ?, posZ = ?');
      values.push(input.position.x, input.position.y, input.position.z);
    }
    if (input.rotation) {
      sets.push('rotX = ?, rotY = ?, rotZ = ?, rotW = ?');
      values.push(input.rotation.x, input.rotation.y, input.rotation.z, input.rotation.w);
    }
    if (input.scale) {
      sets.push('sclX = ?, sclY = ?, sclZ = ?');
      values.push(input.scale.x, input.scale.y, input.scale.z);
    }
    if (input.properties !== undefined) {
      sets.push('properties = ?');
      values.push(input.properties ? JSON.stringify(input.properties) : null);
    }
    if (input.owner !== undefined) {
      sets.push('owner = ?');
      values.push(input.owner);
    }
    if (input.permissions !== undefined) {
      sets.push('permissions = ?');
      values.push(input.permissions ? JSON.stringify(input.permissions) : null);
    }
    if (input.frozen !== undefined) {
      sets.push('frozen = ?');
      values.push(input.frozen ? 1 : 0);
    }

    if (sets.length > 0) {
      sets.push('updatedAt = ?');
      values.push(new Date().toISOString());
      this.db.prepare(`UPDATE entity_instances SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
    }

    return this.rowToEntity(
      this.db.prepare('SELECT * FROM entity_instances WHERE id = ?').get(id) as EntityRow,
    );
  }

  deleteEntity(id: string): boolean {
    const result = this.db.prepare('DELETE FROM entity_instances WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ── Entity Templates ─────────────────────────────────────────────

  createTemplate(input: CreateTemplateInput): EntityTemplateRecord {
    this.validateTemplateInput(input);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO entity_templates
        (id, name, type, properties, components,
         defaultPosX, defaultPosY, defaultPosZ,
         defaultRotX, defaultRotY, defaultRotZ, defaultRotW,
         defaultSclX, defaultSclY, defaultSclZ,
         createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.type,
      input.properties ? JSON.stringify(input.properties) : null,
      input.components ? JSON.stringify(input.components) : null,
      input.defaultPosition?.x ?? null, input.defaultPosition?.y ?? null, input.defaultPosition?.z ?? null,
      input.defaultRotation?.x ?? null, input.defaultRotation?.y ?? null, input.defaultRotation?.z ?? null, input.defaultRotation?.w ?? null,
      input.defaultScale?.x ?? null, input.defaultScale?.y ?? null, input.defaultScale?.z ?? null,
      now, now,
    );

    return this.rowToTemplate(
      this.db.prepare('SELECT * FROM entity_templates WHERE id = ?').get(id) as TemplateRow,
    );
  }

  getTemplate(id: string): EntityTemplateRecord | null {
    const row = this.db.prepare('SELECT * FROM entity_templates WHERE id = ?').get(id) as TemplateRow | undefined;
    return row ? this.rowToTemplate(row) : null;
  }

  listTemplates(options?: TemplateListOptions): TemplateListResult {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    const total = (this.db.prepare(
      `SELECT COUNT(*) as c FROM entity_templates ${where}`
    ).get(...params) as { c: number }).c;

    const rows = this.db.prepare(
      `SELECT * FROM entity_templates ${where} LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as TemplateRow[];

    return {
      templates: rows.map(r => this.rowToTemplate(r)),
      total,
      limit,
      offset,
    };
  }

  deleteTemplate(id: string): boolean {
    const result = this.db.prepare('DELETE FROM entity_templates WHERE id = ?').run(id);
    return result.changes > 0;
  }

  instantiateTemplate(templateId: string, overrides?: InstantiateTemplateInput): EntityInstance | null {
    const template = this.getTemplate(templateId);
    if (!template) return null;

    const input: CreateEntityInput = {
      type: template.type,
      position: overrides?.position ?? template.defaultPosition ?? undefined,
      rotation: overrides?.rotation ?? template.defaultRotation ?? undefined,
      scale: overrides?.scale ?? template.defaultScale ?? undefined,
      properties: overrides?.properties ?? template.properties ?? undefined,
      owner: overrides?.owner,
      parentId: overrides?.parentId,
    };

    return this.createEntity(input);
  }

  // ── Counts ───────────────────────────────────────────────────────

  getEntityCount(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM entity_instances').get() as { c: number }).c;
  }

  getEntityCountByType(): Record<string, number> {
    const rows = this.db.prepare(
      'SELECT type, COUNT(*) as c FROM entity_instances GROUP BY type'
    ).all() as { type: string; c: number }[];

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.type] = row.c;
    }
    return result;
  }

  getTemplateCount(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM entity_templates').get() as { c: number }).c;
  }

  // ── Private ──────────────────────────────────────────────────────

  private validateEntityInput(input: CreateEntityInput): void {
    if (!input.type || input.type.length < 1 || input.type.length > 100) {
      throw new Error('Entity type must be between 1 and 100 characters');
    }
    if (input.properties) {
      const json = JSON.stringify(input.properties);
      if (json.length > MAX_PROPERTIES_BYTES) {
        throw new Error(`Entity properties JSON exceeds maximum size of ${MAX_PROPERTIES_BYTES} bytes`);
      }
    }
  }

  private validateTemplateInput(input: CreateTemplateInput): void {
    if (!input.name || input.name.length < 1 || input.name.length > 100) {
      throw new Error('Template name must be between 1 and 100 characters');
    }
    if (!input.type || input.type.length < 1 || input.type.length > 100) {
      throw new Error('Template type must be between 1 and 100 characters');
    }
  }

  private rowToEntity(row: EntityRow): EntityInstance {
    return {
      id: row.id,
      type: row.type,
      parentId: row.parentId,
      position: { x: row.posX, y: row.posY, z: row.posZ },
      rotation: { x: row.rotX, y: row.rotY, z: row.rotZ, w: row.rotW },
      scale: { x: row.sclX, y: row.sclY, z: row.sclZ },
      properties: row.properties ? JSON.parse(row.properties) : null,
      owner: row.owner,
      permissions: row.permissions ? JSON.parse(row.permissions) as EntityPermissions : null,
      frozen: !!row.frozen,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private rowToTemplate(row: TemplateRow): EntityTemplateRecord {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      properties: row.properties ? JSON.parse(row.properties) : null,
      components: row.components ? JSON.parse(row.components) : null,
      defaultPosition: row.defaultPosX !== null ? { x: row.defaultPosX, y: row.defaultPosY!, z: row.defaultPosZ! } : null,
      defaultRotation: row.defaultRotX !== null ? { x: row.defaultRotX, y: row.defaultRotY!, z: row.defaultRotZ!, w: row.defaultRotW! } : null,
      defaultScale: row.defaultSclX !== null ? { x: row.defaultSclX, y: row.defaultSclY!, z: row.defaultSclZ! } : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
