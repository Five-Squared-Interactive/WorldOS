// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { AuthBridge } from '../../src/auth-bridge.js';
import { RegionStore } from '../../src/region-store.js';
import { PermissionChecker } from '../../src/permission-checker.js';

function createMockMqttClient() {
  const handlers = new Map<string, Function>();
  return {
    subscribeWithHandler: vi.fn(async (topic: string, handler: Function) => {
      handlers.set(topic, handler);
    }),
    unsubscribe: vi.fn(async () => {}),
    publishRaw: vi.fn(),
    _handlers: handlers,
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function simulateIdentityResponse(mqtt: any, response: Record<string, unknown>) {
  const handler = mqtt._handlers.get('wos/identity/token/validate/response');
  if (!handler) throw new Error('No handler for identity response topic');
  handler({ topic: 'wos/identity/token/validate/response', payload: response, timestamp: Date.now() });
}

function createWorldDb(dbPath: string, regions: Array<{ x: number; y: number; owner: string; owner_read?: number | null; owner_write?: number | null; other_read?: number | null; other_write?: number | null }>) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS region_registry (
      x_index INTEGER NOT NULL,
      y_index INTEGER NOT NULL,
      owner TEXT NOT NULL,
      owner_read INTEGER,
      owner_write INTEGER,
      other_read INTEGER,
      other_write INTEGER,
      PRIMARY KEY (x_index, y_index)
    )
  `);
  const insert = db.prepare('INSERT INTO region_registry (x_index, y_index, owner, owner_read, owner_write, other_read, other_write) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const r of regions) {
    insert.run(r.x, r.y, r.owner, r.owner_read ?? null, r.owner_write ?? null, r.other_read ?? null, r.other_write ?? null);
  }
  db.close();
}

function createRegionDb(dbPath: string, entities: Array<{ instance_id: string; owner: string; owner_write?: number | null; other_write?: number | null }> = []) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      instance_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      owner_write INTEGER,
      other_write INTEGER
    )
  `);
  const insert = db.prepare('INSERT INTO entities (instance_id, owner, owner_write, other_write) VALUES (?, ?, ?, ?)');
  for (const e of entities) {
    insert.run(e.instance_id, e.owner, e.owner_write ?? null, e.other_write ?? null);
  }
  db.close();
}

describe('Auth + Permissions Integration', () => {
  let tmpDir: string;
  let mqtt: ReturnType<typeof createMockMqttClient>;
  let logger: ReturnType<typeof createMockLogger>;
  let authBridge: AuthBridge;
  let regionStore: RegionStore;
  let permissionChecker: PermissionChecker;

  // Mock session router with region mapping
  const sessionRegionMap = new Map<string, { x: number; y: number }>();
  const mockSessionRouter = {
    getRegionCoords: (sessionId: string) => sessionRegionMap.get(sessionId) ?? null,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-perm-integration-'));

    mqtt = createMockMqttClient();
    logger = createMockLogger();

    // Set up world DB with two regions
    const worldDbPath = path.join(tmpDir, 'world.db');
    createWorldDb(worldDbPath, [
      { x: 5, y: 10, owner: 'owner-alice', owner_read: 1, owner_write: 1, other_read: 1, other_write: 0 },
      { x: 3, y: 7, owner: 'owner-bob', owner_read: 1, owner_write: 1, other_read: 0, other_write: 0 },
    ]);

    // Set up region DB with entities
    createRegionDb(path.join(tmpDir, 'region_5_10.db'), [
      { instance_id: 'ent-1', owner: 'owner-alice', owner_write: 1, other_write: 0 },
    ]);

    // Session mapping
    sessionRegionMap.clear();
    sessionRegionMap.set('sess-region-5-10', { x: 5, y: 10 });
    sessionRegionMap.set('sess-region-3-7', { x: 3, y: 7 });

    // Initialize components
    regionStore = new RegionStore(worldDbPath, tmpDir, logger as any);
    regionStore.openWorld();

    authBridge = new AuthBridge(mqtt as any, logger as any, 300000);
    await authBridge.initialize();

    permissionChecker = new PermissionChecker(regionStore, mockSessionRouter as any, logger as any, 30000);
  });

  afterEach(async () => {
    await authBridge.cleanup();
    regionStore.cleanup();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should allow region owner to join session after token validation', async () => {
    const middleware = authBridge.createAuthMiddleware(permissionChecker);

    // Set up token
    authBridge.setUserToken('alice-client', 'jwt-alice');

    // Start validation + simulate identity response
    const middlewarePromise = middleware(
      { type: 'session.join', sessionId: 'sess-region-5-10' },
      { clientId: 'alice-client' },
    );

    const cid = mqtt.publishRaw.mock.calls[0][1].correlationId;
    simulateIdentityResponse(mqtt, {
      correlationId: cid,
      valid: true,
      payload: { userId: 'owner-alice', role: 'player' },
    });

    const result = await middlewarePromise;
    expect(result).toBe(true);
  });

  it('should deny non-owner with other_read=0 from joining private region', async () => {
    const middleware = authBridge.createAuthMiddleware(permissionChecker);

    authBridge.setUserToken('visitor-client', 'jwt-visitor');

    const middlewarePromise = middleware(
      { type: 'session.join', sessionId: 'sess-region-3-7' },
      { clientId: 'visitor-client' },
    );

    const cid = mqtt.publishRaw.mock.calls[0][1].correlationId;
    simulateIdentityResponse(mqtt, {
      correlationId: cid,
      valid: true,
      payload: { userId: 'visitor-user', role: 'player' },
    });

    const result = await middlewarePromise;
    expect(result).toBe(false);
  });

  it('should allow non-owner with other_read=1 to join public region', async () => {
    const middleware = authBridge.createAuthMiddleware(permissionChecker);

    authBridge.setUserToken('visitor-client', 'jwt-visitor');

    const middlewarePromise = middleware(
      { type: 'session.join', sessionId: 'sess-region-5-10' },
      { clientId: 'visitor-client' },
    );

    const cid = mqtt.publishRaw.mock.calls[0][1].correlationId;
    simulateIdentityResponse(mqtt, {
      correlationId: cid,
      valid: true,
      payload: { userId: 'visitor-user', role: 'player' },
    });

    const result = await middlewarePromise;
    expect(result).toBe(true);
  });

  it('should deny non-owner entity write (other_write=0)', async () => {
    const middleware = authBridge.createAuthMiddleware(permissionChecker);

    authBridge.setUserToken('visitor-client', 'jwt-visitor');

    const middlewarePromise = middleware(
      { type: 'entity.update.position', sessionId: 'sess-region-5-10', entityId: 'ent-1' },
      { clientId: 'visitor-client' },
    );

    const cid = mqtt.publishRaw.mock.calls[0][1].correlationId;
    simulateIdentityResponse(mqtt, {
      correlationId: cid,
      valid: true,
      payload: { userId: 'visitor-user', role: 'player' },
    });

    const result = await middlewarePromise;
    expect(result).toBe(false);
  });

  it('should allow entity owner to update their own entity', async () => {
    const middleware = authBridge.createAuthMiddleware(permissionChecker);

    authBridge.setUserToken('alice-client', 'jwt-alice');

    const middlewarePromise = middleware(
      { type: 'entity.update.position', sessionId: 'sess-region-5-10', entityId: 'ent-1' },
      { clientId: 'alice-client' },
    );

    const cid = mqtt.publishRaw.mock.calls[0][1].correlationId;
    simulateIdentityResponse(mqtt, {
      correlationId: cid,
      valid: true,
      payload: { userId: 'owner-alice', role: 'player' },
    });

    const result = await middlewarePromise;
    expect(result).toBe(true);
  });

  it('should use token cache on second call (no new MQTT publish)', async () => {
    const middleware = authBridge.createAuthMiddleware(permissionChecker);

    authBridge.setUserToken('alice-client', 'jwt-alice');

    // First call — triggers MQTT
    const p1 = middleware(
      { type: 'session.join', sessionId: 'sess-region-5-10' },
      { clientId: 'alice-client' },
    );
    const cid = mqtt.publishRaw.mock.calls[0][1].correlationId;
    simulateIdentityResponse(mqtt, {
      correlationId: cid,
      valid: true,
      payload: { userId: 'owner-alice', role: 'player' },
    });
    await p1;

    // Second call — should use cache
    const result = await middleware(
      { type: 'session.join', sessionId: 'sess-region-5-10' },
      { clientId: 'alice-client' },
    );
    expect(result).toBe(true);
    expect(mqtt.publishRaw).toHaveBeenCalledTimes(1); // Only one MQTT call
  });

  it('should deny when identity returns invalid token', async () => {
    const middleware = authBridge.createAuthMiddleware(permissionChecker);

    authBridge.setUserToken('bad-client', 'jwt-expired');

    const middlewarePromise = middleware(
      { type: 'session.join', sessionId: 'sess-region-5-10' },
      { clientId: 'bad-client' },
    );

    const cid = mqtt.publishRaw.mock.calls[0][1].correlationId;
    simulateIdentityResponse(mqtt, {
      correlationId: cid,
      valid: false,
    });

    const result = await middlewarePromise;
    expect(result).toBe(false);
  });

  it('should handle multiple users with different permissions on same region', async () => {
    const middleware = authBridge.createAuthMiddleware(permissionChecker);

    // Owner — should be able to write
    authBridge.setUserToken('alice-client', 'jwt-alice');
    const p1 = middleware(
      { type: 'entity.create', sessionId: 'sess-region-5-10', entityId: 'new-ent' },
      { clientId: 'alice-client' },
    );
    const cid1 = mqtt.publishRaw.mock.calls[0][1].correlationId;
    simulateIdentityResponse(mqtt, {
      correlationId: cid1,
      valid: true,
      payload: { userId: 'owner-alice', role: 'player' },
    });
    expect(await p1).toBe(true);

    // Non-owner — should NOT be able to write (other_write=0)
    authBridge.setUserToken('visitor-client', 'jwt-visitor');
    const p2 = middleware(
      { type: 'entity.create', sessionId: 'sess-region-5-10', entityId: 'new-ent-2' },
      { clientId: 'visitor-client' },
    );
    const cid2 = mqtt.publishRaw.mock.calls[1][1].correlationId;
    simulateIdentityResponse(mqtt, {
      correlationId: cid2,
      valid: true,
      payload: { userId: 'visitor-user', role: 'player' },
    });
    expect(await p2).toBe(false);
  });
});
