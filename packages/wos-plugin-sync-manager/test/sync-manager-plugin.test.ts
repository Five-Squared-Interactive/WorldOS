// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockBrokerManager, mockSyncBridge, mockSessionRouter, mockAuthBridge, mockRegionStore, mockPermissionChecker, EventEmitter } = vi.hoisted(() => {
  const { EventEmitter } = require('events');

  const mockBrokerManager = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    isRunning: true,
    pid: 12345,
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  };

  const mockSyncBridge = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    isRunning: true,
    service: {
      listSessions: vi.fn(async () => [
        { sessionId: 's1', clients: ['c1', 'c2'], entities: ['e1'] },
        { sessionId: 's2', clients: ['c3'], entities: ['e2', 'e3', 'e4'] },
      ]),
      useAuth: vi.fn(),
    },
  };

  const mockSessionRouter = {
    subscribe: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    setPermissionChecker: vi.fn(),
    setRegionStoreHook: vi.fn(),
    setTokenChangeListener: vi.fn(),
    sessionRegionMap: new Map(),
    userTokenMap: new Map(),
    currentWorldId: null,
  };

  const mockAuthBridge = {
    initialize: vi.fn(async () => {}),
    cleanup: vi.fn(async () => {}),
    createAuthMiddleware: vi.fn(() => vi.fn()),
    setUserToken: vi.fn(),
  };

  const mockRegionStore = {
    openWorld: vi.fn(),
    closeWorld: vi.fn(),
    cleanup: vi.fn(),
    isOpen: false,
  };

  const mockPermissionChecker = {
    checkSessionPermission: vi.fn(() => true),
    checkEntityPermission: vi.fn(() => true),
    checkRegionWriteFromTag: vi.fn(() => true),
    invalidateCache: vi.fn(),
  };

  return { mockBrokerManager, mockSyncBridge, mockSessionRouter, mockAuthBridge, mockRegionStore, mockPermissionChecker, EventEmitter };
});

// Mock the @worldos/plugin-sdk (L1: use hoisted EventEmitter)
vi.mock('@worldos/plugin-sdk', () => {
  class MockWOSPlugin extends EventEmitter {
    constructor() {
      super();
    }
  }
  return { WOSPlugin: MockWOSPlugin };
});

vi.mock('../src/broker-manager.js', () => ({
  BrokerManager: vi.fn(() => mockBrokerManager),
}));

vi.mock('../src/sync-bridge.js', () => ({
  SyncBridge: vi.fn(() => mockSyncBridge),
}));

vi.mock('../src/session-router.js', () => ({
  SessionRouter: vi.fn(() => mockSessionRouter),
}));

vi.mock('../src/auth-bridge.js', () => ({
  AuthBridge: vi.fn(() => mockAuthBridge),
}));

vi.mock('../src/region-store.js', () => ({
  RegionStore: vi.fn(() => mockRegionStore),
}));

vi.mock('../src/permission-checker.js', () => ({
  PermissionChecker: vi.fn(() => mockPermissionChecker),
}));

// Mock fs for directory creation
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
}));

import { SyncManagerPlugin, plugin } from '../src/index.js';
import { DEFAULT_CONFIG } from '../src/types.js';
import { BrokerManager } from '../src/broker-manager.js';
import { SyncBridge } from '../src/sync-bridge.js';
import { SessionRouter } from '../src/session-router.js';
import { AuthBridge } from '../src/auth-bridge.js';
import { RegionStore } from '../src/region-store.js';
import { PermissionChecker } from '../src/permission-checker.js';

function createMockContext(configOverrides: Record<string, unknown> = {}) {
  const handlers = new Map<string, Function>();
  return {
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    config: {
      ...configOverrides,
    },
    mqtt: {
      subscribe: vi.fn(async (topic: string, handler: Function) => {
        handlers.set(topic, handler);
      }),
      subscribeWithHandler: vi.fn(async (topic: string, handler: Function) => {
        handlers.set(topic, handler);
      }),
      publish: vi.fn(),
      publishRaw: vi.fn(),
      unsubscribe: vi.fn(),
    },
    manifest: {
      name: 'sync-manager',
    },
    serverDir: '/tmp/wos-test',
    _handlers: handlers,
  };
}

describe('SyncManagerPlugin', () => {
  let pluginInstance: SyncManagerPlugin;
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset mock state
    mockBrokerManager.isRunning = true;
    mockBrokerManager.start.mockResolvedValue(undefined);
    mockSyncBridge.isRunning = true;
    mockSyncBridge.start.mockResolvedValue(undefined);
    mockSessionRouter.subscribe.mockResolvedValue(undefined);
    mockSyncBridge.service = {
      listSessions: vi.fn(async () => [
        { sessionId: 's1', clients: ['c1', 'c2'], entities: ['e1'] },
        { sessionId: 's2', clients: ['c3'], entities: ['e2', 'e3', 'e4'] },
      ]),
      useAuth: vi.fn(),
    };
    mockAuthBridge.initialize.mockResolvedValue(undefined);
    mockAuthBridge.cleanup.mockResolvedValue(undefined);
    mockRegionStore.isOpen = false;

    pluginInstance = new SyncManagerPlugin();
    ctx = createMockContext();
    await pluginInstance.onStart(ctx as any);
  });

  afterEach(async () => {
    await pluginInstance.onStop();
  });

  describe('instantiation', () => {
    it('should create a plugin instance', () => {
      expect(pluginInstance).toBeInstanceOf(SyncManagerPlugin);
    });

    it('should export a singleton plugin instance', () => {
      expect(plugin).toBeInstanceOf(SyncManagerPlugin);
    });
  });

  describe('onStart', () => {
    it('should store the context', () => {
      expect(ctx.logger.info).toHaveBeenCalled();
    });

    it('should merge config with defaults when no overrides', async () => {
      const freshPlugin = new SyncManagerPlugin();
      const freshCtx = createMockContext();
      await freshPlugin.onStart(freshCtx as any);

      const health = await freshPlugin.onHealthCheck();
      expect(health.status).toBe('ok');
      expect(health.details).toBeDefined();

      await freshPlugin.onStop();
    });

    it('should apply config overrides from context.config', async () => {
      const freshPlugin = new SyncManagerPlugin();
      const freshCtx = createMockContext({
        sync_mqtt_tcp_port: 2883,
        heartbeat_interval_ms: 60000,
      });
      await freshPlugin.onStart(freshCtx as any);

      expect(freshCtx.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Sync manager started')
      );

      await freshPlugin.onStop();
    });

    it('should log startup message with WorldSync 2.0', () => {
      expect(ctx.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Sync manager started with WorldSync 2.0')
      );
    });

    // Task 2.4: BrokerManager lifecycle
    it('should create and start BrokerManager with correct config', () => {
      expect(BrokerManager).toHaveBeenCalledWith(ctx.logger);
      expect(mockBrokerManager.start).toHaveBeenCalledWith(
        expect.objectContaining({
          tcpPort: DEFAULT_CONFIG.sync_mqtt_tcp_port,
          wsPort: DEFAULT_CONFIG.sync_mqtt_ws_port,
          mosquittoPath: DEFAULT_CONFIG.mosquitto_path,
        }),
      );
    });

    // Task 2.4: SyncBridge lifecycle
    it('should create and start SyncBridge after BrokerManager', () => {
      expect(SyncBridge).toHaveBeenCalledWith(
        expect.objectContaining({
          sync_mqtt_host: DEFAULT_CONFIG.sync_mqtt_host,
          sync_mqtt_tcp_port: DEFAULT_CONFIG.sync_mqtt_tcp_port,
        }),
        ctx.logger,
      );
      expect(mockSyncBridge.start).toHaveBeenCalled();
    });

    // Task 2.4: SessionRouter lifecycle
    it('should create SessionRouter and subscribe to WOS bus topics', () => {
      expect(SessionRouter).toHaveBeenCalledWith(
        mockSyncBridge,
        ctx.mqtt,
        ctx.logger,
      );
      expect(mockSessionRouter.subscribe).toHaveBeenCalled();
    });

    // Task 2.4: Sequential startup order
    it('should start components in correct order: broker → bridge → router', () => {
      const brokerStartOrder = mockBrokerManager.start.mock.invocationCallOrder[0];
      const bridgeStartOrder = mockSyncBridge.start.mock.invocationCallOrder[0];
      const routerSubscribeOrder = mockSessionRouter.subscribe.mock.invocationCallOrder[0];

      expect(brokerStartOrder).toBeLessThan(bridgeStartOrder);
      expect(bridgeStartOrder).toBeLessThan(routerSubscribeOrder);
    });

    // Task 2.4: BrokerManager crash handler
    it('should register a crash handler on BrokerManager', () => {
      expect(mockBrokerManager.on).toHaveBeenCalledWith('crashed', expect.any(Function));
    });
  });

  describe('onStart rollback on failure', () => {
    it('should cleanup broker if SyncBridge.start() fails', async () => {
      const freshPlugin = new SyncManagerPlugin();
      const freshCtx = createMockContext();
      mockSyncBridge.start.mockRejectedValueOnce(new Error('Bridge connection failed'));

      await expect(freshPlugin.onStart(freshCtx as any)).rejects.toThrow('Bridge connection failed');

      expect(mockBrokerManager.stop).toHaveBeenCalled();
      expect(mockBrokerManager.removeAllListeners).toHaveBeenCalled();
    });

    it('should cleanup broker and bridge if SessionRouter.subscribe() fails', async () => {
      const freshPlugin = new SyncManagerPlugin();
      const freshCtx = createMockContext();
      mockSessionRouter.subscribe.mockRejectedValueOnce(new Error('Subscribe failed'));

      await expect(freshPlugin.onStart(freshCtx as any)).rejects.toThrow('Subscribe failed');

      expect(mockSyncBridge.stop).toHaveBeenCalled();
      expect(mockBrokerManager.stop).toHaveBeenCalled();
      expect(mockBrokerManager.removeAllListeners).toHaveBeenCalled();
    });

    it('should be startable again after a failed start', async () => {
      const freshPlugin = new SyncManagerPlugin();
      const freshCtx = createMockContext();
      mockSyncBridge.start.mockRejectedValueOnce(new Error('transient'));

      await expect(freshPlugin.onStart(freshCtx as any)).rejects.toThrow('transient');

      // Second attempt succeeds
      await expect(freshPlugin.onStart(freshCtx as any)).resolves.not.toThrow();
      await freshPlugin.onStop();
    });
  });

  describe('onStop', () => {
    it('should stop all components in reverse order', async () => {
      await pluginInstance.onStop();

      expect(mockSessionRouter.stop).toHaveBeenCalled();
      expect(mockSyncBridge.stop).toHaveBeenCalled();
      expect(mockBrokerManager.stop).toHaveBeenCalled();
    });

    it('should stop router before bridge, bridge before broker', async () => {
      await pluginInstance.onStop();

      const routerStopOrder = mockSessionRouter.stop.mock.invocationCallOrder[0];
      const bridgeStopOrder = mockSyncBridge.stop.mock.invocationCallOrder[0];
      const brokerStopOrder = mockBrokerManager.stop.mock.invocationCallOrder[0];

      expect(routerStopOrder).toBeLessThan(bridgeStopOrder);
      expect(bridgeStopOrder).toBeLessThan(brokerStopOrder);
    });

    it('should remove crash listeners from BrokerManager', async () => {
      await pluginInstance.onStop();
      expect(mockBrokerManager.removeAllListeners).toHaveBeenCalled();
    });

    it('should clean up all references', async () => {
      await pluginInstance.onStop();
      // Calling onStop again should be idempotent
      await expect(pluginInstance.onStop()).resolves.not.toThrow();
    });

    it('should log shutdown message', async () => {
      await pluginInstance.onStop();
      expect(ctx.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Sync manager stopped')
      );
    });
  });

  describe('onHealthCheck', () => {
    it('should return ok when both broker and bridge are running', async () => {
      const health = await pluginInstance.onHealthCheck();
      expect(health.status).toBe('ok');
    });

    it('should include mosquittoRunning and worldSyncRunning in details', async () => {
      const health = await pluginInstance.onHealthCheck();
      expect(health.details).toHaveProperty('mosquittoRunning', true);
      expect(health.details).toHaveProperty('worldSyncRunning', true);
    });

    it('should include session, client, and entity counts from arrays', async () => {
      const health = await pluginInstance.onHealthCheck();
      expect(health.details).toHaveProperty('activeSessions', 2);
      expect(health.details).toHaveProperty('connectedClients', 3);
      expect(health.details).toHaveProperty('totalEntities', 4);
    });

    it('should include counts from numeric clientCount/entityCount fields', async () => {
      mockSyncBridge.service = {
        listSessions: vi.fn(async () => [
          { sessionId: 's1', clientCount: 5, entityCount: 10 },
        ]),
      };
      const health = await pluginInstance.onHealthCheck();
      expect(health.details).toHaveProperty('activeSessions', 1);
      expect(health.details).toHaveProperty('connectedClients', 5);
      expect(health.details).toHaveProperty('totalEntities', 10);
    });

    it('should return degraded when broker is down', async () => {
      mockBrokerManager.isRunning = false;
      const health = await pluginInstance.onHealthCheck();
      expect(health.status).toBe('degraded');
    });

    it('should return unhealthy when both are down', async () => {
      mockBrokerManager.isRunning = false;
      mockSyncBridge.isRunning = false;
      const health = await pluginInstance.onHealthCheck();
      expect(health.status).toBe('unhealthy');
    });

    it('should return degraded when bridge is down but broker is up', async () => {
      mockSyncBridge.isRunning = false;
      const health = await pluginInstance.onHealthCheck();
      expect(health.status).toBe('degraded');
    });

    it('should return valid HealthCheckResult shape', async () => {
      const health = await pluginInstance.onHealthCheck();
      expect(['ok', 'degraded', 'unhealthy']).toContain(health.status);
    });
  });

  describe('Task 4.3: auth + permission wiring', () => {
    it('should create and initialize AuthBridge on start', () => {
      expect(AuthBridge).toHaveBeenCalledWith(
        ctx.mqtt,
        ctx.logger,
        DEFAULT_CONFIG.token_cache_ttl_ms,
      );
      expect(mockAuthBridge.initialize).toHaveBeenCalled();
    });

    it('should create RegionStore with resolved paths', () => {
      expect(RegionStore).toHaveBeenCalledWith(
        expect.any(String), // resolved worldDbPath
        expect.any(String), // resolved regionsBasePath
        ctx.logger,
      );
    });

    it('should create PermissionChecker with RegionStore and SessionRouter', () => {
      expect(PermissionChecker).toHaveBeenCalledWith(
        mockRegionStore,
        mockSessionRouter,
        ctx.logger,
        DEFAULT_CONFIG.permission_cache_ttl_ms,
      );
    });

    it('should wire auth middleware into WorldSync service', () => {
      expect(mockAuthBridge.createAuthMiddleware).toHaveBeenCalledWith(mockPermissionChecker);
      expect(mockSyncBridge.service.useAuth).toHaveBeenCalled();
    });

    it('should cleanup AuthBridge on stop', async () => {
      await pluginInstance.onStop();
      expect(mockAuthBridge.cleanup).toHaveBeenCalled();
    });

    it('should cleanup RegionStore on stop', async () => {
      await pluginInstance.onStop();
      expect(mockRegionStore.cleanup).toHaveBeenCalled();
    });

    it('should wire regionStoreHook on SessionRouter (F1)', () => {
      expect(mockSessionRouter.setRegionStoreHook).toHaveBeenCalledWith(mockRegionStore);
    });

    it('should wire tokenChangeListener on SessionRouter (F7)', () => {
      expect(mockSessionRouter.setTokenChangeListener).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should wire permission pre-check on SessionRouter (F9)', () => {
      expect(mockSessionRouter.setPermissionChecker).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('config defaults', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_CONFIG.sync_mqtt_host).toBe('localhost');
      expect(DEFAULT_CONFIG.sync_mqtt_tcp_port).toBe(1883);
      expect(DEFAULT_CONFIG.sync_mqtt_ws_port).toBe(8083);
      expect(DEFAULT_CONFIG.mosquitto_path).toBe('mosquitto');
      expect(DEFAULT_CONFIG.heartbeat_interval_ms).toBe(30000);
      expect(DEFAULT_CONFIG.max_entities_per_session).toBe(10000);
      expect(DEFAULT_CONFIG.max_clients_per_session).toBe(100);
      expect(DEFAULT_CONFIG.persistence_enabled).toBe(false);
      expect(DEFAULT_CONFIG.persistence_backend).toBe('sqlite');
      expect(DEFAULT_CONFIG.token_cache_ttl_ms).toBe(300000);
      expect(DEFAULT_CONFIG.permission_cache_ttl_ms).toBe(30000);
    });
  });
});

describe('parseRegionFromTag', () => {
  it('should parse valid tag', async () => {
    const { parseRegionFromTag } = await import('../src/types.js');
    expect(parseRegionFromTag('world.5.10')).toEqual({ x: 5, y: 10 });
  });

  it('should parse tag with zero coords', async () => {
    const { parseRegionFromTag } = await import('../src/types.js');
    expect(parseRegionFromTag('world.0.0')).toEqual({ x: 0, y: 0 });
  });

  it('should parse tag with negative coords', async () => {
    const { parseRegionFromTag } = await import('../src/types.js');
    expect(parseRegionFromTag('world.-3.7')).toEqual({ x: -3, y: 7 });
  });

  it('should return null for invalid tag format', async () => {
    const { parseRegionFromTag } = await import('../src/types.js');
    expect(parseRegionFromTag('invalid')).toBeNull();
    expect(parseRegionFromTag('world.5')).toBeNull();
    expect(parseRegionFromTag('world.a.b')).toBeNull();
    expect(parseRegionFromTag('')).toBeNull();
    expect(parseRegionFromTag('region.5.10')).toBeNull();
  });
});
