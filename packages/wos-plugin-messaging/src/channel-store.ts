// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import type Database from 'better-sqlite3';
import type { ChannelRecord, ChannelListResult } from './types.js';

const DDL = `
CREATE TABLE IF NOT EXISTS channels (
  channel_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  world_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  description TEXT DEFAULT '',
  UNIQUE(world_id, name)
);
CREATE INDEX IF NOT EXISTS idx_channels_world_id ON channels(world_id);
`;

export class ChannelStore {
  private db: Database.Database;
  private stmtInsert;
  private stmtGetById;
  private stmtDelete;
  private stmtDeleteByWorld;
  private stmtCountByWorld;
  private stmtListByWorld;
  private stmtGetIdsByWorld;

  constructor(db: Database.Database) {
    this.db = db;

    db.pragma('journal_mode = WAL');
    db.exec(DDL);

    this.stmtInsert = db.prepare(`
      INSERT INTO channels (channel_id, name, world_id, created_by, created_at, description)
      VALUES (@channelId, @name, @worldId, @createdBy, @createdAt, @description)
    `);
    this.stmtGetById = db.prepare('SELECT * FROM channels WHERE channel_id = ?');
    this.stmtDelete = db.prepare('DELETE FROM channels WHERE channel_id = ?');
    this.stmtDeleteByWorld = db.prepare('DELETE FROM channels WHERE world_id = ?');
    this.stmtCountByWorld = db.prepare('SELECT COUNT(*) AS cnt FROM channels WHERE world_id = ?');
    this.stmtListByWorld = db.prepare('SELECT * FROM channels WHERE world_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?');
    this.stmtGetIdsByWorld = db.prepare('SELECT channel_id FROM channels WHERE world_id = ?');
  }

  createChannel(record: ChannelRecord): ChannelRecord {
    this.stmtInsert.run(record);
    return record;
  }

  getChannel(channelId: string): ChannelRecord | undefined {
    const row = this.stmtGetById.get(channelId) as any;
    if (!row) return undefined;
    return this.rowToRecord(row);
  }

  listChannels(worldId: string, options: { limit?: number; offset?: number }): ChannelListResult {
    const limit = Math.min(Math.max(1, options.limit ?? 50), 200);
    const offset = Math.max(0, options.offset ?? 0);

    const countRow = this.stmtCountByWorld.get(worldId) as { cnt: number };
    const rows = this.stmtListByWorld.all(worldId, limit, offset) as any[];

    return {
      channels: rows.map(r => this.rowToRecord(r)),
      total: countRow.cnt,
      limit,
      offset,
    };
  }

  deleteChannel(channelId: string): boolean {
    const result = this.stmtDelete.run(channelId);
    return result.changes > 0;
  }

  deleteChannelsByWorld(worldId: string): number {
    const result = this.stmtDeleteByWorld.run(worldId);
    return result.changes;
  }

  getChannelIdsByWorld(worldId: string): string[] {
    const rows = this.stmtGetIdsByWorld.all(worldId) as { channel_id: string }[];
    return rows.map(r => r.channel_id);
  }

  getHealthMetrics(): { totalChannels: number; worldCount: number } {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS totalChannels, COUNT(DISTINCT world_id) AS worldCount
      FROM channels
    `).get() as any;
    return {
      totalChannels: row.totalChannels,
      worldCount: row.worldCount,
    };
  }

  private rowToRecord(row: any): ChannelRecord {
    return {
      channelId: row.channel_id,
      name: row.name,
      worldId: row.world_id,
      createdBy: row.created_by,
      createdAt: row.created_at,
      description: row.description,
    };
  }
}
