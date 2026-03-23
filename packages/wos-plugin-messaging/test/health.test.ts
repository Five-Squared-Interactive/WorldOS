// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { collectHealthStatus } from '../src/health.js';
import { ChannelStore } from '../src/channel-store.js';
import { MessageStore } from '../src/message-store.js';

describe('collectHealthStatus', () => {
  it('returns ok when DB is accessible', () => {
    const db = new Database(':memory:');
    const channelStore = new ChannelStore(db);
    const messageStore = new MessageStore(db);

    const result = collectHealthStatus(messageStore, channelStore);
    expect(result.status).toBe('ok');
  });

  it('includes correct metrics', () => {
    const db = new Database(':memory:');
    const channelStore = new ChannelStore(db);
    const messageStore = new MessageStore(db);

    channelStore.createChannel({
      channelId: 'ch-1', name: 'general', worldId: 'world-1',
      createdBy: 'user-1', createdAt: new Date().toISOString(), description: '',
    });
    channelStore.createChannel({
      channelId: 'ch-2', name: 'random', worldId: 'world-2',
      createdBy: 'user-1', createdAt: new Date().toISOString(), description: '',
    });
    messageStore.createMessage({
      messageId: 'msg-1', conversationId: 'ch-1', senderId: 'user-1',
      content: 'hello', createdAt: new Date().toISOString(),
    });
    messageStore.createMessage({
      messageId: 'msg-2', conversationId: 'dm:user-a:user-b', senderId: 'user-a',
      content: 'hi', createdAt: new Date().toISOString(),
    });

    const result = collectHealthStatus(messageStore, channelStore);
    expect(result.status).toBe('ok');
    expect(result.details.totalMessages).toBe(2);
    expect(result.details.totalChannels).toBe(2);
    expect(result.details.worldCount).toBe(2);
    expect(result.details.dmConversationCount).toBe(1);
  });

  it('returns unhealthy when DB query fails', () => {
    const brokenMessageStore = {
      getStats: () => { throw new Error('DB error'); },
    } as any;
    const brokenChannelStore = {
      getHealthMetrics: () => ({ totalChannels: 0, worldCount: 0 }),
    } as any;

    const result = collectHealthStatus(brokenMessageStore, brokenChannelStore);
    expect(result.status).toBe('unhealthy');
    expect(result.details.error).toBe('Database query failed');
  });
});
