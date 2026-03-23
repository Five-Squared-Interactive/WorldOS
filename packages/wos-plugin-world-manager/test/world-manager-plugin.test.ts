// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

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

describe('WorldManagerPlugin', () => {
  let plugin: InstanceType<typeof WorldManagerPlugin>;
  let testDir: string;
  let handlers: Map<string, (msg: any) => void>;
  let published: Array<{ topic: string; payload: any }>;
  let mockContext: any;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wm-plugin-'));
    await fs.mkdir(path.join(testDir, 'data'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'config'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'templates'), { recursive: true });

    handlers = new Map();
    published = [];

    mockContext = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      config: {
        world_name: 'Test World',
        world_type: 'space',
        world_owner: 'owner-1',
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
    try {
      await plugin.onStop();
    } catch {
      // Ignore
    }
    await new Promise(r => setTimeout(r, 100));
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup on Windows
    }
  });

  function callHandler(topic: string, payload: any) {
    const handler = handlers.get(topic);
    if (!handler) throw new Error(`No handler for topic: ${topic}`);
    handler({ topic, payload, timestamp: Date.now() });
  }

  // Helper to create a token validate response handler
  function setupAuthSuccess(userId = 'user-1', role = 'admin') {
    handlers.set('wos/identity/token/validate/response', (msg: any) => {});
    // Pre-populate the auth cache by calling the handler
    const validateHandler = handlers.get('wos/identity/token/validate/response');
  }

  describe('onStart', () => {
    it('should subscribe to MQTT topics', async () => {
      await plugin.onStart(mockContext);

      expect(mockContext.mqtt.subscribeWithHandler).toHaveBeenCalled();
      const topics = mockContext.mqtt.subscribeWithHandler.mock.calls.map((c: any) => c[0]);
      expect(topics).toContain('wos/world-manager/world/get');
      expect(topics).toContain('wos/world-manager/entity/create');
      expect(topics).toContain('wos/world-manager/template/list');
    });

    it('should auto-initialize world when not initialized', async () => {
      await plugin.onStart(mockContext);

      // World should be initialized from config
      const getHandler = handlers.get('wos/world-manager/world/get');
      expect(getHandler).toBeDefined();
    });

    it('should not overwrite existing world on restart', async () => {
      await plugin.onStart(mockContext);
      await plugin.onStop();

      // Start again — should load existing world
      plugin = new WorldManagerPlugin();
      published = [];
      await plugin.onStart(mockContext);

      // No lifecycle/initialized event on restart
      const initEvents = published.filter(p => p.topic === 'wos/world-manager/lifecycle/initialized');
      expect(initEvents).toHaveLength(0);
    });
  });

  describe('world/get handler', () => {
    it('should return world metadata', async () => {
      await plugin.onStart(mockContext);

      callHandler('wos/world-manager/world/get', {
        correlationId: 'c1',
        token: 'valid-token',
      });

      const response = published.find(p => p.topic === 'wos/world-manager/world/get/response');
      expect(response).toBeDefined();
      expect(response!.payload.name).toBe('Test World');
      expect(response!.payload.type).toBe('space');
    });
  });

  describe('entity CRUD handlers', () => {
    it('should create and retrieve an entity', async () => {
      await plugin.onStart(mockContext);

      // Create
      callHandler('wos/world-manager/entity/create', {
        correlationId: 'c1',
        token: 'valid-token',
        type: 'mesh',
        position: { x: 1, y: 2, z: 3 },
      });

      const createResp = published.find(p => p.topic === 'wos/world-manager/entity/create/response');
      expect(createResp).toBeDefined();
      expect(createResp!.payload.id).toBeDefined();
      expect(createResp!.payload.type).toBe('mesh');

      // Get
      published = [];
      callHandler('wos/world-manager/entity/get', {
        correlationId: 'c2',
        token: 'valid-token',
        id: createResp!.payload.id,
      });

      const getResp = published.find(p => p.topic === 'wos/world-manager/entity/get/response');
      expect(getResp).toBeDefined();
      expect(getResp!.payload.position).toEqual({ x: 1, y: 2, z: 3 });
    });

    it('should query entities', async () => {
      await plugin.onStart(mockContext);

      // Create 2 entities
      callHandler('wos/world-manager/entity/create', {
        correlationId: 'c1', token: 'valid-token', type: 'mesh',
      });
      callHandler('wos/world-manager/entity/create', {
        correlationId: 'c2', token: 'valid-token', type: 'light',
      });

      published = [];
      callHandler('wos/world-manager/entity/query', {
        correlationId: 'c3', token: 'valid-token',
      });

      const queryResp = published.find(p => p.topic === 'wos/world-manager/entity/query/response');
      expect(queryResp).toBeDefined();
      expect(queryResp!.payload.total).toBe(2);
    });

    it('should update an entity', async () => {
      await plugin.onStart(mockContext);

      callHandler('wos/world-manager/entity/create', {
        correlationId: 'c1', token: 'valid-token', type: 'mesh',
      });
      const createResp = published.find(p => p.topic === 'wos/world-manager/entity/create/response')!;

      published = [];
      callHandler('wos/world-manager/entity/update', {
        correlationId: 'c2', token: 'valid-token',
        id: createResp.payload.id,
        position: { x: 10, y: 20, z: 30 },
      });

      const updateResp = published.find(p => p.topic === 'wos/world-manager/entity/update/response');
      expect(updateResp!.payload.position).toEqual({ x: 10, y: 20, z: 30 });
    });

    it('should delete an entity', async () => {
      await plugin.onStart(mockContext);

      callHandler('wos/world-manager/entity/create', {
        correlationId: 'c1', token: 'valid-token', type: 'mesh',
      });
      const createResp = published.find(p => p.topic === 'wos/world-manager/entity/create/response')!;

      published = [];
      callHandler('wos/world-manager/entity/delete', {
        correlationId: 'c2', token: 'valid-token', id: createResp.payload.id,
      });

      const deleteResp = published.find(p => p.topic === 'wos/world-manager/entity/delete/response');
      expect(deleteResp!.payload.success).toBe(true);
    });
  });

  describe('template handlers', () => {
    it('should create and list templates', async () => {
      await plugin.onStart(mockContext);

      callHandler('wos/world-manager/template/create', {
        correlationId: 'c1', token: 'valid-token',
        name: 'tree', type: 'vegetation',
      });

      const createResp = published.find(p => p.topic === 'wos/world-manager/template/create/response');
      expect(createResp!.payload.name).toBe('tree');

      published = [];
      callHandler('wos/world-manager/template/list', {
        correlationId: 'c2', token: 'valid-token',
      });

      const listResp = published.find(p => p.topic === 'wos/world-manager/template/list/response');
      expect(listResp!.payload.total).toBe(1);
    });

    it('should instantiate a template', async () => {
      await plugin.onStart(mockContext);

      callHandler('wos/world-manager/template/create', {
        correlationId: 'c1', token: 'valid-token',
        name: 'lamp', type: 'light',
        properties: { intensity: 1.0 },
        defaultPosition: { x: 0, y: 5, z: 0 },
      });
      const templateResp = published.find(p => p.topic === 'wos/world-manager/template/create/response')!;

      published = [];
      callHandler('wos/world-manager/template/instantiate', {
        correlationId: 'c2', token: 'valid-token',
        templateId: templateResp.payload.id,
        position: { x: 10, y: 10, z: 10 },
      });

      const instResp = published.find(p => p.topic === 'wos/world-manager/template/instantiate/response');
      expect(instResp!.payload.type).toBe('light');
      expect(instResp!.payload.position).toEqual({ x: 10, y: 10, z: 10 });
    });
  });

  describe('onStop', () => {
    it('should clean up without error', async () => {
      await plugin.onStart(mockContext);
      await expect(plugin.onStop()).resolves.not.toThrow();
    });
  });

  describe('onHealthCheck', () => {
    it('should return health status', async () => {
      await plugin.onStart(mockContext);
      const health = plugin.onHealthCheck();
      expect(health.status).toBe('ok');
      expect(health.details.initialized).toBe(true);
    });
  });
});
