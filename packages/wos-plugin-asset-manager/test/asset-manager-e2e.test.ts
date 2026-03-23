// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('@worldos/plugin-sdk', () => ({
  WOSPlugin: class WOSPlugin {},
}));

describe('Asset Manager E2E', () => {
  let tmpDir: string;
  let plugin: any;
  let mockMqtt: any;
  let published: Array<{ topic: string; payload: any }>;
  let handlers: Map<string, (msg: any) => void>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-e2e-'));
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
    const authReq = published.find(p => p.topic === 'wos/identity/token/validate');
    if (!authReq) throw new Error('No auth request published');
    const correlationId = authReq.payload.correlationId;
    const authHandler = handlers.get('wos/identity/token/validate/response');
    if (!authHandler) throw new Error('No auth response handler');
    authHandler({ topic: 'wos/identity/token/validate/response', payload: {
      correlationId, valid: true, userId: 'user-1', role: 'user', token,
    }});
  }

  async function createAsset(overrides: any = {}) {
    const token = overrides.token ?? 'valid-token';
    const payload = {
      correlationId: overrides.correlationId ?? `corr-${Date.now()}`,
      token,
      worldId: overrides.worldId ?? 'world-1',
      fileName: overrides.fileName ?? 'texture.png',
      fileData: overrides.fileData ?? Buffer.from('test-data').toString('base64'),
      ...overrides,
    };

    sendMessage('wos/asset-manager/asset/create', payload);
    await new Promise(r => setTimeout(r, 10));

    // Only simulate auth if token isn't cached yet
    const authReq = published.find(p => p.topic === 'wos/identity/token/validate');
    if (authReq) {
      simulateAuthSuccess(token);
    }

    await new Promise(r => setTimeout(r, 50));

    return published.find(p =>
      p.topic === 'wos/asset-manager/asset/create/response' && p.payload.id,
    );
  }

  // ── E2E Flow: Full Asset Lifecycle ──────────────────────────────

  it('full lifecycle: create → get → list → delete → verify gone', async () => {
    await startPlugin();

    // 1. Create
    const createResp = await createAsset({ correlationId: 'c-create' });
    expect(createResp).toBeDefined();
    const assetId = createResp!.payload.id;
    expect(assetId).toBeDefined();
    expect(createResp!.payload.url).toMatch(/^assets\/world-1\//);

    // 2. Get
    published.length = 0;
    sendMessage('wos/asset-manager/asset/get', {
      correlationId: 'c-get', token: 'valid-token', worldId: 'world-1', assetId,
    });
    await new Promise(r => setTimeout(r, 50));

    const getResp = published.find(p =>
      p.topic === 'wos/asset-manager/asset/get/response' && p.payload.asset,
    );
    expect(getResp).toBeDefined();
    expect(getResp!.payload.asset.id).toBe(assetId);
    expect(getResp!.payload.asset.name).toBe('texture.png');
    expect(getResp!.payload.asset.mimeType).toBe('image/png');
    expect(getResp!.payload.fileData).toBeDefined();

    // 3. List
    published.length = 0;
    sendMessage('wos/asset-manager/asset/list', {
      correlationId: 'c-list', token: 'valid-token', worldId: 'world-1',
    });
    await new Promise(r => setTimeout(r, 50));

    const listResp = published.find(p =>
      p.topic === 'wos/asset-manager/asset/list/response' && p.payload.assets,
    );
    expect(listResp).toBeDefined();
    expect(listResp!.payload.assets.length).toBe(1);
    expect(listResp!.payload.total).toBe(1);

    // 4. Delete
    published.length = 0;
    sendMessage('wos/asset-manager/asset/delete', {
      correlationId: 'c-del', token: 'valid-token', worldId: 'world-1', assetId,
    });
    await new Promise(r => setTimeout(r, 50));

    const delResp = published.find(p =>
      p.topic === 'wos/asset-manager/asset/delete/response' && p.payload.success,
    );
    expect(delResp).toBeDefined();
    expect(delResp!.payload.success).toBe(true);
    expect(delResp!.payload.freedBytes).toBeGreaterThan(0);

    // 5. Verify gone
    published.length = 0;
    sendMessage('wos/asset-manager/asset/get', {
      correlationId: 'c-gone', token: 'valid-token', worldId: 'world-1', assetId,
    });
    await new Promise(r => setTimeout(r, 50));

    const goneResp = published.find(p =>
      p.topic === 'wos/asset-manager/asset/get/response' && p.payload.error,
    );
    expect(goneResp).toBeDefined();
    expect(goneResp!.payload.error).toMatch(/not found/i);
  });

  // ── Multi-asset operations ──────────────────────────────────────

  it('creates multiple assets and lists them with pagination', async () => {
    await startPlugin();

    // Create 3 assets
    await createAsset({ correlationId: 'c1', fileName: 'a.png' });
    published.length = 0;
    await createAsset({ correlationId: 'c2', fileName: 'b.glb' });
    published.length = 0;
    await createAsset({ correlationId: 'c3', fileName: 'c.mp3' });

    // List with limit
    published.length = 0;
    sendMessage('wos/asset-manager/asset/list', {
      correlationId: 'c-list', token: 'valid-token', worldId: 'world-1', limit: 2, offset: 0,
    });
    await new Promise(r => setTimeout(r, 50));

    const listResp = published.find(p =>
      p.topic === 'wos/asset-manager/asset/list/response' && p.payload.assets,
    );
    expect(listResp).toBeDefined();
    expect(listResp!.payload.assets.length).toBe(2);
    expect(listResp!.payload.total).toBe(3);
    expect(listResp!.payload.limit).toBe(2);
    expect(listResp!.payload.offset).toBe(0);
  });

  // ── Multi-world isolation ───────────────────────────────────────

  it('assets are isolated per world', async () => {
    await startPlugin();

    await createAsset({ correlationId: 'c1', worldId: 'world-1', fileName: 'a.png' });
    published.length = 0;
    await createAsset({ correlationId: 'c2', worldId: 'world-2', fileName: 'b.png' });

    // List world-1
    published.length = 0;
    sendMessage('wos/asset-manager/asset/list', {
      correlationId: 'c-list1', token: 'valid-token', worldId: 'world-1',
    });
    await new Promise(r => setTimeout(r, 50));

    const list1 = published.find(p =>
      p.topic === 'wos/asset-manager/asset/list/response' && p.payload.correlationId === 'c-list1',
    );
    expect(list1!.payload.total).toBe(1);

    // List world-2
    published.length = 0;
    sendMessage('wos/asset-manager/asset/list', {
      correlationId: 'c-list2', token: 'valid-token', worldId: 'world-2',
    });
    await new Promise(r => setTimeout(r, 50));

    const list2 = published.find(p =>
      p.topic === 'wos/asset-manager/asset/list/response' && p.payload.correlationId === 'c-list2',
    );
    expect(list2!.payload.total).toBe(1);
  });

  // ── Storage usage tracking ──────────────────────────────────────

  it('usage stats reflect asset operations', async () => {
    await startPlugin();

    // Initially empty
    const token = 'valid-token';
    sendMessage('wos/asset-manager/asset/usage', {
      correlationId: 'c-u1', token, worldId: 'world-1',
    });
    await new Promise(r => setTimeout(r, 10));
    simulateAuthSuccess(token);
    await new Promise(r => setTimeout(r, 50));

    const usage1 = published.find(p =>
      p.topic === 'wos/asset-manager/asset/usage/response' && p.payload.correlationId === 'c-u1',
    );
    expect(usage1!.payload.assetCount).toBe(0);
    expect(usage1!.payload.usedBytes).toBe(0);

    // Create asset
    published.length = 0;
    await createAsset({ correlationId: 'c-create' });

    // Check usage again (token cached now)
    published.length = 0;
    sendMessage('wos/asset-manager/asset/usage', {
      correlationId: 'c-u2', token, worldId: 'world-1',
    });
    await new Promise(r => setTimeout(r, 50));

    const usage2 = published.find(p =>
      p.topic === 'wos/asset-manager/asset/usage/response' && p.payload.correlationId === 'c-u2',
    );
    expect(usage2!.payload.assetCount).toBe(1);
    expect(usage2!.payload.usedBytes).toBeGreaterThan(0);
  });

  // ── World reset cleans all assets ───────────────────────────────

  it('world reset removes all assets and files', async () => {
    await startPlugin();

    await createAsset({ correlationId: 'c1', worldId: 'world-1', fileName: 'a.png' });
    published.length = 0;
    await createAsset({ correlationId: 'c2', worldId: 'world-1', fileName: 'b.glb' });

    // Verify files exist on disk
    const assetsDir = path.join(tmpDir, 'data', 'assets', 'world-1');
    expect(fs.existsSync(assetsDir)).toBe(true);

    // Trigger reset
    sendMessage('wos/world-manager/lifecycle/reset', { worldId: 'world-1' });
    await new Promise(r => setTimeout(r, 100));

    // List should be empty
    published.length = 0;
    sendMessage('wos/asset-manager/asset/list', {
      correlationId: 'c-list', token: 'valid-token', worldId: 'world-1',
    });
    await new Promise(r => setTimeout(r, 50));

    const listResp = published.find(p =>
      p.topic === 'wos/asset-manager/asset/list/response',
    );
    expect(listResp!.payload.total).toBe(0);
    expect(listResp!.payload.assets).toHaveLength(0);
  });

  // ── World reset doesn't affect other worlds ─────────────────────

  it('world reset only affects the target world', async () => {
    await startPlugin();

    await createAsset({ correlationId: 'c1', worldId: 'world-1', fileName: 'a.png' });
    published.length = 0;
    await createAsset({ correlationId: 'c2', worldId: 'world-2', fileName: 'b.png' });

    // Reset world-1 only
    sendMessage('wos/world-manager/lifecycle/reset', { worldId: 'world-1' });
    await new Promise(r => setTimeout(r, 100));

    // world-2 should still have its asset
    published.length = 0;
    sendMessage('wos/asset-manager/asset/list', {
      correlationId: 'c-list2', token: 'valid-token', worldId: 'world-2',
    });
    await new Promise(r => setTimeout(r, 50));

    const listResp = published.find(p =>
      p.topic === 'wos/asset-manager/asset/list/response',
    );
    expect(listResp!.payload.total).toBe(1);
  });

  // ── MIME type detection ─────────────────────────────────────────

  it('detects correct MIME and asset types for different file extensions', async () => {
    await startPlugin();

    // Create .glb model
    const resp = await createAsset({ correlationId: 'c-glb', fileName: 'scene.glb' });
    expect(resp).toBeDefined();
    const assetId = resp!.payload.id;

    // Get and verify types
    published.length = 0;
    sendMessage('wos/asset-manager/asset/get', {
      correlationId: 'c-get', token: 'valid-token', worldId: 'world-1', assetId,
    });
    await new Promise(r => setTimeout(r, 50));

    const getResp = published.find(p =>
      p.topic === 'wos/asset-manager/asset/get/response' && p.payload.asset,
    );
    expect(getResp!.payload.asset.mimeType).toBe('model/gltf-binary');
    expect(getResp!.payload.asset.type).toBe('model');
  });

  // ── Health check ────────────────────────────────────────────────

  it('health check reports ok after assets exist', async () => {
    await startPlugin();
    // Create an asset so assets dir exists (health returns 'degraded' without it)
    await createAsset({ correlationId: 'c-health' });
    const health = await plugin.onHealthCheck();
    expect(health.status).toBe('ok');
    expect(health.details).toHaveProperty('totalAssets');
    expect(health.details).toHaveProperty('totalSizeBytes');
  });

  it('health check reports unhealthy before start', async () => {
    const health = await plugin.onHealthCheck();
    expect(health.status).toBe('unhealthy');
  });

  // ── Auth: concurrent requests ───────────────────────────────────

  it('handles concurrent requests with same token', async () => {
    await startPlugin();

    // First request to cache the token
    await createAsset({ correlationId: 'c-warmup' });

    // Two concurrent list requests (token is cached)
    published.length = 0;
    sendMessage('wos/asset-manager/asset/list', {
      correlationId: 'c-a', token: 'valid-token', worldId: 'world-1',
    });
    sendMessage('wos/asset-manager/asset/list', {
      correlationId: 'c-b', token: 'valid-token', worldId: 'world-1',
    });
    await new Promise(r => setTimeout(r, 50));

    const respA = published.find(p =>
      p.topic === 'wos/asset-manager/asset/list/response' && p.payload.correlationId === 'c-a',
    );
    const respB = published.find(p =>
      p.topic === 'wos/asset-manager/asset/list/response' && p.payload.correlationId === 'c-b',
    );
    expect(respA).toBeDefined();
    expect(respB).toBeDefined();
  });

  // ── Error: delete non-existent asset ────────────────────────────

  it('delete returns error for non-existent asset', async () => {
    await startPlugin();

    const token = 'valid-token';
    sendMessage('wos/asset-manager/asset/delete', {
      correlationId: 'c-del', token, worldId: 'world-1', assetId: 'nonexistent',
    });
    await new Promise(r => setTimeout(r, 10));
    simulateAuthSuccess(token);
    await new Promise(r => setTimeout(r, 50));

    const resp = published.find(p =>
      p.topic === 'wos/asset-manager/asset/delete/response' && p.payload.error,
    );
    expect(resp).toBeDefined();
    expect(resp!.payload.error).toMatch(/not found/i);
  });

  // ── Plugin stop/restart ─────────────────────────────────────────

  it('survives stop and restart cycle', async () => {
    await startPlugin();
    await createAsset({ correlationId: 'c-before' });

    // Stop
    await plugin.onStop();

    // Restart
    const { AssetManagerPlugin } = await import('../src/index.js');
    plugin = new AssetManagerPlugin();
    published.length = 0;
    handlers.clear();
    await startPlugin();

    // Data should persist (same tmpDir, same DB)
    sendMessage('wos/asset-manager/asset/list', {
      correlationId: 'c-after', token: 'valid-token', worldId: 'world-1',
    });
    await new Promise(r => setTimeout(r, 10));
    simulateAuthSuccess('valid-token');
    await new Promise(r => setTimeout(r, 50));

    const listResp = published.find(p =>
      p.topic === 'wos/asset-manager/asset/list/response' && p.payload.assets,
    );
    expect(listResp).toBeDefined();
    expect(listResp!.payload.total).toBe(1);
  });

  // ── File data round-trip ────────────────────────────────────────

  it('file data round-trips correctly through base64', async () => {
    await startPlugin();

    const originalData = 'Hello World! This is test binary data: \x00\x01\x02\xFF';
    const base64Data = Buffer.from(originalData).toString('base64');

    const createResp = await createAsset({ correlationId: 'c-rt', fileData: base64Data });
    const assetId = createResp!.payload.id;

    // Get and verify data
    published.length = 0;
    sendMessage('wos/asset-manager/asset/get', {
      correlationId: 'c-get', token: 'valid-token', worldId: 'world-1', assetId,
    });
    await new Promise(r => setTimeout(r, 50));

    const getResp = published.find(p =>
      p.topic === 'wos/asset-manager/asset/get/response' && p.payload.fileData,
    );
    expect(getResp).toBeDefined();
    const recovered = Buffer.from(getResp!.payload.fileData, 'base64').toString();
    expect(recovered).toBe(originalData);
  });
});
