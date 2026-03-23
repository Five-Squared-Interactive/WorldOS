// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

/**
 * E2E integration tests for world-manager plugin.
 * Uses real SQLite (better-sqlite3), real TemplateLoader, and mock MQTT.
 * Exercises full flows through the WorldManagerPlugin class.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Mock the SDK module
vi.mock('@worldos/plugin-sdk', () => {
  class WOSPlugin {
    get name() { return 'world-manager'; }
    get version() { return '1.0.0'; }
  }
  return { WOSPlugin };
});

// Import after mock
const { WorldManagerPlugin } = await import('../src/index.js');

describe('World Manager E2E', () => {
  let plugin: InstanceType<typeof WorldManagerPlugin>;
  let testDir: string;
  let handlers: Map<string, (msg: any) => void>;
  let published: Array<{ topic: string; payload: any }>;
  let mockContext: any;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wm-e2e-'));
    await fs.mkdir(path.join(testDir, 'data'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'config'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'templates'), { recursive: true });

    handlers = new Map();
    published = [];

    mockContext = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      config: {
        world_name: 'E2E World',
        world_type: 'space',
        world_owner: 'owner-e2e',
        data_dir: './data',
        templates_path: './templates',
      },
      mqtt: {
        subscribeWithHandler: vi.fn((topic: string, handler: any) => {
          handlers.set(topic, handler);
        }),
        publishRaw: vi.fn((topic: string, payload: string) => {
          published.push({ topic, payload: JSON.parse(payload) });
        }),
      },
      manifest: { name: 'world-manager', version: '1.0.0' },
      serverDir: testDir,
    };

    plugin = new WorldManagerPlugin();
  });

  afterEach(async () => {
    try { await plugin.onStop(); } catch { /* ignore */ }
    await new Promise(r => setTimeout(r, 100));
    try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* ignore Windows */ }
  });

  function call(topic: string, payload: any) {
    const handler = handlers.get(topic);
    if (!handler) throw new Error(`No handler for topic: ${topic}`);
    handler({ topic, payload, timestamp: Date.now() });
  }

  function getResponse(topic: string) {
    return published.find(p => p.topic === `${topic}/response`);
  }

  function getResponses(topic: string) {
    return published.filter(p => p.topic === `${topic}/response`);
  }

  function clearPublished() {
    published = [];
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  describe('full lifecycle', () => {
    it('should auto-initialize, serve data, stop, restart, and resume', async () => {
      // Start — should auto-initialize
      await plugin.onStart(mockContext);

      const initEvent = published.find(p => p.topic === 'wos/world-manager/lifecycle/initialized');
      expect(initEvent).toBeDefined();
      expect(initEvent!.payload.name).toBe('E2E World');
      expect(initEvent!.payload.type).toBe('space');

      // Query world
      clearPublished();
      call('wos/world-manager/world/get', { correlationId: 'g1' });
      const world = getResponse('wos/world-manager/world/get');
      expect(world!.payload.name).toBe('E2E World');
      expect(world!.payload.owner).toBe('owner-e2e');

      // Create some entities
      clearPublished();
      call('wos/world-manager/entity/create', { correlationId: 'e1', type: 'mesh', position: { x: 1, y: 2, z: 3 } });
      call('wos/world-manager/entity/create', { correlationId: 'e2', type: 'light' });
      const entityIds = getResponses('wos/world-manager/entity/create').map(r => r.payload.id);
      expect(entityIds).toHaveLength(2);

      // Health check while running
      const health = plugin.onHealthCheck();
      expect(health.status).toBe('ok');
      expect(health.details.entityCount).toBe(2);

      // Stop
      await plugin.onStop();

      // Restart with same testDir — should NOT re-initialize
      plugin = new WorldManagerPlugin();
      clearPublished();
      await plugin.onStart(mockContext);

      const reInitEvents = published.filter(p => p.topic === 'wos/world-manager/lifecycle/initialized');
      expect(reInitEvents).toHaveLength(0);

      // Entities should still exist after restart
      clearPublished();
      call('wos/world-manager/entity/query', { correlationId: 'q1' });
      const queryResp = getResponse('wos/world-manager/entity/query');
      expect(queryResp!.payload.total).toBe(2);
    });
  });

  // ── Entity CRUD Flow ──────────────────────────────────────────

  describe('entity CRUD flow', () => {
    beforeEach(async () => {
      await plugin.onStart(mockContext);
      clearPublished();
    });

    it('should create → get → update → get → delete → get (not found)', () => {
      // Create
      call('wos/world-manager/entity/create', {
        correlationId: 'c1', type: 'mesh',
        position: { x: 0, y: 0, z: 0 },
        properties: { color: 'red' },
      });
      const created = getResponse('wos/world-manager/entity/create')!.payload;
      expect(created.id).toBeDefined();
      expect(created.type).toBe('mesh');
      expect(created.properties).toEqual({ color: 'red' });

      // Get
      clearPublished();
      call('wos/world-manager/entity/get', { correlationId: 'g1', id: created.id });
      const fetched = getResponse('wos/world-manager/entity/get')!.payload;
      expect(fetched.position).toEqual({ x: 0, y: 0, z: 0 });

      // Update
      clearPublished();
      call('wos/world-manager/entity/update', {
        correlationId: 'u1', id: created.id,
        position: { x: 10, y: 20, z: 30 },
        properties: { color: 'blue', size: 5 },
      });
      const updated = getResponse('wos/world-manager/entity/update')!.payload;
      expect(updated.position).toEqual({ x: 10, y: 20, z: 30 });
      expect(updated.properties).toEqual({ color: 'blue', size: 5 });

      // Get after update
      clearPublished();
      call('wos/world-manager/entity/get', { correlationId: 'g2', id: created.id });
      const reFetched = getResponse('wos/world-manager/entity/get')!.payload;
      expect(reFetched.position).toEqual({ x: 10, y: 20, z: 30 });

      // Delete
      clearPublished();
      call('wos/world-manager/entity/delete', { correlationId: 'd1', id: created.id });
      const deleteResp = getResponse('wos/world-manager/entity/delete')!.payload;
      expect(deleteResp.success).toBe(true);

      // Get after delete — not found
      clearPublished();
      call('wos/world-manager/entity/get', { correlationId: 'g3', id: created.id });
      const notFound = getResponse('wos/world-manager/entity/get')!.payload;
      expect(notFound.error).toBe('not_found');
    });

    it('should handle parent-child relationships (F5, F11)', () => {
      // Create parent
      call('wos/world-manager/entity/create', { correlationId: 'p1', type: 'group' });
      const parent = getResponse('wos/world-manager/entity/create')!.payload;

      // Create children
      clearPublished();
      call('wos/world-manager/entity/create', { correlationId: 'c1', type: 'mesh', parentId: parent.id });
      call('wos/world-manager/entity/create', { correlationId: 'c2', type: 'light', parentId: parent.id });
      const children = getResponses('wos/world-manager/entity/create').map(r => r.payload);

      // Get parent — should list children
      clearPublished();
      call('wos/world-manager/entity/get', { correlationId: 'g1', id: parent.id });
      const parentEntity = getResponse('wos/world-manager/entity/get')!.payload;
      expect(parentEntity.children).toHaveLength(2);
      expect(parentEntity.children).toContain(children[0].id);
      expect(parentEntity.children).toContain(children[1].id);

      // Delete parent — children should become root (F11: ON DELETE SET NULL)
      clearPublished();
      call('wos/world-manager/entity/delete', { correlationId: 'd1', id: parent.id });

      clearPublished();
      call('wos/world-manager/entity/get', { correlationId: 'g2', id: children[0].id });
      const orphan = getResponse('wos/world-manager/entity/get')!.payload;
      expect(orphan.parentId).toBeNull();
    });

    it('should query with type filter and pagination', () => {
      // Create 5 mesh + 3 light entities
      for (let i = 0; i < 5; i++) {
        call('wos/world-manager/entity/create', { correlationId: `m${i}`, type: 'mesh' });
      }
      for (let i = 0; i < 3; i++) {
        call('wos/world-manager/entity/create', { correlationId: `l${i}`, type: 'light' });
      }

      // Query all
      clearPublished();
      call('wos/world-manager/entity/query', { correlationId: 'q1' });
      expect(getResponse('wos/world-manager/entity/query')!.payload.total).toBe(8);

      // Query by type
      clearPublished();
      call('wos/world-manager/entity/query', { correlationId: 'q2', type: 'mesh' });
      expect(getResponse('wos/world-manager/entity/query')!.payload.total).toBe(5);

      // Paginate
      clearPublished();
      call('wos/world-manager/entity/query', { correlationId: 'q3', limit: 3, offset: 0 });
      const page = getResponse('wos/world-manager/entity/query')!.payload;
      expect(page.entities).toHaveLength(3);
      expect(page.total).toBe(8);
    });
  });

  // ── Template Flow ─────────────────────────────────────────────

  describe('template flow', () => {
    beforeEach(async () => {
      await plugin.onStart(mockContext);
      clearPublished();
    });

    it('should create template → list → instantiate → verify entity', () => {
      // Create template
      call('wos/world-manager/template/create', {
        correlationId: 't1', name: 'tree', type: 'vegetation',
        properties: { height: 10, species: 'oak' },
        defaultPosition: { x: 0, y: 0, z: 0 },
        defaultScale: { x: 1, y: 1, z: 1 },
      });
      const template = getResponse('wos/world-manager/template/create')!.payload;
      expect(template.name).toBe('tree');
      expect(template.type).toBe('vegetation');

      // List templates
      clearPublished();
      call('wos/world-manager/template/list', { correlationId: 'l1' });
      const list = getResponse('wos/world-manager/template/list')!.payload;
      expect(list.total).toBe(1);
      expect(list.templates[0].name).toBe('tree');

      // Instantiate with position override
      clearPublished();
      call('wos/world-manager/template/instantiate', {
        correlationId: 'i1', templateId: template.id,
        position: { x: 50, y: 0, z: 50 },
        owner: 'player-1',
      });
      const entity = getResponse('wos/world-manager/template/instantiate')!.payload;
      expect(entity.type).toBe('vegetation');
      expect(entity.position).toEqual({ x: 50, y: 0, z: 50 });
      expect(entity.properties).toEqual({ height: 10, species: 'oak' });

      // Verify entity exists via query
      clearPublished();
      call('wos/world-manager/entity/query', { correlationId: 'q1' });
      expect(getResponse('wos/world-manager/entity/query')!.payload.total).toBe(1);
    });

    it('should get template by ID and delete it', () => {
      call('wos/world-manager/template/create', {
        correlationId: 't1', name: 'lamp', type: 'light',
      });
      const template = getResponse('wos/world-manager/template/create')!.payload;

      // Get by ID
      clearPublished();
      call('wos/world-manager/template/get', { correlationId: 'g1', id: template.id });
      const fetched = getResponse('wos/world-manager/template/get')!.payload;
      expect(fetched.name).toBe('lamp');

      // Delete
      clearPublished();
      call('wos/world-manager/template/delete', { correlationId: 'd1', id: template.id });
      expect(getResponse('wos/world-manager/template/delete')!.payload.success).toBe(true);

      // Get after delete — not found
      clearPublished();
      call('wos/world-manager/template/get', { correlationId: 'g2', id: template.id });
      expect(getResponse('wos/world-manager/template/get')!.payload.error).toBe('not_found');
    });

    it('should reject duplicate template names', () => {
      call('wos/world-manager/template/create', {
        correlationId: 't1', name: 'unique-name', type: 'mesh',
      });
      expect(getResponse('wos/world-manager/template/create')!.payload.id).toBeDefined();

      clearPublished();
      call('wos/world-manager/template/create', {
        correlationId: 't2', name: 'unique-name', type: 'light',
      });
      expect(getResponse('wos/world-manager/template/create')!.payload.error).toBeDefined();
    });

    it('should return error when instantiating non-existent template', () => {
      call('wos/world-manager/template/instantiate', {
        correlationId: 'i1', templateId: 'non-existent-id',
      });
      expect(getResponse('wos/world-manager/template/instantiate')!.payload.error).toBe('template_not_found');
    });
  });

  // ── World Update & Reset ──────────────────────────────────────

  describe('world update and reset', () => {
    beforeEach(async () => {
      await plugin.onStart(mockContext);
      clearPublished();
    });

    it('should update world name and settings', () => {
      call('wos/world-manager/world/update', {
        correlationId: 'u1',
        name: 'Updated World',
        description: 'A brave new world',
        settings: { gravity: false },
      });

      const updated = getResponse('wos/world-manager/world/update')!.payload;
      expect(updated.name).toBe('Updated World');
      expect(updated.description).toBe('A brave new world');

      // Verify lifecycle event
      const lifecycleEvent = published.find(p => p.topic === 'wos/world-manager/lifecycle/updated');
      expect(lifecycleEvent).toBeDefined();
      expect(lifecycleEvent!.payload.name).toBe('Updated World');

      // Verify via world/get
      clearPublished();
      call('wos/world-manager/world/get', { correlationId: 'g1' });
      const world = getResponse('wos/world-manager/world/get')!.payload;
      expect(world.name).toBe('Updated World');
      expect(world.description).toBe('A brave new world');
    });

    it('should reset world (wipe entities, new ID)', () => {
      // Create some entities first
      call('wos/world-manager/entity/create', { correlationId: 'e1', type: 'mesh' });
      call('wos/world-manager/entity/create', { correlationId: 'e2', type: 'light' });

      // Get current world ID
      clearPublished();
      call('wos/world-manager/world/get', { correlationId: 'g1' });
      const oldId = getResponse('wos/world-manager/world/get')!.payload.id;

      // Reset
      clearPublished();
      call('wos/world-manager/world/reset', {
        correlationId: 'r1',
        name: 'Fresh World',
        type: 'custom',
      });
      const resetResp = getResponse('wos/world-manager/world/reset')!.payload;
      expect(resetResp.name).toBe('Fresh World');
      expect(resetResp.type).toBe('custom');
      expect(resetResp.id).not.toBe(oldId);

      // Verify lifecycle event
      const resetEvent = published.find(p => p.topic === 'wos/world-manager/lifecycle/reset');
      expect(resetEvent).toBeDefined();

      // Verify entities are gone
      clearPublished();
      call('wos/world-manager/entity/query', { correlationId: 'q1' });
      expect(getResponse('wos/world-manager/entity/query')!.payload.total).toBe(0);
    });

    it('should reject init when already initialized', () => {
      call('wos/world-manager/world/init', {
        correlationId: 'i1',
        name: 'Should Fail',
      });
      expect(getResponse('wos/world-manager/world/init')!.payload.error).toBe('already_initialized');
    });
  });

  // ── World Template (file-based) Flow ──────────────────────────

  describe('world template flow', () => {
    it('should load and serve world templates from config file', async () => {
      // Write a templates config file
      const templatesConfig = {
        templates: [
          {
            name: 'forest-world',
            description: 'A lush forest world',
            allowedTypes: ['space', 'custom'],
            file: 'forest.json',
          },
          {
            name: 'ocean-world',
            description: 'An underwater world',
            allowedTypes: ['planet'],
            file: 'ocean.json',
          },
        ],
      };
      await fs.writeFile(
        path.join(testDir, 'config', 'templates.json'),
        JSON.stringify(templatesConfig),
      );

      // Write a template data file
      await fs.writeFile(
        path.join(testDir, 'templates', 'forest.json'),
        JSON.stringify({
          metadata: { name: 'Forest World', type: 'space' },
          entities: [{ type: 'tree', position: { x: 0, y: 0, z: 0 } }],
        }),
      );

      await plugin.onStart(mockContext);
      clearPublished();

      // List all world templates
      call('wos/world-manager/world-template/list', { correlationId: 'l1' });
      const list = getResponse('wos/world-manager/world-template/list')!.payload;
      expect(list.templates).toHaveLength(2);

      // Filter by world type
      clearPublished();
      call('wos/world-manager/world-template/list', { correlationId: 'l2', worldType: 'planet' });
      const planetList = getResponse('wos/world-manager/world-template/list')!.payload;
      expect(planetList.templates).toHaveLength(1);
      expect(planetList.templates[0].name).toBe('ocean-world');

      // Get specific template
      clearPublished();
      call('wos/world-manager/world-template/get', { correlationId: 'g1', name: 'forest-world' });
      const tmpl = getResponse('wos/world-manager/world-template/get')!.payload;
      expect(tmpl.name).toBe('forest-world');
      expect(tmpl.description).toBe('A lush forest world');

      // Get non-existent
      clearPublished();
      call('wos/world-manager/world-template/get', { correlationId: 'g2', name: 'missing' });
      expect(getResponse('wos/world-manager/world-template/get')!.payload.error).toBe('not_found');

      // Validate template for world type
      clearPublished();
      call('wos/world-manager/world-template/validate', { correlationId: 'v1', name: 'forest-world', worldType: 'space' });
      const valid = getResponse('wos/world-manager/world-template/validate')!.payload;
      expect(valid.valid).toBe(true);

      // Validate template for wrong world type
      clearPublished();
      call('wos/world-manager/world-template/validate', { correlationId: 'v2', name: 'forest-world', worldType: 'planet' });
      const invalid = getResponse('wos/world-manager/world-template/validate')!.payload;
      expect(invalid.valid).toBe(false);
    });
  });

  // ── Concurrent Operations ─────────────────────────────────────

  describe('concurrent entity operations', () => {
    beforeEach(async () => {
      await plugin.onStart(mockContext);
      clearPublished();
    });

    it('should handle rapid create/update/delete without corruption', () => {
      const ids: string[] = [];

      // Rapid-fire creates
      for (let i = 0; i < 20; i++) {
        call('wos/world-manager/entity/create', {
          correlationId: `c${i}`, type: i % 2 === 0 ? 'mesh' : 'light',
          position: { x: i, y: 0, z: 0 },
        });
      }
      const creates = getResponses('wos/world-manager/entity/create');
      expect(creates).toHaveLength(20);
      creates.forEach(r => {
        expect(r.payload.id).toBeDefined();
        expect(r.payload.error).toBeUndefined();
        ids.push(r.payload.id);
      });

      // Update half of them
      clearPublished();
      for (let i = 0; i < 10; i++) {
        call('wos/world-manager/entity/update', {
          correlationId: `u${i}`, id: ids[i],
          position: { x: 100 + i, y: 100, z: 100 },
        });
      }
      const updates = getResponses('wos/world-manager/entity/update');
      expect(updates).toHaveLength(10);
      updates.forEach(r => expect(r.payload.error).toBeUndefined());

      // Delete the other half
      clearPublished();
      for (let i = 10; i < 20; i++) {
        call('wos/world-manager/entity/delete', {
          correlationId: `d${i}`, id: ids[i],
        });
      }
      const deletes = getResponses('wos/world-manager/entity/delete');
      expect(deletes).toHaveLength(10);
      deletes.forEach(r => expect(r.payload.success).toBe(true));

      // Verify final state
      clearPublished();
      call('wos/world-manager/entity/query', { correlationId: 'q1' });
      const query = getResponse('wos/world-manager/entity/query')!.payload;
      expect(query.total).toBe(10);
    });
  });

  // ── Error Handling ────────────────────────────────────────────

  describe('error handling', () => {
    beforeEach(async () => {
      await plugin.onStart(mockContext);
      clearPublished();
    });

    it('should return not_found for non-existent entity get', () => {
      call('wos/world-manager/entity/get', { correlationId: 'g1', id: 'does-not-exist' });
      expect(getResponse('wos/world-manager/entity/get')!.payload.error).toBe('not_found');
    });

    it('should return not_found for non-existent entity update', () => {
      call('wos/world-manager/entity/update', {
        correlationId: 'u1', id: 'does-not-exist',
        position: { x: 0, y: 0, z: 0 },
      });
      expect(getResponse('wos/world-manager/entity/update')!.payload.error).toBe('not_found');
    });

    it('should return false for non-existent entity delete', () => {
      call('wos/world-manager/entity/delete', { correlationId: 'd1', id: 'does-not-exist' });
      expect(getResponse('wos/world-manager/entity/delete')!.payload.success).toBe(false);
    });

    it('should return error for invalid entity type', () => {
      call('wos/world-manager/entity/create', {
        correlationId: 'c1', type: '',
      });
      expect(getResponse('wos/world-manager/entity/create')!.payload.error).toBeDefined();
    });
  });

  // ── Health Check ──────────────────────────────────────────────

  describe('health check integration', () => {
    it('should report unhealthy before start', () => {
      const health = plugin.onHealthCheck();
      expect(health.status).toBe('unhealthy');
    });

    it('should report ok after start with entity counts', async () => {
      await plugin.onStart(mockContext);
      clearPublished();

      call('wos/world-manager/entity/create', { correlationId: 'e1', type: 'mesh' });
      call('wos/world-manager/entity/create', { correlationId: 'e2', type: 'mesh' });
      call('wos/world-manager/entity/create', { correlationId: 'e3', type: 'light' });

      const health = plugin.onHealthCheck();
      expect(health.status).toBe('ok');
      expect(health.details.entityCount).toBe(3);
      expect(health.details.initialized).toBe(true);
    });
  });
});
