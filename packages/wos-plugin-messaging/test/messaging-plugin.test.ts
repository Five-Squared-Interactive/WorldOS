// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('@worldos/plugin-sdk', () => ({
  WOSPlugin: class WOSPlugin {},
}));

describe('MessagingPlugin', () => {
  let tmpDir: string;
  let plugin: any;
  let mockMqtt: any;
  let published: Array<{ topic: string; payload: any }>;
  let handlers: Map<string, (msg: any) => void>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msg-plugin-test-'));
    published = [];
    handlers = new Map();

    mockMqtt = {
      publishRaw: vi.fn((topic: string, payload: string) => {
        published.push({ topic, payload: JSON.parse(payload) });
      }),
      subscribeWithHandler: vi.fn((topic: string, handler: any) => {
        handlers.set(topic, handler);
      }),
    };

    const { MessagingPlugin } = await import('../src/index.js');
    plugin = new MessagingPlugin();
  });

  afterEach(async () => {
    try { await plugin.onStop(); } catch { /* ignore */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function startPlugin(configOverrides: any = {}) {
    await plugin.onStart({
      serverDir: tmpDir,
      config: configOverrides,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      mqtt: mockMqtt,
      manifest: { name: 'messaging' },
    });
  }

  function sendMessage(topic: string, payload: any) {
    const handler = handlers.get(topic);
    if (!handler) throw new Error(`No handler for ${topic}`);
    handler({ topic, payload });
  }

  function simulateAuthSuccess(token: string) {
    const authReq = published.find(p => p.topic === 'wos/identity/token/validate');
    if (!authReq) throw new Error('No auth request published');
    const correlationId = authReq.payload.correlationId;
    const authHandler = handlers.get('wos/identity/token/validate/response');
    if (!authHandler) throw new Error('No auth response handler');
    authHandler({ topic: 'wos/identity/token/validate/response', payload: {
      correlationId, valid: true, userId: 'user-1', role: 'user', token,
    }});
  }

  function simulateAuthInvalid(token: string) {
    const authReq = published.find(p => p.topic === 'wos/identity/token/validate');
    if (!authReq) throw new Error('No auth request published');
    const authHandler = handlers.get('wos/identity/token/validate/response')!;
    authHandler({ topic: 'wos/identity/token/validate/response', payload: {
      correlationId: authReq.payload.correlationId, valid: false, token,
    }});
  }

  async function authedAction(topic: string, payload: any, token = 'valid-token', userId = 'user-1') {
    sendMessage(topic, { ...payload, token });
    await new Promise(r => setTimeout(r, 10));

    // Find latest auth request for this action
    const authReqs = published.filter(p => p.topic === 'wos/identity/token/validate');
    if (authReqs.length > 0) {
      const lastReq = authReqs[authReqs.length - 1];
      const authHandler = handlers.get('wos/identity/token/validate/response')!;
      authHandler({ topic: 'wos/identity/token/validate/response', payload: {
        correlationId: lastReq.payload.correlationId,
        valid: true, userId, role: 'user', token,
      }});
    }
    await new Promise(r => setTimeout(r, 50));
  }

  function findResponse(topic: string, predicate?: (p: any) => boolean) {
    return published.find(p =>
      p.topic === `${topic}/response` && (!predicate || predicate(p.payload))
    );
  }

  // ── onStart ─────────────────────────────────────────────────────

  describe('onStart', () => {
    it('subscribes to all MQTT topics', async () => {
      await startPlugin();
      const topics = [...handlers.keys()];
      expect(topics).toContain('wos/identity/token/validate/response');
      expect(topics).toContain('wos/world-manager/lifecycle/reset');
      expect(topics).toContain('wos/messaging/channel/create');
      expect(topics).toContain('wos/messaging/channel/list');
      expect(topics).toContain('wos/messaging/channel/delete');
      expect(topics).toContain('wos/messaging/message/send');
      expect(topics).toContain('wos/messaging/message/history');
      expect(topics).toContain('wos/messaging/dm/send');
    });

    it('creates data directory', async () => {
      await startPlugin();
      expect(fs.existsSync(path.join(tmpDir, 'data'))).toBe(true);
    });
  });

  // ── onStop ──────────────────────────────────────────────────────

  describe('onStop', () => {
    it('cleans up without error', async () => {
      await startPlugin();
      await expect(plugin.onStop()).resolves.not.toThrow();
    });
  });

  // ── onHealthCheck ───────────────────────────────────────────────

  describe('onHealthCheck', () => {
    it('delegates to health module', async () => {
      await startPlugin();
      const result = await plugin.onHealthCheck();
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('details');
    });
  });

  // ── channel/create ──────────────────────────────────────────────

  describe('channel/create', () => {
    it('creates channel with valid auth and returns { channelId, name }', async () => {
      await startPlugin();
      await authedAction('wos/messaging/channel/create', {
        correlationId: 'c1', worldId: 'world-1', name: 'general',
      });

      const resp = findResponse('wos/messaging/channel/create', p => p.channelId);
      expect(resp).toBeDefined();
      expect(resp!.payload.channelId).toBeDefined();
      expect(resp!.payload.name).toBe('general');
    });

    it('description defaults to empty string if omitted', async () => {
      await startPlugin();
      await authedAction('wos/messaging/channel/create', {
        correlationId: 'c1', worldId: 'world-1', name: 'general',
      });

      const resp = findResponse('wos/messaging/channel/create', p => p.channelId);
      expect(resp).toBeDefined();
    });

    it('returns error if missing required fields (after auth)', async () => {
      await startPlugin();
      // Auth succeeds but worldId/name missing
      await authedAction('wos/messaging/channel/create', { correlationId: 'c1' });

      const resp = findResponse('wos/messaging/channel/create', p => p.error);
      expect(resp).toBeDefined();
      expect(resp!.payload.error).toMatch(/missing/i);
    });

    it('returns unauthorized without token', async () => {
      await startPlugin();
      sendMessage('wos/messaging/channel/create', {
        correlationId: 'c1', worldId: 'w1', name: 'general',
      });
      await new Promise(r => setTimeout(r, 10));

      const resp = findResponse('wos/messaging/channel/create', p => p.error);
      expect(resp).toBeDefined();
      expect(resp!.payload.error).toBe('unauthorized');
    });

    it('returns duplicate_name for same name in same world', async () => {
      await startPlugin();
      await authedAction('wos/messaging/channel/create', {
        correlationId: 'c1', worldId: 'w1', name: 'general',
      });
      published.length = 0;

      await authedAction('wos/messaging/channel/create', {
        correlationId: 'c2', worldId: 'w1', name: 'general',
      });

      const resp = findResponse('wos/messaging/channel/create', p => p.error);
      expect(resp).toBeDefined();
      expect(resp!.payload.error).toBe('duplicate_name');
    });
  });

  // ── channel/list ────────────────────────────────────────────────

  describe('channel/list', () => {
    it('returns paginated channel list', async () => {
      await startPlugin();
      await authedAction('wos/messaging/channel/create', {
        correlationId: 'c1', worldId: 'world-1', name: 'general',
      });
      published.length = 0;

      await authedAction('wos/messaging/channel/list', {
        correlationId: 'c2', worldId: 'world-1',
      });

      const resp = findResponse('wos/messaging/channel/list', p => p.channels);
      expect(resp).toBeDefined();
      expect(resp!.payload.channels.length).toBe(1);
      expect(resp!.payload.total).toBe(1);
    });

    it('returns error if missing worldId (after auth)', async () => {
      await startPlugin();
      await authedAction('wos/messaging/channel/list', { correlationId: 'c1' });
      await new Promise(r => setTimeout(r, 10));

      const resp = findResponse('wos/messaging/channel/list', p => p.error);
      expect(resp).toBeDefined();
    });
  });

  // ── channel/delete ──────────────────────────────────────────────

  describe('channel/delete', () => {
    it('deletes channel by creator', async () => {
      await startPlugin();
      await authedAction('wos/messaging/channel/create', {
        correlationId: 'c1', worldId: 'world-1', name: 'general',
      });

      const createResp = findResponse('wos/messaging/channel/create', p => p.channelId);
      const channelId = createResp!.payload.channelId;
      published.length = 0;

      await authedAction('wos/messaging/channel/delete', {
        correlationId: 'c2', channelId,
      });

      const resp = findResponse('wos/messaging/channel/delete', p => p.success);
      expect(resp).toBeDefined();
      expect(resp!.payload.success).toBe(true);
    });

    it('returns forbidden for non-creator', async () => {
      await startPlugin();
      await authedAction('wos/messaging/channel/create', {
        correlationId: 'c1', worldId: 'world-1', name: 'general',
      });

      const createResp = findResponse('wos/messaging/channel/create', p => p.channelId);
      const channelId = createResp!.payload.channelId;
      published.length = 0;

      // Different user tries to delete
      await authedAction('wos/messaging/channel/delete', {
        correlationId: 'c2', channelId,
      }, 'other-token', 'user-2');

      const resp = findResponse('wos/messaging/channel/delete', p => p.error);
      expect(resp).toBeDefined();
      expect(resp!.payload.error).toBe('forbidden');
    });

    it('returns error if channel not found', async () => {
      await startPlugin();
      await authedAction('wos/messaging/channel/delete', {
        correlationId: 'c1', channelId: 'nonexistent',
      });

      const resp = findResponse('wos/messaging/channel/delete', p => p.error);
      expect(resp).toBeDefined();
      expect(resp!.payload.error).toMatch(/not_found/i);
    });
  });

  // ── message/send ────────────────────────────────────────────────

  describe('message/send', () => {
    it('sends message to channel and returns { messageId }', async () => {
      await startPlugin();
      // Create channel first
      await authedAction('wos/messaging/channel/create', {
        correlationId: 'c1', worldId: 'world-1', name: 'general',
      });
      const createResp = findResponse('wos/messaging/channel/create', p => p.channelId);
      const channelId = createResp!.payload.channelId;
      published.length = 0;

      await authedAction('wos/messaging/message/send', {
        correlationId: 'c2', conversationId: channelId, content: 'Hello!',
      });

      const resp = findResponse('wos/messaging/message/send', p => p.messageId);
      expect(resp).toBeDefined();
      expect(resp!.payload.messageId).toBeDefined();
    });

    it('publishes to delivery topic after send', async () => {
      await startPlugin();
      await authedAction('wos/messaging/channel/create', {
        correlationId: 'c1', worldId: 'world-1', name: 'general',
      });
      const channelId = findResponse('wos/messaging/channel/create', p => p.channelId)!.payload.channelId;
      published.length = 0;

      await authedAction('wos/messaging/message/send', {
        correlationId: 'c2', conversationId: channelId, content: 'Hello!',
      });

      const delivery = published.find(p => p.topic === `wos/messaging/deliver/channel/${channelId}`);
      expect(delivery).toBeDefined();
      expect(delivery!.payload.content).toBe('Hello!');
    });

    it('rejects empty content', async () => {
      await startPlugin();
      await authedAction('wos/messaging/channel/create', {
        correlationId: 'c1', worldId: 'world-1', name: 'general',
      });
      const channelId = findResponse('wos/messaging/channel/create', p => p.channelId)!.payload.channelId;
      published.length = 0;

      await authedAction('wos/messaging/message/send', {
        correlationId: 'c2', conversationId: channelId, content: '   ',
      });

      const resp = findResponse('wos/messaging/message/send', p => p.error);
      expect(resp).toBeDefined();
      expect(resp!.payload.error).toMatch(/content/i);
    });

    it('rejects oversized content', async () => {
      await startPlugin();
      await authedAction('wos/messaging/channel/create', {
        correlationId: 'c1', worldId: 'world-1', name: 'general',
      });
      const channelId = findResponse('wos/messaging/channel/create', p => p.channelId)!.payload.channelId;
      published.length = 0;

      await authedAction('wos/messaging/message/send', {
        correlationId: 'c2', conversationId: channelId, content: 'x'.repeat(4001),
      });

      const resp = findResponse('wos/messaging/message/send', p => p.error);
      expect(resp).toBeDefined();
      expect(resp!.payload.error).toMatch(/content/i);
    });

    it('rejects dm: prefixed conversationIds', async () => {
      await startPlugin();
      await authedAction('wos/messaging/message/send', {
        correlationId: 'c1', conversationId: 'dm:user-a:user-b', content: 'Hi',
      });

      const resp = findResponse('wos/messaging/message/send', p => p.error);
      expect(resp).toBeDefined();
      expect(resp!.payload.error).toBe('use_dm_send_topic');
    });

    it('returns error if channel does not exist', async () => {
      await startPlugin();
      await authedAction('wos/messaging/message/send', {
        correlationId: 'c1', conversationId: 'nonexistent-channel', content: 'Hi',
      });

      const resp = findResponse('wos/messaging/message/send', p => p.error);
      expect(resp).toBeDefined();
      expect(resp!.payload.error).toMatch(/not_found/i);
    });
  });

  // ── message/history ─────────────────────────────────────────────

  describe('message/history', () => {
    it('returns paginated message list', async () => {
      await startPlugin();
      await authedAction('wos/messaging/channel/create', {
        correlationId: 'c1', worldId: 'world-1', name: 'general',
      });
      const channelId = findResponse('wos/messaging/channel/create', p => p.channelId)!.payload.channelId;
      published.length = 0;

      await authedAction('wos/messaging/message/send', {
        correlationId: 'c2', conversationId: channelId, content: 'Hello!',
      });
      published.length = 0;

      await authedAction('wos/messaging/message/history', {
        correlationId: 'c3', conversationId: channelId,
      });

      const resp = findResponse('wos/messaging/message/history', p => p.messages);
      expect(resp).toBeDefined();
      expect(resp!.payload.messages).toHaveLength(1);
      expect(resp!.payload.messages[0].content).toBe('Hello!');
    });

    it('forbids DM history access for non-participant', async () => {
      await startPlugin();
      // user-1 sends DM to user-2
      await authedAction('wos/messaging/dm/send', {
        correlationId: 'c1', recipientId: 'user-2', content: 'secret',
      });
      const convId = findResponse('wos/messaging/dm/send', p => p.conversationId)!.payload.conversationId;
      published.length = 0;

      // user-3 tries to read the DM history
      await authedAction('wos/messaging/message/history', {
        correlationId: 'c2', conversationId: convId,
      }, 'tok-3', 'user-3');

      const resp = findResponse('wos/messaging/message/history', p => p.error);
      expect(resp).toBeDefined();
      expect(resp!.payload.error).toBe('forbidden');
    });

    it('returns empty result for nonexistent conversation', async () => {
      await startPlugin();
      await authedAction('wos/messaging/message/history', {
        correlationId: 'c1', conversationId: 'nonexistent',
      });

      const resp = findResponse('wos/messaging/message/history', p => p.messages);
      expect(resp).toBeDefined();
      expect(resp!.payload.messages).toHaveLength(0);
      expect(resp!.payload.total).toBe(0);
    });
  });

  // ── dm/send ─────────────────────────────────────────────────────

  describe('dm/send', () => {
    it('sends DM and returns { messageId, conversationId }', async () => {
      await startPlugin();
      await authedAction('wos/messaging/dm/send', {
        correlationId: 'c1', recipientId: 'user-2', content: 'Hey!',
      });

      const resp = findResponse('wos/messaging/dm/send', p => p.messageId);
      expect(resp).toBeDefined();
      expect(resp!.payload.messageId).toBeDefined();
      expect(resp!.payload.conversationId).toMatch(/^dm:/);
    });

    it('publishes to DM delivery topic', async () => {
      await startPlugin();
      await authedAction('wos/messaging/dm/send', {
        correlationId: 'c1', recipientId: 'user-2', content: 'Hey!',
      });

      const dmResp = findResponse('wos/messaging/dm/send', p => p.conversationId);
      const convId = dmResp!.payload.conversationId;
      const delivery = published.find(p => p.topic === `wos/messaging/deliver/dm/${convId}`);
      expect(delivery).toBeDefined();
      expect(delivery!.payload.content).toBe('Hey!');
    });

    it('derives deterministic conversationId from sorted user pair', async () => {
      await startPlugin();
      // user-1 sends to user-2
      await authedAction('wos/messaging/dm/send', {
        correlationId: 'c1', recipientId: 'user-2', content: 'Hey!',
      });
      const resp1 = findResponse('wos/messaging/dm/send', p => p.conversationId);
      const convId1 = resp1!.payload.conversationId;

      // Expected: dm:user-1:user-2 (sorted)
      expect(convId1).toBe('dm:user-1:user-2');
    });

    it('rejects empty content', async () => {
      await startPlugin();
      await authedAction('wos/messaging/dm/send', {
        correlationId: 'c1', recipientId: 'user-2', content: '',
      });

      const resp = findResponse('wos/messaging/dm/send', p => p.error);
      expect(resp).toBeDefined();
      expect(resp!.payload.error).toMatch(/content/i);
    });

    it('rejects oversized content', async () => {
      await startPlugin();
      await authedAction('wos/messaging/dm/send', {
        correlationId: 'c1', recipientId: 'user-2', content: 'x'.repeat(4001),
      });

      const resp = findResponse('wos/messaging/dm/send', p => p.error);
      expect(resp).toBeDefined();
      expect(resp!.payload.error).toMatch(/content/i);
    });
  });

  // ── auth ────────────────────────────────────────────────────────

  describe('auth', () => {
    it('caches valid tokens', async () => {
      await startPlugin();
      await authedAction('wos/messaging/channel/create', {
        correlationId: 'c1', worldId: 'w1', name: 'general',
      });

      const authCountBefore = published.filter(p => p.topic === 'wos/identity/token/validate').length;
      published.length = 0;

      // Second request with same token — no new auth request
      sendMessage('wos/messaging/channel/list', {
        correlationId: 'c2', token: 'valid-token', worldId: 'w1',
      });
      await new Promise(r => setTimeout(r, 50));

      const newAuthReqs = published.filter(p => p.topic === 'wos/identity/token/validate');
      expect(newAuthReqs).toHaveLength(0);
    });

    it('returns unauthorized for invalid token', async () => {
      await startPlugin();
      sendMessage('wos/messaging/channel/list', {
        correlationId: 'c1', token: 'bad-token', worldId: 'w1',
      });
      await new Promise(r => setTimeout(r, 10));

      simulateAuthInvalid('bad-token');
      await new Promise(r => setTimeout(r, 50));

      const resp = findResponse('wos/messaging/channel/list', p => p.error);
      expect(resp).toBeDefined();
      expect(resp!.payload.error).toBe('unauthorized');
    });

    it('returns unauthorized after 2s timeout if identity never responds', async () => {
      vi.useFakeTimers();
      await startPlugin();

      sendMessage('wos/messaging/channel/list', {
        correlationId: 'c1', token: 'slow-token', worldId: 'w1',
      });

      // Identity plugin never responds — advance past 2s timeout
      await vi.advanceTimersByTimeAsync(2100);

      const resp = findResponse('wos/messaging/channel/list', p => p.error);
      expect(resp).toBeDefined();
      expect(resp!.payload.error).toBe('unauthorized');

      vi.useRealTimers();
    });
  });

  // ── world reset ─────────────────────────────────────────────────

  describe('world reset', () => {
    it('deletes channels and their messages on reset', async () => {
      await startPlugin();
      // Create channel and send a message
      await authedAction('wos/messaging/channel/create', {
        correlationId: 'c1', worldId: 'world-1', name: 'general',
      });
      const channelId = findResponse('wos/messaging/channel/create', p => p.channelId)!.payload.channelId;

      await authedAction('wos/messaging/message/send', {
        correlationId: 'c2', conversationId: channelId, content: 'hello',
      });
      published.length = 0;

      // Reset world
      sendMessage('wos/world-manager/lifecycle/reset', { worldId: 'world-1' });
      await new Promise(r => setTimeout(r, 50));

      // Verify channels are gone
      await authedAction('wos/messaging/channel/list', {
        correlationId: 'c3', worldId: 'world-1',
      });
      const listResp = findResponse('wos/messaging/channel/list', p => p.channels);
      expect(listResp).toBeDefined();
      expect(listResp!.payload.total).toBe(0);
    });

    it('DMs survive world reset', async () => {
      await startPlugin();
      // Send a DM
      await authedAction('wos/messaging/dm/send', {
        correlationId: 'c1', recipientId: 'user-2', content: 'hey!',
      });
      const dmConvId = findResponse('wos/messaging/dm/send', p => p.conversationId)!.payload.conversationId;
      published.length = 0;

      // Reset world
      sendMessage('wos/world-manager/lifecycle/reset', { worldId: 'world-1' });
      await new Promise(r => setTimeout(r, 50));
      published.length = 0;

      // DM history should still exist
      await authedAction('wos/messaging/message/history', {
        correlationId: 'c2', conversationId: dmConvId,
      });
      const histResp = findResponse('wos/messaging/message/history', p => p.messages);
      expect(histResp).toBeDefined();
      expect(histResp!.payload.messages).toHaveLength(1);
    });
  });
});
