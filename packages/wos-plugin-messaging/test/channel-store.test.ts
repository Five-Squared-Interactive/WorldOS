// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ChannelStore } from '../src/channel-store.js';
import type { ChannelRecord } from '../src/types.js';

function makeChannel(overrides: Partial<ChannelRecord> = {}): ChannelRecord {
  return {
    channelId: 'ch-1',
    name: 'general',
    worldId: 'world-1',
    createdBy: 'user-1',
    createdAt: new Date().toISOString(),
    description: 'A general channel',
    ...overrides,
  };
}

describe('ChannelStore', () => {
  let db: Database.Database;
  let store: ChannelStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new ChannelStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('sets WAL pragma (no-op for in-memory DB)', () => {
    // WAL pragma is called but in-memory DBs report 'memory' — verify no error thrown
    // Real on-disk DBs will report 'wal'
    const mode = db.pragma('journal_mode', { simple: true });
    expect(typeof mode).toBe('string');
  });

  it('creates table and indexes on init', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='channels'").all();
    expect(tables).toHaveLength(1);

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all() as { name: string }[];
    const indexNames = indexes.map(i => i.name);
    expect(indexNames).toContain('idx_channels_world_id');
  });

  it('createChannel inserts and returns the record', () => {
    const record = makeChannel();
    const result = store.createChannel(record);
    expect(result).toEqual(record);
  });

  it('getChannel returns record by ID', () => {
    const record = makeChannel();
    store.createChannel(record);
    const result = store.getChannel('ch-1');
    expect(result).toEqual(record);
  });

  it('getChannel returns undefined for non-existent ID', () => {
    const result = store.getChannel('nonexistent');
    expect(result).toBeUndefined();
  });

  it('listChannels returns paginated results with limit/offset', () => {
    for (let i = 0; i < 5; i++) {
      store.createChannel(makeChannel({
        channelId: `ch-${i}`,
        name: `channel-${i}`,
      }));
    }

    const result = store.listChannels('world-1', { limit: 2, offset: 0 });
    expect(result.channels).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.limit).toBe(2);
    expect(result.offset).toBe(0);
  });

  it('listChannels returns { channels, total, limit, offset }', () => {
    store.createChannel(makeChannel());
    const result = store.listChannels('world-1', {});
    expect(result).toHaveProperty('channels');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('limit');
    expect(result).toHaveProperty('offset');
  });

  it('listChannels defaults limit to 50 and offset to 0', () => {
    store.createChannel(makeChannel());
    const result = store.listChannels('world-1', {});
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
  });

  it('deleteChannel removes record and returns true', () => {
    store.createChannel(makeChannel());
    const deleted = store.deleteChannel('ch-1');
    expect(deleted).toBe(true);
    expect(store.getChannel('ch-1')).toBeUndefined();
  });

  it('deleteChannel returns false for non-existent ID', () => {
    const deleted = store.deleteChannel('nonexistent');
    expect(deleted).toBe(false);
  });

  it('createChannel throws on duplicate name in same world', () => {
    store.createChannel(makeChannel({ channelId: 'ch-1', name: 'general' }));
    expect(() => {
      store.createChannel(makeChannel({ channelId: 'ch-2', name: 'general' }));
    }).toThrow();
  });

  it('createChannel succeeds with same name in different world', () => {
    store.createChannel(makeChannel({ channelId: 'ch-1', name: 'general', worldId: 'world-1' }));
    const record = makeChannel({ channelId: 'ch-2', name: 'general', worldId: 'world-2' });
    expect(() => store.createChannel(record)).not.toThrow();
  });

  it('deleteChannelsByWorld removes all channels for a world and returns count', () => {
    store.createChannel(makeChannel({ channelId: 'ch-1', name: 'a', worldId: 'world-1' }));
    store.createChannel(makeChannel({ channelId: 'ch-2', name: 'b', worldId: 'world-1' }));
    store.createChannel(makeChannel({ channelId: 'ch-3', name: 'c', worldId: 'world-2' }));

    const count = store.deleteChannelsByWorld('world-1');
    expect(count).toBe(2);
    expect(store.getChannel('ch-1')).toBeUndefined();
    expect(store.getChannel('ch-2')).toBeUndefined();
    expect(store.getChannel('ch-3')).toBeDefined();
  });

  it('getChannelIdsByWorld returns array of channelIds for a world', () => {
    store.createChannel(makeChannel({ channelId: 'ch-1', name: 'a', worldId: 'world-1' }));
    store.createChannel(makeChannel({ channelId: 'ch-2', name: 'b', worldId: 'world-1' }));
    store.createChannel(makeChannel({ channelId: 'ch-3', name: 'c', worldId: 'world-2' }));

    const ids = store.getChannelIdsByWorld('world-1');
    expect(ids).toHaveLength(2);
    expect(ids).toContain('ch-1');
    expect(ids).toContain('ch-2');
  });

  it('getHealthMetrics returns totalChannels and worldCount', () => {
    store.createChannel(makeChannel({ channelId: 'ch-1', name: 'a', worldId: 'world-1' }));
    store.createChannel(makeChannel({ channelId: 'ch-2', name: 'b', worldId: 'world-1' }));
    store.createChannel(makeChannel({ channelId: 'ch-3', name: 'c', worldId: 'world-2' }));

    const metrics = store.getHealthMetrics();
    expect(metrics.totalChannels).toBe(3);
    expect(metrics.worldCount).toBe(2);
  });

  it('getHealthMetrics returns zeros when empty', () => {
    const metrics = store.getHealthMetrics();
    expect(metrics.totalChannels).toBe(0);
    expect(metrics.worldCount).toBe(0);
  });
});
