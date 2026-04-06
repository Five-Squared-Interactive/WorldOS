// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import type { Logger } from '@worldos/plugin-sdk';
import { DEFAULT_PERMISSIONS } from './types.js';

const MAX_REGION_DB_CACHE = 64;

export class RegionStore {
  private _worldDbPath: string;
  private _regionsBasePath: string;
  private _logger: Logger;
  private _worldDb: Database.Database | null = null;
  private _regionDbMap = new Map<string, Database.Database>();

  constructor(worldDbPath: string, regionsBasePath: string, logger: Logger) {
    this._worldDbPath = worldDbPath;
    this._regionsBasePath = regionsBasePath;
    this._logger = logger;
  }

  get isOpen(): boolean {
    return this._worldDb !== null;
  }

  openWorld(worldDbPath?: string): void {
    // Close existing world if already open (F14: prevent handle leak)
    if (this._worldDb) {
      this.closeWorld();
    }

    if (worldDbPath) {
      this._worldDbPath = worldDbPath;
    }

    this._worldDb = new Database(this._worldDbPath, { readonly: true });

    // Verify region_registry table exists
    const tableCheck = this._worldDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='region_registry'",
    ).get();

    if (!tableCheck) {
      this._worldDb.close();
      this._worldDb = null;
      throw new Error('region_registry table not found in world database');
    }

    this._logger.info('RegionStore opened world database');
  }

  closeWorld(): void {
    for (const [, db] of this._regionDbMap) {
      try { db.close(); } catch { /* already closed */ }
    }
    this._regionDbMap.clear();

    if (this._worldDb) {
      try { this._worldDb.close(); } catch { /* already closed */ }
      this._worldDb = null;
    }
  }

  getRegionDb(x: number, y: number): Database.Database | null {
    const key = `${x}_${y}`;
    const cached = this._regionDbMap.get(key);
    if (cached) {
      return cached;
    }

    const dbPath = path.join(this._regionsBasePath, `region_${x}_${y}.db`);
    if (!fs.existsSync(dbPath)) {
      return null;
    }

    // Evict oldest entry if at capacity (F2: bounded region DB cache)
    if (this._regionDbMap.size >= MAX_REGION_DB_CACHE) {
      const firstKey = this._regionDbMap.keys().next().value;
      if (firstKey !== undefined) {
        const evicted = this._regionDbMap.get(firstKey);
        if (evicted) {
          try { evicted.close(); } catch { /* already closed */ }
        }
        this._regionDbMap.delete(firstKey);
      }
    }

    const db = new Database(dbPath, { readonly: true });
    this._regionDbMap.set(key, db);
    return db;
  }

  checkRegionReadPermission(x: number, y: number, userId: string): boolean {
    try {
      if (!this._worldDb) {
        return false;
      }

      const row = this._worldDb.prepare(
        'SELECT owner, owner_read, other_read FROM region_registry WHERE x_index = ? AND y_index = ?',
      ).get(x, y) as { owner: string; owner_read: number | null; other_read: number | null } | undefined;

      if (!row) {
        return false;
      }

      if (userId === row.owner) {
        return (row.owner_read ?? DEFAULT_PERMISSIONS.ownerRead) === 1;
      }
      return (row.other_read ?? DEFAULT_PERMISSIONS.otherRead) === 1;
    } catch (err: any) {
      this._logger.error(`RegionStore read permission error: ${err.message}`);
      return false;
    }
  }

  checkRegionWritePermission(x: number, y: number, userId: string): boolean {
    try {
      if (!this._worldDb) {
        return false;
      }

      const row = this._worldDb.prepare(
        'SELECT owner, owner_write, other_write FROM region_registry WHERE x_index = ? AND y_index = ?',
      ).get(x, y) as { owner: string; owner_write: number | null; other_write: number | null } | undefined;

      if (!row) {
        return false;
      }

      if (userId === row.owner) {
        return (row.owner_write ?? DEFAULT_PERMISSIONS.ownerWrite) === 1;
      }
      return (row.other_write ?? DEFAULT_PERMISSIONS.otherWrite) === 1;
    } catch (err: any) {
      this._logger.error(`RegionStore write permission error: ${err.message}`);
      return false;
    }
  }

  checkEntityWritePermission(x: number, y: number, entityId: string, userId: string): boolean {
    try {
      const regionDb = this.getRegionDb(x, y);
      if (!regionDb) {
        return false;
      }

      const row = regionDb.prepare(
        'SELECT owner, owner_write, other_write FROM entities WHERE instance_id = ?',
      ).get(entityId) as { owner: string; owner_write: number | null; other_write: number | null } | undefined;

      if (!row) {
        return false;
      }

      if (userId === row.owner) {
        return (row.owner_write ?? DEFAULT_PERMISSIONS.ownerWrite) === 1;
      }
      return (row.other_write ?? DEFAULT_PERMISSIONS.otherWrite) === 1;
    } catch (err: any) {
      this._logger.error(`RegionStore entity permission error: ${err.message}`);
      return false;
    }
  }

  cleanup(): void {
    this.closeWorld();
    this._logger.info('RegionStore cleaned up');
  }
}
