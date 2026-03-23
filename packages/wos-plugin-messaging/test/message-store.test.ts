// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MessageStore } from '../src/message-store.js';
import type { MessageRecord } from '../src/types.js';

function makeMessage(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    messageId: 'msg-1',
    conversationId: 'ch-1',
    senderId: 'user-1',
    content: 'Hello world',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('MessageStore', () => {
  let db: Database.Database;
  let store: MessageStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new MessageStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates table and indexes on init', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'").all();
    expect(tables).toHaveLength(1);

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all() as { name: string }[];
    const indexNames = indexes.map(i => i.name);
    expect(indexNames).toContain('idx_messages_conversation_created');
  });

  it('createMessage inserts and returns the record', () => {
    const record = makeMessage();
    const result = store.createMessage(record);
    expect(result).toEqual(record);
  });

  it('listMessages returns paginated results ordered by created_at DESC', () => {
    for (let i = 0; i < 5; i++) {
      store.createMessage(makeMessage({
        messageId: `msg-${i}`,
        createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      }));
    }

    const result = store.listMessages('ch-1', { limit: 3, offset: 0 });
    expect(result.messages).toHaveLength(3);
    expect(result.total).toBe(5);
    // Most recent first
    expect(result.messages[0].messageId).toBe('msg-4');
    expect(result.messages[2].messageId).toBe('msg-2');
  });

  it('listMessages with limit/offset works correctly', () => {
    for (let i = 0; i < 5; i++) {
      store.createMessage(makeMessage({
        messageId: `msg-${i}`,
        createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      }));
    }

    const result = store.listMessages('ch-1', { limit: 2, offset: 2 });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].messageId).toBe('msg-2');
    expect(result.messages[1].messageId).toBe('msg-1');
  });

  it('listMessages returns { messages, total, limit, offset }', () => {
    store.createMessage(makeMessage());
    const result = store.listMessages('ch-1', {});
    expect(result).toHaveProperty('messages');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('limit');
    expect(result).toHaveProperty('offset');
  });

  it('listMessages defaults limit to 50 and offset to 0', () => {
    store.createMessage(makeMessage());
    const result = store.listMessages('ch-1', {});
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
  });

  it('getMessageCount returns count for a conversation', () => {
    store.createMessage(makeMessage({ messageId: 'msg-1' }));
    store.createMessage(makeMessage({ messageId: 'msg-2' }));
    store.createMessage(makeMessage({ messageId: 'msg-3', conversationId: 'ch-2' }));

    expect(store.getMessageCount('ch-1')).toBe(2);
    expect(store.getMessageCount('ch-2')).toBe(1);
    expect(store.getMessageCount('ch-3')).toBe(0);
  });

  it('enforceRetention deletes oldest messages beyond limit', () => {
    for (let i = 0; i < 1005; i++) {
      store.createMessage(makeMessage({
        messageId: `msg-${String(i).padStart(5, '0')}`,
        createdAt: new Date(2026, 0, 1, 0, 0, 0, i).toISOString(),
      }));
    }

    expect(store.getMessageCount('ch-1')).toBe(1005);
    store.enforceRetention('ch-1', 1000);
    expect(store.getMessageCount('ch-1')).toBe(1000);

    // Oldest 5 should be gone — read the tail end (oldest remaining)
    const result = store.listMessages('ch-1', { limit: 200, offset: 800 });
    const ids = result.messages.map(m => m.messageId);
    expect(ids).not.toContain('msg-00000');
    expect(ids).not.toContain('msg-00004');
    expect(ids).toContain('msg-00005');
  });

  it('enforceRetention does nothing when under limit', () => {
    store.createMessage(makeMessage({ messageId: 'msg-1' }));
    store.createMessage(makeMessage({ messageId: 'msg-2' }));
    store.enforceRetention('ch-1', 1000);
    expect(store.getMessageCount('ch-1')).toBe(2);
  });

  it('deleteMessagesByConversation removes all messages', () => {
    store.createMessage(makeMessage({ messageId: 'msg-1', conversationId: 'ch-1' }));
    store.createMessage(makeMessage({ messageId: 'msg-2', conversationId: 'ch-1' }));
    store.createMessage(makeMessage({ messageId: 'msg-3', conversationId: 'ch-2' }));

    store.deleteMessagesByConversation('ch-1');
    expect(store.getMessageCount('ch-1')).toBe(0);
    expect(store.getMessageCount('ch-2')).toBe(1);
  });

  it('getStats returns totalMessages and dmConversationCount', () => {
    store.createMessage(makeMessage({ messageId: 'msg-1', conversationId: 'ch-1' }));
    store.createMessage(makeMessage({ messageId: 'msg-2', conversationId: 'dm:user-a:user-b' }));
    store.createMessage(makeMessage({ messageId: 'msg-3', conversationId: 'dm:user-a:user-b' }));
    store.createMessage(makeMessage({ messageId: 'msg-4', conversationId: 'dm:user-a:user-c' }));

    const stats = store.getStats();
    expect(stats.totalMessages).toBe(4);
    expect(stats.dmConversationCount).toBe(2);
  });

  it('getStats returns zeros when empty', () => {
    const stats = store.getStats();
    expect(stats.totalMessages).toBe(0);
    expect(stats.dmConversationCount).toBe(0);
  });
});
