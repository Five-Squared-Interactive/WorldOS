// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import crypto from 'crypto';
import type Database from 'better-sqlite3';
import type {
  WorldMetadata,
  WorldPermissions,
  WorldSettings,
  InitWorldInput,
  WorldType,
} from './types.js';

const VALID_WORLD_TYPES: WorldType[] = ['space', 'planet', 'mini-world', 'custom'];

const DDL = `
  CREATE TABLE IF NOT EXISTS world_metadata (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
    description TEXT CHECK(description IS NULL OR length(description) <= 1000),
    owner TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('space', 'planet', 'mini-world', 'custom')),
    permissions TEXT NOT NULL,
    avatarSettings TEXT,
    spawnConfig TEXT,
    skyConfig TEXT,
    gravity INTEGER DEFAULT 1 CHECK(gravity IN (0, 1)),
    templateName TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TRIGGER IF NOT EXISTS world_metadata_single_row
  BEFORE INSERT ON world_metadata
  WHEN (SELECT COUNT(*) FROM world_metadata) >= 1
  BEGIN
    SELECT RAISE(ABORT, 'world_metadata allows only one row');
  END;

  CREATE TABLE IF NOT EXISTS entity_instances (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(length(type) BETWEEN 1 AND 100),
    parentId TEXT REFERENCES entity_instances(id) ON DELETE SET NULL,
    posX REAL DEFAULT 0, posY REAL DEFAULT 0, posZ REAL DEFAULT 0,
    rotX REAL DEFAULT 0, rotY REAL DEFAULT 0, rotZ REAL DEFAULT 0, rotW REAL DEFAULT 1,
    sclX REAL DEFAULT 1, sclY REAL DEFAULT 1, sclZ REAL DEFAULT 1,
    properties TEXT,
    owner TEXT,
    permissions TEXT,
    frozen INTEGER DEFAULT 0 CHECK(frozen IN (0, 1)),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_entity_parent ON entity_instances(parentId);
  CREATE INDEX IF NOT EXISTS idx_entity_type ON entity_instances(type);
  CREATE INDEX IF NOT EXISTS idx_entity_position ON entity_instances(posX, posY, posZ);

  CREATE TABLE IF NOT EXISTS entity_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 100),
    type TEXT NOT NULL CHECK(length(type) BETWEEN 1 AND 100),
    properties TEXT,
    components TEXT,
    defaultPosX REAL, defaultPosY REAL, defaultPosZ REAL,
    defaultRotX REAL, defaultRotY REAL, defaultRotZ REAL, defaultRotW REAL,
    defaultSclX REAL, defaultSclY REAL, defaultSclZ REAL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`;

interface MetadataRow {
  id: string;
  name: string;
  description: string | null;
  owner: string;
  type: string;
  permissions: string;
  avatarSettings: string | null;
  spawnConfig: string | null;
  skyConfig: string | null;
  gravity: number;
  templateName: string | null;
  createdAt: string;
  updatedAt: string;
}

export class WorldStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(DDL);
  }

  isInitialized(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM world_metadata').get() as { c: number };
    return row.c > 0;
  }

  initWorld(input: InitWorldInput): WorldMetadata {
    this.validateInput(input);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const permissions: WorldPermissions = {
      read: input.permissions?.read ?? [],
      write: input.permissions?.write ?? [],
      admin: input.permissions?.admin ?? [],
    };

    const gravity = input.settings?.gravity !== undefined ? input.settings.gravity : true;

    this.db.prepare(`
      INSERT INTO world_metadata (id, name, description, owner, type, permissions,
        avatarSettings, spawnConfig, skyConfig, gravity, templateName, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.description ?? null,
      input.owner,
      input.type,
      JSON.stringify(permissions),
      input.settings?.avatarSettings ? JSON.stringify(input.settings.avatarSettings) : null,
      input.settings?.spawnConfig ? JSON.stringify(input.settings.spawnConfig) : null,
      input.settings?.skyConfig ? JSON.stringify(input.settings.skyConfig) : null,
      gravity ? 1 : 0,
      input.template ?? null,
      now,
      now,
    );

    return this.getMetadata()!;
  }

  getMetadata(): WorldMetadata | null {
    const row = this.db.prepare('SELECT * FROM world_metadata').get() as MetadataRow | undefined;
    if (!row) return null;
    return this.rowToMetadata(row);
  }

  updateMetadata(fields: {
    name?: string;
    description?: string;
    settings?: WorldSettings;
  }): WorldMetadata {
    if (!this.isInitialized()) {
      throw new Error('No world initialized');
    }

    const sets: string[] = [];
    const values: unknown[] = [];

    if (fields.name !== undefined) {
      sets.push('name = ?');
      values.push(fields.name);
    }
    if (fields.description !== undefined) {
      sets.push('description = ?');
      values.push(fields.description);
    }
    if (fields.settings) {
      if (fields.settings.avatarSettings !== undefined) {
        sets.push('avatarSettings = ?');
        values.push(JSON.stringify(fields.settings.avatarSettings));
      }
      if (fields.settings.spawnConfig !== undefined) {
        sets.push('spawnConfig = ?');
        values.push(JSON.stringify(fields.settings.spawnConfig));
      }
      if (fields.settings.skyConfig !== undefined) {
        sets.push('skyConfig = ?');
        values.push(JSON.stringify(fields.settings.skyConfig));
      }
      if (fields.settings.gravity !== undefined) {
        sets.push('gravity = ?');
        values.push(fields.settings.gravity ? 1 : 0);
      }
    }

    if (sets.length > 0) {
      sets.push('updatedAt = ?');
      values.push(new Date().toISOString());
      this.db.prepare(`UPDATE world_metadata SET ${sets.join(', ')}`).run(...values);
    }

    return this.getMetadata()!;
  }

  updatePermissions(permissions: WorldPermissions): void {
    if (!this.isInitialized()) {
      throw new Error('No world initialized');
    }

    this.db.prepare('UPDATE world_metadata SET permissions = ?, updatedAt = ?').run(
      JSON.stringify(permissions),
      new Date().toISOString(),
    );
  }

  resetWorld(input: InitWorldInput): WorldMetadata {
    if (!this.isInitialized()) {
      throw new Error('No world initialized to reset');
    }

    this.validateInput(input);

    const reset = this.db.transaction(() => {
      this.db.prepare('DELETE FROM entity_instances').run();
      this.db.prepare('DELETE FROM entity_templates').run();
      this.db.prepare('DELETE FROM world_metadata').run();

      return this.initWorld(input);
    });

    return reset();
  }

  close(): void {
    this.db.close();
  }

  /** Get the raw database instance (for EntityStore to share) */
  getDb(): Database.Database {
    return this.db;
  }

  private validateInput(input: InitWorldInput): void {
    if (!input.name || input.name.length < 1 || input.name.length > 100) {
      throw new Error('World name must be between 1 and 100 characters');
    }
    if (input.description && input.description.length > 1000) {
      throw new Error('World description must be 1000 characters or fewer');
    }
    if (!VALID_WORLD_TYPES.includes(input.type)) {
      throw new Error(`Invalid world type: ${input.type}`);
    }
  }

  private rowToMetadata(row: MetadataRow): WorldMetadata {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      owner: row.owner,
      type: row.type as WorldType,
      permissions: JSON.parse(row.permissions),
      avatarSettings: row.avatarSettings ? JSON.parse(row.avatarSettings) : undefined,
      spawnConfig: row.spawnConfig ? JSON.parse(row.spawnConfig) : undefined,
      skyConfig: row.skyConfig ? JSON.parse(row.skyConfig) : undefined,
      gravity: !!row.gravity,
      templateName: row.templateName ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
