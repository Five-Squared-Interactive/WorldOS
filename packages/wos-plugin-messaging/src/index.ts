// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import Database from 'better-sqlite3';
import { WOSPlugin } from '@worldos/plugin-sdk';
import { ChannelStore } from './channel-store.js';
import { MessageStore } from './message-store.js';
import { collectHealthStatus } from './health.js';

const MAX_TOKEN_CACHE_SIZE = 1000;

export class MessagingPlugin extends WOSPlugin {
  private _ctx: any;
  private db?: Database.Database;
  private channelStore?: ChannelStore;
  private messageStore?: MessageStore;

  // Config
  private maxContentLength = 4000;
  private retentionLimit = 1000;

  // Auth
  private tokenCache = new Map<string, { decoded: any; expiresAt: number }>();
  private pendingAuth = new Map<string, { resolve: (v: any) => void; timer: ReturnType<typeof setTimeout>; token: string }>();
  private cacheCleanupTimer?: ReturnType<typeof setInterval>;

  async onStart(context: any): Promise<void> {
    this._ctx = context;
    const serverDir = context.serverDir ?? process.cwd();
    const dataDir = path.join(serverDir, 'data');

    await fs.mkdir(dataDir, { recursive: true });

    const dbPath = path.join(dataDir, 'messaging.db');
    this.db = new Database(dbPath);
    this.channelStore = new ChannelStore(this.db);
    this.messageStore = new MessageStore(this.db);

    this.maxContentLength = context.config?.maxContentLength ?? 4000;
    this.retentionLimit = context.config?.retentionLimit ?? 1000;

    this.cacheCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, val] of this.tokenCache) {
        if (val.expiresAt < now) this.tokenCache.delete(key);
      }
    }, 60_000);

    this.subscribeHandlers();
    this._ctx.logger.info('Messaging plugin started');
  }

  async onStop(): Promise<void> {
    if (this.cacheCleanupTimer) {
      clearInterval(this.cacheCleanupTimer);
      this.cacheCleanupTimer = undefined;
    }
    for (const pending of this.pendingAuth.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingAuth.clear();
    this.tokenCache.clear();
    if (this.db) {
      this.db.close();
      this.db = undefined;
    }
    this.channelStore = undefined;
    this.messageStore = undefined;
  }

  async onHealthCheck(): Promise<any> {
    if (!this.messageStore || !this.channelStore) {
      return { status: 'unhealthy', details: { initialized: false, error: 'Not started' } };
    }
    return collectHealthStatus(this.messageStore, this.channelStore);
  }

  // ── Auth ─────────────────────────────────────────────────────────

  private async validateToken(token: string): Promise<{ valid: boolean; userId?: string; role?: string }> {
    const cached = this.tokenCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return { valid: true, ...cached.decoded };
    }

    const correlationId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingAuth.delete(correlationId);
        resolve({ valid: false });
      }, 2000);

      this.pendingAuth.set(correlationId, { resolve, timer, token });
      this._ctx.mqtt.publishRaw('wos/identity/token/validate', {
        correlationId, token,
      });
    });
  }

  private async withAuth(msg: any, handler: (userId: string) => void | Promise<void>): Promise<void> {
    const token = msg.payload?.token;
    if (!token) {
      this.respond(msg.topic, { correlationId: msg.payload?.correlationId, error: 'unauthorized' });
      return;
    }
    const auth = await this.validateToken(token);
    if (!auth.valid) {
      this.respond(msg.topic, { correlationId: msg.payload?.correlationId, error: 'unauthorized' });
      return;
    }
    try {
      await handler(auth.userId!);
    } catch (err: any) {
      this.respond(msg.topic, { correlationId: msg.payload?.correlationId, error: err.message ?? 'internal_error' });
    }
  }

  private requireFields(msg: any, ...fields: string[]): boolean {
    for (const field of fields) {
      if (msg.payload?.[field] == null || msg.payload[field] === '') {
        this.respond(msg.topic, { correlationId: msg.payload?.correlationId, error: `missing_${field}` });
        return false;
      }
    }
    return true;
  }

  // ── MQTT ─────────────────────────────────────────────────────────

  private respond(topic: string, payload: any): void {
    this._ctx.mqtt.publishRaw(`${topic}/response`, payload);
  }

  private subscribeHandlers(): void {
    const mqtt = this._ctx.mqtt;

    // Auth response
    mqtt.subscribeWithHandler('wos/identity/token/validate/response', (msg: any) => {
      const p = msg.payload;
      const pending = this.pendingAuth.get(p.correlationId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingAuth.delete(p.correlationId);
        if (p.valid && p.token === pending.token) {
          if (this.tokenCache.size >= MAX_TOKEN_CACHE_SIZE) {
            const oldest = this.tokenCache.keys().next().value!;
            this.tokenCache.delete(oldest);
          }
          this.tokenCache.set(pending.token, {
            decoded: { userId: p.userId, role: p.role },
            expiresAt: Date.now() + 30_000,
          });
          pending.resolve({ valid: true, userId: p.userId, role: p.role });
        } else {
          pending.resolve({ valid: false });
        }
      }
    });

    // World lifecycle cleanup
    mqtt.subscribeWithHandler('wos/world-manager/lifecycle/reset', (msg: any) => {
      this.handleWorldReset(msg);
    });

    // Channel operations
    mqtt.subscribeWithHandler('wos/messaging/channel/create', (msg: any) => this.handleChannelCreate(msg));
    mqtt.subscribeWithHandler('wos/messaging/channel/list', (msg: any) => this.handleChannelList(msg));
    mqtt.subscribeWithHandler('wos/messaging/channel/delete', (msg: any) => this.handleChannelDelete(msg));

    // Message operations
    mqtt.subscribeWithHandler('wos/messaging/message/send', (msg: any) => this.handleMessageSend(msg));
    mqtt.subscribeWithHandler('wos/messaging/message/history', (msg: any) => this.handleMessageHistory(msg));

    // DM
    mqtt.subscribeWithHandler('wos/messaging/dm/send', (msg: any) => this.handleDmSend(msg));

    // Admin panel queries (no auth — admin panel is authenticated at WebSocket level)
    mqtt.subscribeWithHandler('wos/messaging/admin/stats', (msg: any) => this.handleAdminStats(msg));
    mqtt.subscribeWithHandler('wos/messaging/admin/channel/create', (msg: any) => this.handleAdminChannelCreate(msg));
    mqtt.subscribeWithHandler('wos/messaging/admin/channel/delete', (msg: any) => this.handleAdminChannelDelete(msg));
    mqtt.subscribeWithHandler('wos/messaging/admin/message/send', (msg: any) => this.handleAdminMessageSend(msg));
  }

  // ── Handlers ─────────────────────────────────────────────────────

  private async handleChannelCreate(msg: any): Promise<void> {
    await this.withAuth(msg, (userId) => {
      if (!this.requireFields(msg, 'worldId', 'name')) return;
      const { worldId, name, description, correlationId } = msg.payload;

      // Validate channel name
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName || trimmedName.length > 100) {
        this.respond(msg.topic, { correlationId, error: 'invalid_name' });
        return;
      }
      if (!/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/.test(trimmedName)) {
        this.respond(msg.topic, { correlationId, error: 'invalid_name' });
        return;
      }

      const channelId = crypto.randomUUID();

      try {
        this.channelStore!.createChannel({
          channelId,
          name: trimmedName,
          worldId,
          createdBy: userId,
          createdAt: new Date().toISOString(),
          description: description ?? '',
        });
      } catch (err: any) {
        if (err.message?.includes('UNIQUE constraint')) {
          this.respond(msg.topic, { correlationId, error: 'duplicate_name' });
          return;
        }
        throw err;
      }

      this.respond(msg.topic, { correlationId, channelId, name: trimmedName });
    });
  }

  private async handleChannelList(msg: any): Promise<void> {
    await this.withAuth(msg, () => {
      if (!this.requireFields(msg, 'worldId')) return;
      const { worldId, limit, offset, correlationId } = msg.payload;
      const result = this.channelStore!.listChannels(worldId, { limit, offset });

      this.respond(msg.topic, {
        correlationId,
        channels: result.channels,
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      });
    });
  }

  private async handleChannelDelete(msg: any): Promise<void> {
    await this.withAuth(msg, (userId) => {
      if (!this.requireFields(msg, 'channelId')) return;
      const { channelId, correlationId } = msg.payload;

      const channel = this.channelStore!.getChannel(channelId);
      if (!channel) {
        this.respond(msg.topic, { correlationId, error: 'not_found' });
        return;
      }

      if (channel.createdBy !== userId) {
        this.respond(msg.topic, { correlationId, error: 'forbidden' });
        return;
      }

      // Delete channel and its messages in a transaction
      const deleteTransaction = this.db!.transaction(() => {
        this.messageStore!.deleteMessagesByConversation(channelId);
        this.channelStore!.deleteChannel(channelId);
      });
      deleteTransaction();

      this.respond(msg.topic, { correlationId, success: true });
    });
  }

  private async handleMessageSend(msg: any): Promise<void> {
    await this.withAuth(msg, (userId) => {
      if (!this.requireFields(msg, 'conversationId', 'content')) return;
      const { conversationId, content, correlationId } = msg.payload;

      // Reject DM-prefixed conversationIds
      if (conversationId.startsWith('dm:')) {
        this.respond(msg.topic, { correlationId, error: 'use_dm_send_topic' });
        return;
      }

      // Validate content
      const trimmed = typeof content === 'string' ? content.trim() : '';
      if (!trimmed) {
        this.respond(msg.topic, { correlationId, error: 'empty_content' });
        return;
      }
      if (trimmed.length > this.maxContentLength) {
        this.respond(msg.topic, { correlationId, error: 'content_too_long' });
        return;
      }

      // Verify channel exists
      const channel = this.channelStore!.getChannel(conversationId);
      if (!channel) {
        this.respond(msg.topic, { correlationId, error: 'channel_not_found' });
        return;
      }

      const messageId = crypto.randomUUID();
      this.messageStore!.createMessage({
        messageId,
        conversationId,
        senderId: userId,
        content: trimmed,
        createdAt: new Date().toISOString(),
      });

      this.messageStore!.enforceRetention(conversationId, this.retentionLimit);

      this.respond(msg.topic, { correlationId, messageId });

      // Publish to delivery topic
      this._ctx.mqtt.publishRaw(
        `wos/messaging/deliver/channel/${conversationId}`,
        { messageId, senderId: userId, content: trimmed, conversationId },
      );
    });
  }

  private async handleMessageHistory(msg: any): Promise<void> {
    await this.withAuth(msg, (userId) => {
      if (!this.requireFields(msg, 'conversationId')) return;
      const { conversationId, limit, offset, correlationId } = msg.payload;

      // For DM conversations, verify the requesting user is a participant
      if (typeof conversationId === 'string' && conversationId.startsWith('dm:')) {
        const parts = conversationId.slice(3).split(':');
        if (!parts.includes(userId)) {
          this.respond(msg.topic, { correlationId, error: 'forbidden' });
          return;
        }
      }

      const result = this.messageStore!.listMessages(conversationId, { limit, offset });

      this.respond(msg.topic, {
        correlationId,
        messages: result.messages,
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      });
    });
  }

  private async handleDmSend(msg: any): Promise<void> {
    await this.withAuth(msg, (userId) => {
      if (!this.requireFields(msg, 'recipientId', 'content')) return;
      const { recipientId, content, correlationId } = msg.payload;

      if (recipientId === userId) {
        this.respond(msg.topic, { correlationId, error: 'cannot_dm_self' });
        return;
      }

      // Validate content
      const trimmed = typeof content === 'string' ? content.trim() : '';
      if (!trimmed) {
        this.respond(msg.topic, { correlationId, error: 'empty_content' });
        return;
      }
      if (trimmed.length > this.maxContentLength) {
        this.respond(msg.topic, { correlationId, error: 'content_too_long' });
        return;
      }

      // Derive deterministic DM conversation ID
      const conversationId = `dm:${[userId, recipientId].sort().join(':')}`;

      const messageId = crypto.randomUUID();
      this.messageStore!.createMessage({
        messageId,
        conversationId,
        senderId: userId,
        content: trimmed,
        createdAt: new Date().toISOString(),
      });

      this.messageStore!.enforceRetention(conversationId, this.retentionLimit);

      this.respond(msg.topic, { correlationId, messageId, conversationId });

      // Publish to DM delivery topic
      this._ctx.mqtt.publishRaw(
        `wos/messaging/deliver/dm/${conversationId}`,
        { messageId, senderId: userId, content: trimmed, conversationId },
      );
    });
  }

  private handleAdminStats(msg: any): void {
    const p = msg.payload;
    const messageStats = this.messageStore!.getStats();
    const channelMetrics = this.channelStore!.getHealthMetrics();
    // Get all channels (use a large limit to get them all)
    const recentMessages = this.db!.prepare(
      `SELECT m.*, c.name AS channel_name FROM messages m
       LEFT JOIN channels c ON m.conversation_id = c.channel_id
       ORDER BY m.created_at DESC LIMIT 20`
    ).all() as any[];

    const channels = this.db!.prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM messages WHERE conversation_id = c.channel_id) AS message_count
       FROM channels c ORDER BY c.created_at DESC`
    ).all() as any[];

    this.respond(msg.topic, {
      correlationId: p?.correlationId,
      totalMessages: messageStats.totalMessages,
      dmConversationCount: messageStats.dmConversationCount,
      totalChannels: channelMetrics.totalChannels,
      worldCount: channelMetrics.worldCount,
      channels,
      recentMessages,
    });
  }

  private handleAdminChannelCreate(msg: any): void {
    const p = msg.payload;
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    if (!name || name.length > 100 || !/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/.test(name)) {
      this.respond(msg.topic, { correlationId: p?.correlationId, error: 'invalid_name' });
      return;
    }
    const channelId = crypto.randomUUID();
    try {
      this.channelStore!.createChannel({
        channelId,
        name,
        worldId: p.worldId || 'default',
        createdBy: p.sender || 'admin',
        createdAt: new Date().toISOString(),
        description: p.description ?? '',
      });
    } catch (err: any) {
      if (err.message?.includes('UNIQUE constraint')) {
        this.respond(msg.topic, { correlationId: p?.correlationId, error: 'duplicate_name' });
        return;
      }
      throw err;
    }
    this.respond(msg.topic, { correlationId: p?.correlationId, channelId, name });
  }

  private handleAdminChannelDelete(msg: any): void {
    const p = msg.payload;
    const channel = this.channelStore!.getChannel(p.channelId);
    if (!channel) {
      this.respond(msg.topic, { correlationId: p?.correlationId, error: 'not_found' });
      return;
    }
    const deleteTransaction = this.db!.transaction(() => {
      this.messageStore!.deleteMessagesByConversation(p.channelId);
      this.channelStore!.deleteChannel(p.channelId);
    });
    deleteTransaction();
    this.respond(msg.topic, { correlationId: p?.correlationId, success: true });
  }

  private handleAdminMessageSend(msg: any): void {
    const p = msg.payload;
    const content = typeof p.content === 'string' ? p.content.trim() : '';
    if (!content) {
      this.respond(msg.topic, { correlationId: p?.correlationId, error: 'empty_content' });
      return;
    }
    if (content.length > this.maxContentLength) {
      this.respond(msg.topic, { correlationId: p?.correlationId, error: 'content_too_long' });
      return;
    }
    const channel = this.channelStore!.getChannel(p.conversationId);
    if (!channel) {
      this.respond(msg.topic, { correlationId: p?.correlationId, error: 'channel_not_found' });
      return;
    }
    const messageId = crypto.randomUUID();
    const senderId = p.sender || 'admin';
    this.messageStore!.createMessage({
      messageId,
      conversationId: p.conversationId,
      senderId,
      content,
      createdAt: new Date().toISOString(),
    });
    this.messageStore!.enforceRetention(p.conversationId, this.retentionLimit);
    this.respond(msg.topic, { correlationId: p?.correlationId, messageId });
    this._ctx.mqtt.publishRaw(
      `wos/messaging/deliver/channel/${p.conversationId}`,
      { messageId, senderId, content, conversationId: p.conversationId },
    );
  }

  private handleWorldReset(msg: any): void {
    const worldId = msg.payload?.worldId;
    if (!worldId) return;

    try {
      const resetTransaction = this.db!.transaction(() => {
        const channelIds = this.channelStore!.getChannelIdsByWorld(worldId);
        for (const channelId of channelIds) {
          this.messageStore!.deleteMessagesByConversation(channelId);
        }
        this.channelStore!.deleteChannelsByWorld(worldId);
      });
      resetTransaction();

      this._ctx.logger.info(`Cleaned up messaging data for world: ${worldId}`);
    } catch (err: any) {
      this._ctx.logger.error(`Failed to cleanup messaging for world: ${worldId}`, err);
    }
  }
}

export const plugin = new MessagingPlugin();

// Auto-start when spawned as a child process by wos-server
if (process.env.WOS_PLUGIN_NAME) {
  // Bridge WOS_MQTT_HOST/PORT to WOS_MQTT_URL for the SDK client
  if (!process.env.WOS_MQTT_URL && process.env.WOS_MQTT_HOST) {
    process.env.WOS_MQTT_URL = `mqtt://${process.env.WOS_MQTT_HOST}:${process.env.WOS_MQTT_PORT || '1883'}`;
  }

  const handleHealthCheck = (data: Buffer) => {
    for (const line of data.toString().split('\n')) {
      try {
        const msg = JSON.parse(line.trim());
        if (msg.type === 'health_check') {
          Promise.resolve(plugin.onHealthCheck()).then((health: any) => {
            process.stdout.write(JSON.stringify({
              type: 'health_response',
              correlationId: msg.correlationId,
              status: health?.status === 'ok' ? 'healthy' : (health?.status ?? 'healthy'),
              timestamp: new Date().toISOString(),
              details: health?.details,
            }) + '\n');
          }).catch(() => {});
        }
      } catch { /* not JSON */ }
    }
  };

  plugin.start().then(() => {
    process.stdin.on('data', handleHealthCheck);
  }).catch((err: Error) => {
    console.error(`[messaging] Failed to start: ${err.message}`);
    process.exit(1);
  });

  const shutdown = () => {
    plugin.stop().then(() => process.exit(0)).catch(() => process.exit(1));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
