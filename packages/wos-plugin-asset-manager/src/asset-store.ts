// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import type Database from 'better-sqlite3';
import type { AssetRecord, AssetListResult, AssetType, StorageUsageResult } from './types.js';

const DDL = `
CREATE TABLE IF NOT EXISTS assets (
  asset_id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  world_id TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  metadata TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_assets_world_id ON assets(world_id);
CREATE INDEX IF NOT EXISTS idx_assets_asset_type ON assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_assets_created_by ON assets(created_by);
`;

export class AssetStore {
  private db: Database.Database;
  private stmtInsert;
  private stmtGetById;
  private stmtDelete;
  private stmtDeleteByWorld;
  private stmtUsage;
  private stmtCountByWorld;
  private stmtCountByWorldType;
  private stmtListByWorld;
  private stmtListByWorldType;

  constructor(db: Database.Database) {
    this.db = db;

    db.pragma('journal_mode = WAL');
    db.exec(DDL);

    this.stmtInsert = db.prepare(`
      INSERT INTO assets (asset_id, file_name, world_id, size, mime_type, asset_type, url, created_at, created_by, metadata)
      VALUES (@assetId, @fileName, @worldId, @size, @mimeType, @assetType, @url, @createdAt, @createdBy, @metadata)
    `);
    this.stmtGetById = db.prepare('SELECT * FROM assets WHERE asset_id = ?');
    this.stmtDelete = db.prepare('DELETE FROM assets WHERE asset_id = ?');
    this.stmtDeleteByWorld = db.prepare('DELETE FROM assets WHERE world_id = ?');
    this.stmtUsage = db.prepare(`
      SELECT COALESCE(SUM(size), 0) AS usedBytes, COUNT(*) AS assetCount
      FROM assets WHERE world_id = ?
    `);
    this.stmtCountByWorld = db.prepare('SELECT COUNT(*) AS cnt FROM assets WHERE world_id = ?');
    this.stmtCountByWorldType = db.prepare('SELECT COUNT(*) AS cnt FROM assets WHERE world_id = ? AND asset_type = ?');
    this.stmtListByWorld = db.prepare('SELECT * FROM assets WHERE world_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?');
    this.stmtListByWorldType = db.prepare('SELECT * FROM assets WHERE world_id = ? AND asset_type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?');
  }

  createAsset(record: AssetRecord): AssetRecord {
    this.stmtInsert.run(record);
    return record;
  }

  getAsset(assetId: string): AssetRecord | undefined {
    const row = this.stmtGetById.get(assetId) as any;
    if (!row) return undefined;
    return this.rowToRecord(row);
  }

  listAssets(worldId: string, options: { limit?: number; offset?: number; type?: AssetType }): AssetListResult {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    let countRow: { cnt: number };
    let rows: any[];

    if (options.type) {
      countRow = this.stmtCountByWorldType.get(worldId, options.type) as { cnt: number };
      rows = this.stmtListByWorldType.all(worldId, options.type, limit, offset) as any[];
    } else {
      countRow = this.stmtCountByWorld.get(worldId) as { cnt: number };
      rows = this.stmtListByWorld.all(worldId, limit, offset) as any[];
    }

    return {
      assets: rows.map(r => this.rowToRecord(r)),
      total: countRow.cnt,
      limit,
      offset,
    };
  }

  deleteAsset(assetId: string): boolean {
    const result = this.stmtDelete.run(assetId);
    return result.changes > 0;
  }

  getStorageUsage(worldId: string): StorageUsageResult {
    const row = this.stmtUsage.get(worldId) as { usedBytes: number; assetCount: number };
    return {
      usedBytes: row.usedBytes,
      totalBytes: 0,
      assetCount: row.assetCount,
    };
  }

  deleteAssetsByWorld(worldId: string): number {
    const result = this.stmtDeleteByWorld.run(worldId);
    return result.changes;
  }

  getHealthMetrics(): { totalAssets: number; totalSizeBytes: number; worldCount: number } {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS totalAssets, COALESCE(SUM(size), 0) AS totalSizeBytes, COUNT(DISTINCT world_id) AS worldCount
      FROM assets
    `).get() as any;
    return {
      totalAssets: row.totalAssets,
      totalSizeBytes: row.totalSizeBytes,
      worldCount: row.worldCount,
    };
  }

  private rowToRecord(row: any): AssetRecord {
    return {
      assetId: row.asset_id,
      fileName: row.file_name,
      worldId: row.world_id,
      size: row.size,
      mimeType: row.mime_type,
      assetType: row.asset_type,
      url: row.url,
      createdAt: row.created_at,
      createdBy: row.created_by,
      metadata: row.metadata,
    };
  }
}
