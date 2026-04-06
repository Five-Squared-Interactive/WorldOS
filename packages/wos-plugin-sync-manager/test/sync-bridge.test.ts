// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted to create mocks that are available inside vi.mock factories
const { mockWorldSyncService, mockMqttClient, mockConnect } = vi.hoisted(() => {
  const mockWorldSyncService = {
    start: vi.fn(),
    stop: vi.fn(),
    useAuth: vi.fn(),
    createSession: vi.fn(),
    joinSession: vi.fn(),
    exitSession: vi.fn(),
    destroySession: vi.fn(),
    listSessions: vi.fn(() => []),
    getSessionInfo: vi.fn(),
    createEntity: vi.fn(),
    deleteEntity: vi.fn(),
  };

  const mockMqttClient = {
    on: vi.fn(),
    subscribe: vi.fn((_topic: string, _opts: any, cb: Function) => cb && cb(null)),
    publish: vi.fn((_topic: string, _msg: any, _opts: any, cb: Function) => cb && cb(null)),
    end: vi.fn((_force: boolean, cb: Function) => cb && cb()),
    connected: true,
  };

  const mockConnect = vi.fn(() => {
    setTimeout(() => {
      const connectCb = mockMqttClient.on.mock.calls.find((c: any[]) => c[0] === 'connect');
      if (connectCb) connectCb[1]();
    }, 0);
    return mockMqttClient;
  });

  return { mockWorldSyncService, mockMqttClient, mockConnect };
});

vi.mock('@fivesquaredinteractive/worldsync', () => ({
  WorldSyncService: vi.fn(() => mockWorldSyncService),
}));

vi.mock('mqtt', () => ({
  default: { connect: mockConnect },
  connect: mockConnect,
}));

import { SyncBridge } from '../src/sync-bridge.js';
import { DEFAULT_CONFIG } from '../src/types.js';

function createMockLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('SyncBridge', () => {
  let bridge: SyncBridge;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createMockLogger();
    bridge = new SyncBridge(DEFAULT_CONFIG, logger as any);
  });

  afterEach(async () => {
    if (bridge.isRunning) {
      await bridge.stop();
    }
  });

  describe('config mapping', () => {
    it('should map SyncManagerConfig to WorldSyncConfig', async () => {
      const { WorldSyncService } = await import('@fivesquaredinteractive/worldsync');

      await bridge.start();

      expect(WorldSyncService).toHaveBeenCalledWith(
        expect.objectContaining({
          mqtt: expect.objectContaining({
            host: DEFAULT_CONFIG.sync_mqtt_host,
            port: DEFAULT_CONFIG.sync_mqtt_tcp_port,
          }),
          heartbeatIntervalMs: DEFAULT_CONFIG.heartbeat_interval_ms,
          maxEntitiesPerSession: DEFAULT_CONFIG.max_entities_per_session,
          maxClientsPerSession: DEFAULT_CONFIG.max_clients_per_session,
        }),
      );
    });

    it('should map persistence config with backend', async () => {
      const { WorldSyncService } = await import('@fivesquaredinteractive/worldsync');
      const config = { ...DEFAULT_CONFIG, persistence_enabled: true, persistence_backend: 'sqlite' as const };
      bridge = new SyncBridge(config, logger as any);

      await bridge.start();

      expect(WorldSyncService).toHaveBeenCalledWith(
        expect.objectContaining({
          persistence: expect.objectContaining({
            enabled: true,
            backend: 'sqlite',
            path: DEFAULT_CONFIG.persistence_path,
          }),
        }),
      );
    });
  });

  describe('start', () => {
    it('should create and start WorldSyncService', async () => {
      await bridge.start();

      expect(mockWorldSyncService.start).toHaveBeenCalled();
    });

    it('should connect MQTT client to Mosquitto broker', async () => {
      await bridge.start();

      expect(mockConnect).toHaveBeenCalledWith(
        expect.stringContaining(`mqtt://${DEFAULT_CONFIG.sync_mqtt_host}:${DEFAULT_CONFIG.sync_mqtt_tcp_port}`),
        expect.any(Object),
      );
    });

    it('should subscribe to wsync/# on Mosquitto', async () => {
      await bridge.start();

      expect(mockMqttClient.subscribe).toHaveBeenCalledWith(
        'wsync/#',
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('should set isRunning to true after start', async () => {
      expect(bridge.isRunning).toBe(false);
      await bridge.start();
      expect(bridge.isRunning).toBe(true);
    });

    it('should expose the WorldSyncService instance', async () => {
      await bridge.start();
      expect(bridge.service).toBe(mockWorldSyncService);
    });
  });

  describe('stop', () => {
    it('should disconnect MQTT client and stop service', async () => {
      await bridge.start();
      await bridge.stop();

      expect(mockMqttClient.end).toHaveBeenCalled();
      expect(mockWorldSyncService.stop).toHaveBeenCalled();
    });

    it('should set isRunning to false', async () => {
      await bridge.start();
      await bridge.stop();

      expect(bridge.isRunning).toBe(false);
    });

    it('should be idempotent', async () => {
      await bridge.start();
      await bridge.stop();
      await expect(bridge.stop()).resolves.not.toThrow();
    });
  });
});
