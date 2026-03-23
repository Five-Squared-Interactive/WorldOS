// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('@worldos/plugin-sdk', () => ({
  WOSPlugin: class WOSPlugin {},
}));

describe('Messaging E2E', () => {
  let tmpDir: string;
  let plugin: any;
  let published: Array<{ topic: string; payload: any }>;
  let handlers: Map<string, (msg: any) => void>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msg-e2e-test-'));
    published = [];
    handlers = new Map();

    const mockMqtt = {
      publishRaw: vi.fn((topic: string, payload: string) => {
        published.push({ topic, payload: JSON.parse(payload) });
      }),
      subscribeWithHandler: vi.fn((topic: string, handler: any) => {
        handlers.set(topic, handler);
      }),
    };

    const { MessagingPlugin } = await import('../src/index.js');
    plugin = new MessagingPlugin();
    await plugin.onStart({
      serverDir: tmpDir,
      config: {},
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      mqtt: mockMqtt,
      manifest: { name: 'messaging' },
    });
  });

  afterEach(async () => {
    try { await plugin.onStop(); } catch { /* ignore */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function send(topic: string, payload: any) {
    const handler = handlers.get(topic);
    if (!handler) throw new Error(`No handler for ${topic}`);
    handler({ topic, payload });
  }

  async function authed(topic: string, payload: any, token = 'tok-1', userId = 'user-1') {
    send(topic, { ...payload, token });
    await new Promise(r => setTimeout(r, 10));

    const authReqs = published.filter(p => p.topic === 'wos/identity/token/validate');
    if (authReqs.length > 0) {
      const last = authReqs[authReqs.length - 1];
      send('wos/identity/token/validate/response', {
        correlationId: last.payload.correlationId,
        valid: true, userId, role: 'user', token,
      });
    }
    await new Promise(r => setTimeout(r, 50));
  }

  function resp(topic: string, pred?: (p: any) => boolean) {
    return published.find(p => p.topic === `${topic}/response` && (!pred || pred(p.payload)));
  }

  function lastResp(topic: string, pred?: (p: any) => boolean) {
    const matches = published.filter(p => p.topic === `${topic}/response` && (!pred || pred(p.payload)));
    return matches[matches.length - 1];
  }

  // ── Channel lifecycle ───────────────────────────────────────────

  it('create channel → list channels → verify channel exists', async () => {
    await authed('wos/messaging/channel/create', { correlationId: 'c1', worldId: 'w1', name: 'general' });
    const createResp = resp('wos/messaging/channel/create', p => p.channelId);
    expect(createResp).toBeDefined();

    published.length = 0;
    await authed('wos/messaging/channel/list', { correlationId: 'c2', worldId: 'w1' });
    const listResp = resp('wos/messaging/channel/list', p => p.channels);
    expect(listResp!.payload.channels).toHaveLength(1);
    expect(listResp!.payload.channels[0].name).toBe('general');
  });

  // ── Channel messaging ──────────────────────────────────────────

  it('send message to channel → fetch history → message appears', async () => {
    await authed('wos/messaging/channel/create', { correlationId: 'c1', worldId: 'w1', name: 'general' });
    const chId = resp('wos/messaging/channel/create', p => p.channelId)!.payload.channelId;
    published.length = 0;

    await authed('wos/messaging/message/send', { correlationId: 'c2', conversationId: chId, content: 'Hello!' });
    const sendResp = resp('wos/messaging/message/send', p => p.messageId);
    expect(sendResp).toBeDefined();

    published.length = 0;
    await authed('wos/messaging/message/history', { correlationId: 'c3', conversationId: chId });
    const histResp = resp('wos/messaging/message/history', p => p.messages);
    expect(histResp!.payload.messages).toHaveLength(1);
    expect(histResp!.payload.messages[0].content).toBe('Hello!');
    expect(histResp!.payload.messages[0].senderId).toBe('user-1');
  });

  // ── DM ──────────────────────────────────────────────────────────

  it('send DM → fetch DM history → message appears', async () => {
    await authed('wos/messaging/dm/send', { correlationId: 'c1', recipientId: 'user-2', content: 'Hey!' });
    const dmResp = resp('wos/messaging/dm/send', p => p.conversationId);
    const convId = dmResp!.payload.conversationId;
    published.length = 0;

    await authed('wos/messaging/message/history', { correlationId: 'c2', conversationId: convId });
    const histResp = resp('wos/messaging/message/history', p => p.messages);
    expect(histResp!.payload.messages).toHaveLength(1);
    expect(histResp!.payload.messages[0].content).toBe('Hey!');
  });

  it('DM conversation ID is deterministic (sender A→B same as B→A)', async () => {
    // user-1 sends to user-2
    await authed('wos/messaging/dm/send', { correlationId: 'c1', recipientId: 'user-2', content: 'Hi from 1' });
    const convId1 = resp('wos/messaging/dm/send', p => p.conversationId)!.payload.conversationId;
    published.length = 0;

    // user-2 sends to user-1
    await authed('wos/messaging/dm/send', { correlationId: 'c2', recipientId: 'user-1', content: 'Hi from 2' }, 'tok-2', 'user-2');
    const convId2 = lastResp('wos/messaging/dm/send', p => p.conversationId)!.payload.conversationId;

    expect(convId1).toBe(convId2);

    // Both messages in same history
    published.length = 0;
    await authed('wos/messaging/message/history', { correlationId: 'c3', conversationId: convId1 });
    const histResp = resp('wos/messaging/message/history', p => p.messages);
    expect(histResp!.payload.messages).toHaveLength(2);
  });

  // ── Pagination ──────────────────────────────────────────────────

  it('message history pagination works (limit/offset)', async () => {
    await authed('wos/messaging/channel/create', { correlationId: 'c1', worldId: 'w1', name: 'general' });
    const chId = resp('wos/messaging/channel/create', p => p.channelId)!.payload.channelId;

    for (let i = 0; i < 5; i++) {
      published.length = 0;
      await authed('wos/messaging/message/send', { correlationId: `s${i}`, conversationId: chId, content: `msg-${i}` });
    }
    published.length = 0;

    await authed('wos/messaging/message/history', { correlationId: 'h1', conversationId: chId, limit: 2, offset: 0 });
    const page1 = resp('wos/messaging/message/history', p => p.messages);
    expect(page1!.payload.messages).toHaveLength(2);
    expect(page1!.payload.total).toBe(5);
  });

  // ── Retention ───────────────────────────────────────────────────

  it('retention enforcement: oldest messages pruned beyond limit', async () => {
    // Start plugin with low retention limit
    await plugin.onStop();
    const { MessagingPlugin } = await import('../src/index.js');
    plugin = new MessagingPlugin();
    published = [];
    handlers = new Map();

    const mockMqtt2 = {
      publishRaw: vi.fn((topic: string, payload: string) => {
        published.push({ topic, payload: JSON.parse(payload) });
      }),
      subscribeWithHandler: vi.fn((topic: string, handler: any) => {
        handlers.set(topic, handler);
      }),
    };

    await plugin.onStart({
      serverDir: tmpDir,
      config: { retentionLimit: 3 },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      mqtt: mockMqtt2,
      manifest: { name: 'messaging' },
    });

    await authed('wos/messaging/channel/create', { correlationId: 'c1', worldId: 'w1', name: 'general' });
    const chId = resp('wos/messaging/channel/create', p => p.channelId)!.payload.channelId;

    for (let i = 0; i < 5; i++) {
      published.length = 0;
      await authed('wos/messaging/message/send', { correlationId: `s${i}`, conversationId: chId, content: `msg-${i}` });
    }
    published.length = 0;

    await authed('wos/messaging/message/history', { correlationId: 'h1', conversationId: chId, limit: 100 });
    const histResp = resp('wos/messaging/message/history', p => p.messages);
    expect(histResp!.payload.total).toBe(3);
  });

  // ── Channel delete ──────────────────────────────────────────────

  it('delete channel by creator → channel gone, messages deleted', async () => {
    await authed('wos/messaging/channel/create', { correlationId: 'c1', worldId: 'w1', name: 'general' });
    const chId = resp('wos/messaging/channel/create', p => p.channelId)!.payload.channelId;
    published.length = 0;

    await authed('wos/messaging/message/send', { correlationId: 'c2', conversationId: chId, content: 'hello' });
    published.length = 0;

    await authed('wos/messaging/channel/delete', { correlationId: 'c3', channelId: chId });
    const delResp = resp('wos/messaging/channel/delete', p => p.success);
    expect(delResp!.payload.success).toBe(true);

    // Channel list should be empty
    published.length = 0;
    await authed('wos/messaging/channel/list', { correlationId: 'c4', worldId: 'w1' });
    const listResp = resp('wos/messaging/channel/list', p => p.channels);
    expect(listResp!.payload.total).toBe(0);

    // Message history should be empty
    published.length = 0;
    await authed('wos/messaging/message/history', { correlationId: 'c5', conversationId: chId });
    const histResp = resp('wos/messaging/message/history', p => p.messages);
    expect(histResp!.payload.total).toBe(0);
  });

  it('delete channel by non-creator → forbidden error', async () => {
    await authed('wos/messaging/channel/create', { correlationId: 'c1', worldId: 'w1', name: 'general' });
    const chId = resp('wos/messaging/channel/create', p => p.channelId)!.payload.channelId;
    published.length = 0;

    await authed('wos/messaging/channel/delete', { correlationId: 'c2', channelId: chId }, 'tok-2', 'user-2');
    const delResp = lastResp('wos/messaging/channel/delete', p => p.error);
    expect(delResp!.payload.error).toBe('forbidden');
  });

  // ── Error cases ─────────────────────────────────────────────────

  it('send message to nonexistent channel → error', async () => {
    await authed('wos/messaging/message/send', { correlationId: 'c1', conversationId: 'fake-channel', content: 'hi' });
    const sendResp = resp('wos/messaging/message/send', p => p.error);
    expect(sendResp!.payload.error).toMatch(/not_found/i);
  });

  it('auth failure: request without token → error', async () => {
    send('wos/messaging/channel/create', { correlationId: 'c1', worldId: 'w1', name: 'test' });
    await new Promise(r => setTimeout(r, 10));

    const errResp = resp('wos/messaging/channel/create', p => p.error);
    expect(errResp!.payload.error).toBe('unauthorized');
  });

  it('missing fields: send without content → error (after auth)', async () => {
    await authed('wos/messaging/message/send', { correlationId: 'c1', conversationId: 'ch-1' });

    const errResp = resp('wos/messaging/message/send', p => p.error);
    expect(errResp!.payload.error).toMatch(/missing_content/i);
  });

  it('content too long (>4000 chars) → error', async () => {
    await authed('wos/messaging/channel/create', { correlationId: 'c1', worldId: 'w1', name: 'general' });
    const chId = resp('wos/messaging/channel/create', p => p.channelId)!.payload.channelId;
    published.length = 0;

    await authed('wos/messaging/message/send', {
      correlationId: 'c2', conversationId: chId, content: 'x'.repeat(4001),
    });
    const sendResp = resp('wos/messaging/message/send', p => p.error);
    expect(sendResp!.payload.error).toMatch(/content/i);
  });

  it('empty content (whitespace only) → error', async () => {
    await authed('wos/messaging/channel/create', { correlationId: 'c1', worldId: 'w1', name: 'general' });
    const chId = resp('wos/messaging/channel/create', p => p.channelId)!.payload.channelId;
    published.length = 0;

    await authed('wos/messaging/message/send', {
      correlationId: 'c2', conversationId: chId, content: '   ',
    });
    const sendResp = resp('wos/messaging/message/send', p => p.error);
    expect(sendResp!.payload.error).toMatch(/content/i);
  });

  // ── World reset ─────────────────────────────────────────────────

  it('world reset: channels and messages gone, DMs survive', async () => {
    // Create channel and send message
    await authed('wos/messaging/channel/create', { correlationId: 'c1', worldId: 'w1', name: 'general' });
    const chId = resp('wos/messaging/channel/create', p => p.channelId)!.payload.channelId;
    published.length = 0;

    await authed('wos/messaging/message/send', { correlationId: 'c2', conversationId: chId, content: 'channel msg' });
    published.length = 0;

    // Send DM
    await authed('wos/messaging/dm/send', { correlationId: 'c3', recipientId: 'user-2', content: 'dm msg' });
    const dmConvId = resp('wos/messaging/dm/send', p => p.conversationId)!.payload.conversationId;
    published.length = 0;

    // Reset world
    send('wos/world-manager/lifecycle/reset', { worldId: 'w1' });
    await new Promise(r => setTimeout(r, 50));
    published.length = 0;

    // Channels should be gone
    await authed('wos/messaging/channel/list', { correlationId: 'c4', worldId: 'w1' });
    expect(resp('wos/messaging/channel/list', p => p.channels)!.payload.total).toBe(0);
    published.length = 0;

    // DM should still exist
    await authed('wos/messaging/message/history', { correlationId: 'c5', conversationId: dmConvId });
    expect(resp('wos/messaging/message/history', p => p.messages)!.payload.messages).toHaveLength(1);
  });

  // ── Health check ────────────────────────────────────────────────

  it('health check returns ok with correct metrics', async () => {
    await authed('wos/messaging/channel/create', { correlationId: 'c1', worldId: 'w1', name: 'general' });
    const chId = resp('wos/messaging/channel/create', p => p.channelId)!.payload.channelId;
    published.length = 0;

    await authed('wos/messaging/message/send', { correlationId: 'c2', conversationId: chId, content: 'hello' });

    const health = await plugin.onHealthCheck();
    expect(health.status).toBe('ok');
    expect(health.details.totalMessages).toBe(1);
    expect(health.details.totalChannels).toBe(1);
  });
});
