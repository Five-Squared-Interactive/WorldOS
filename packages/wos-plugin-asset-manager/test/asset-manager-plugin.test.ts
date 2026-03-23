// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('@worldos/plugin-sdk', () => ({
  WOSPlugin: class WOSPlugin {},
}));

describe('AssetManagerPlugin', () => {
  let tmpDir: string;
  let plugin: any;
  let mockMqtt: any;
  let published: Array<{ topic: string; payload: any }>;
  let handlers: Map<string, (msg: any) => void>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-plugin-test-'));
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

    const { AssetManagerPlugin } = await import('../src/index.js');
    plugin = new AssetManagerPlugin();
  });

  afterEach(async () => {
    try { await plugin.onStop(); } catch { /* ignore */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function startPlugin() {
    await plugin.onStart({
      serverDir: tmpDir,
      config: {},
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      mqtt: mockMqtt,
      manifest: { name: 'asset-manager' },
    });
  }

  function sendMessage(topic: string, payload: any) {
    const handler = handlers.get(topic);
    if (!handler) throw new Error(`No handler for ${topic}`);
    handler({ topic, payload });
  }

  function simulateAuthSuccess(token: string) {
    // Find the auth request that was published
    const authReq = published.find(p => p.topic === 'wos/identity/token/validate');
    if (!authReq) throw new Error('No auth request published');
    const correlationId = authReq.payload.correlationId;

    // Simulate identity plugin response
    const authHandler = handlers.get('wos/identity/token/validate/response');
    if (!authHandler) throw new Error('No auth response handler');
    authHandler({ topic: 'wos/identity/token/validate/response', payload: {
      correlationId, valid: true, userId: 'user-1', role: 'user', token,
    }});
  }

  async function createAssetAuthed(overrides: any = {}) {
    const token = 'valid-token';
    const payload = {
      correlationId: 'corr-1',
      token,
      worldId: 'world-1',
      fileName: 'texture.png',
      fileData: Buffer.from('test-data').toString('base64'),
      ...overrides,
    };

    sendMessage('wos/asset-manager/asset/create', payload);
    // Wait for async auth
    await new Promise(r => setTimeout(r, 10));
    simulateAuthSuccess(token);
    // Wait for async handler
    await new Promise(r => setTimeout(r, 50));
  }

  describe('onStart', () => {
    it('subscribes to MQTT topics', async () => {
      await startPlugin();
      const topics = [...handlers.keys()];
      expect(topics).toContain('wos/identity/token/validate/response');
      expect(topics).toContain('wos/world-manager/lifecycle/reset');
      expect(topics).toContain('wos/asset-manager/asset/create');
      expect(topics).toContain('wos/asset-manager/asset/get');
      expect(topics).toContain('wos/asset-manager/asset/list');
      expect(topics).toContain('wos/asset-manager/asset/delete');
      expect(topics).toContain('wos/asset-manager/asset/usage');
    });

    it('creates data directory', async () => {
      await startPlugin();
      expect(fs.existsSync(path.join(tmpDir, 'data'))).toBe(true);
    });
  });

  describe('onStop', () => {
    it('cleans up without error', async () => {
      await startPlugin();
      await expect(plugin.onStop()).resolves.not.toThrow();
    });
  });

  describe('onHealthCheck', () => {
    it('delegates to health module', async () => {
      await startPlugin();
      const result = await plugin.onHealthCheck();
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('details');
    });
  });

  describe('asset/create handler', () => {
    it('returns error if missing required fields', async () => {
      await startPlugin();
      sendMessage('wos/asset-manager/asset/create', { correlationId: 'c1' });
      await new Promise(r => setTimeout(r, 10));

      const response = published.find(p => p.topic === 'wos/asset-manager/asset/create/response');
      expect(response).toBeDefined();
      expect(response!.payload.error).toMatch(/missing/i);
    });

    it('returns error without token', async () => {
      await startPlugin();
      sendMessage('wos/asset-manager/asset/create', {
        correlationId: 'c1', worldId: 'w1', fileName: 'f.png', fileData: 'abc=',
      });
      await new Promise(r => setTimeout(r, 10));

      const response = published.find(p => p.topic === 'wos/asset-manager/asset/create/response');
      expect(response).toBeDefined();
      expect(response!.payload.error).toBe('unauthorized');
    });

    it('creates asset with valid auth and returns { id, url }', async () => {
      await startPlugin();
      await createAssetAuthed();

      const response = published.find(p =>
        p.topic === 'wos/asset-manager/asset/create/response' && p.payload.id,
      );
      expect(response).toBeDefined();
      expect(response!.payload.id).toBeDefined();
      expect(response!.payload.url).toMatch(/^assets\/world-1\//);
      expect(response!.payload.correlationId).toBe('corr-1');
    });

    it('rejects oversized base64 payload', async () => {
      await startPlugin();
      // 50MB decoded = ~67MB base64. We check string length > 67_108_864
      // For test, we mock the check by sending a message with a flag.
      // The actual size check is on fileData.length
      sendMessage('wos/asset-manager/asset/create', {
        correlationId: 'c1', token: 'valid-token',
        worldId: 'w1', fileName: 'f.png',
        fileData: 'a'.repeat(67_108_865), // Just over the limit
      });
      await new Promise(r => setTimeout(r, 10));

      const response = published.find(p =>
        p.topic === 'wos/asset-manager/asset/create/response' && p.payload.error,
      );
      expect(response).toBeDefined();
      expect(response!.payload.error).toMatch(/size|too large/i);
    });
  });

  describe('asset/get handler', () => {
    it('returns error if asset not found', async () => {
      await startPlugin();
      const token = 'valid-token';
      sendMessage('wos/asset-manager/asset/get', {
        correlationId: 'c1', token, worldId: 'w1', assetId: 'nonexistent',
      });
      await new Promise(r => setTimeout(r, 10));
      simulateAuthSuccess(token);
      await new Promise(r => setTimeout(r, 50));

      const response = published.find(p =>
        p.topic === 'wos/asset-manager/asset/get/response' && p.payload.error,
      );
      expect(response).toBeDefined();
      expect(response!.payload.error).toMatch(/not found/i);
    });
  });

  describe('asset/list handler', () => {
    it('returns paginated list', async () => {
      await startPlugin();
      await createAssetAuthed();
      // Token is now cached from create — list won't need new auth
      published.length = 0;

      sendMessage('wos/asset-manager/asset/list', {
        correlationId: 'c2', token: 'valid-token', worldId: 'world-1',
      });
      await new Promise(r => setTimeout(r, 50));

      const response = published.find(p =>
        p.topic === 'wos/asset-manager/asset/list/response' && p.payload.assets,
      );
      expect(response).toBeDefined();
      expect(response!.payload.assets.length).toBeGreaterThan(0);
      expect(response!.payload.total).toBeDefined();
      expect(response!.payload.limit).toBeDefined();
      expect(response!.payload.offset).toBeDefined();
    });
  });

  describe('asset/delete handler', () => {
    it('returns error if asset not found', async () => {
      await startPlugin();
      const token = 'valid-token';
      sendMessage('wos/asset-manager/asset/delete', {
        correlationId: 'c1', token, worldId: 'w1', assetId: 'nonexistent',
      });
      await new Promise(r => setTimeout(r, 10));
      simulateAuthSuccess(token);
      await new Promise(r => setTimeout(r, 50));

      const response = published.find(p =>
        p.topic === 'wos/asset-manager/asset/delete/response' && p.payload.error,
      );
      expect(response).toBeDefined();
      expect(response!.payload.error).toMatch(/not found/i);
    });
  });

  describe('asset/usage handler', () => {
    it('returns storage usage stats', async () => {
      await startPlugin();
      const token = 'valid-token';
      sendMessage('wos/asset-manager/asset/usage', {
        correlationId: 'c1', token, worldId: 'world-1',
      });
      await new Promise(r => setTimeout(r, 10));
      simulateAuthSuccess(token);
      await new Promise(r => setTimeout(r, 50));

      const response = published.find(p =>
        p.topic === 'wos/asset-manager/asset/usage/response' && p.payload.usedBytes !== undefined,
      );
      expect(response).toBeDefined();
      expect(response!.payload).toHaveProperty('usedBytes');
      expect(response!.payload).toHaveProperty('totalBytes');
      expect(response!.payload).toHaveProperty('assetCount');
    });
  });

  describe('auth', () => {
    it('caches valid tokens', async () => {
      await startPlugin();
      await createAssetAuthed();

      // Second request with same token should not generate new auth request
      const authCountBefore = published.filter(p => p.topic === 'wos/identity/token/validate').length;
      published.length = 0;

      sendMessage('wos/asset-manager/asset/list', {
        correlationId: 'c2', token: 'valid-token', worldId: 'world-1',
      });
      await new Promise(r => setTimeout(r, 50));

      const newAuthReqs = published.filter(p => p.topic === 'wos/identity/token/validate');
      expect(newAuthReqs).toHaveLength(0); // Token was cached
    });

    it('returns unauthorized for invalid token', async () => {
      await startPlugin();
      const token = 'bad-token';
      sendMessage('wos/asset-manager/asset/list', {
        correlationId: 'c1', token, worldId: 'w1',
      });
      await new Promise(r => setTimeout(r, 10));

      // Simulate invalid auth response
      const authReq = published.find(p => p.topic === 'wos/identity/token/validate');
      const authHandler = handlers.get('wos/identity/token/validate/response')!;
      authHandler({ topic: 'wos/identity/token/validate/response', payload: {
        correlationId: authReq!.payload.correlationId, valid: false, token,
      }});
      await new Promise(r => setTimeout(r, 50));

      const response = published.find(p =>
        p.topic === 'wos/asset-manager/asset/list/response' && p.payload.error,
      );
      expect(response).toBeDefined();
      expect(response!.payload.error).toBe('unauthorized');
    });
  });

  describe('world reset cleanup', () => {
    it('deletes all assets for world on lifecycle reset', async () => {
      await startPlugin();
      await createAssetAuthed();

      // Trigger world reset
      sendMessage('wos/world-manager/lifecycle/reset', { worldId: 'world-1' });
      await new Promise(r => setTimeout(r, 50));

      // Verify assets are gone
      published.length = 0;
      const token = 'valid-token';
      sendMessage('wos/asset-manager/asset/list', {
        correlationId: 'c3', token, worldId: 'world-1',
      });
      await new Promise(r => setTimeout(r, 50));

      const response = published.find(p =>
        p.topic === 'wos/asset-manager/asset/list/response' && p.payload.total !== undefined,
      );
      expect(response).toBeDefined();
      expect(response!.payload.total).toBe(0);
    });
  });
});
