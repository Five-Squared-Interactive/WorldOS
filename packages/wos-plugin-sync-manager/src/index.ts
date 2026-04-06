// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import * as path from 'path';
import { WOSPlugin } from '@worldos/plugin-sdk';
import type { PluginContext, HealthCheckResult } from '@worldos/plugin-sdk';
import { DEFAULT_CONFIG } from './types.js';
import type { SyncManagerConfig } from './types.js';
import { BrokerManager } from './broker-manager.js';
import { SyncBridge } from './sync-bridge.js';
import { SessionRouter } from './session-router.js';
import { AuthBridge } from './auth-bridge.js';
import { RegionStore } from './region-store.js';
import { PermissionChecker } from './permission-checker.js';

export class SyncManagerPlugin extends WOSPlugin {
  private _ctx: PluginContext | null = null;
  private _syncConfig: SyncManagerConfig = { ...DEFAULT_CONFIG };
  private _brokerManager: BrokerManager | null = null;
  private _syncBridge: SyncBridge | null = null;
  private _sessionRouter: SessionRouter | null = null;
  private _authBridge: AuthBridge | null = null;
  private _regionStore: RegionStore | null = null;
  private _permissionChecker: PermissionChecker | null = null;

  constructor() {
    super();
  }

  async onStart(context: PluginContext): Promise<void> {
    this._ctx = context;
    this._syncConfig = { ...DEFAULT_CONFIG, ...context.config } as SyncManagerConfig;

    // 1. Start BrokerManager (spawn Mosquitto, await TCP readiness)
    this._brokerManager = new BrokerManager(context.logger);
    this._brokerManager.on('crashed', ({ code, signal }: { code: number | null; signal: string | null }) => {
      context.logger.error(`Mosquitto crashed unexpectedly (code=${code}, signal=${signal})`);
    });

    try {
      await this._brokerManager.start({
        tcpPort: this._syncConfig.sync_mqtt_tcp_port,
        wsPort: this._syncConfig.sync_mqtt_ws_port,
        mosquittoPath: this._syncConfig.mosquitto_path,
      });
    } catch (err) {
      // Cleanup broker on failure
      this._brokerManager.removeAllListeners();
      this._brokerManager = null;
      throw err;
    }

    // 2. Start SyncBridge (connect WorldSyncService + MQTT to Mosquitto)
    this._syncBridge = new SyncBridge(this._syncConfig, context.logger);
    try {
      await this._syncBridge.start();
    } catch (err) {
      // Rollback: stop broker on bridge failure
      await this._brokerManager.stop();
      this._brokerManager.removeAllListeners();
      this._brokerManager = null;
      this._syncBridge = null;
      throw err;
    }

    // 3. Create SessionRouter and subscribe to WOS bus topics
    this._sessionRouter = new SessionRouter(this._syncBridge, context.mqtt, context.logger);
    try {
      await this._sessionRouter.subscribe();
    } catch (err) {
      // Rollback: stop bridge and broker on router failure
      await this._syncBridge.stop();
      this._syncBridge = null;
      await this._brokerManager.stop();
      this._brokerManager.removeAllListeners();
      this._brokerManager = null;
      this._sessionRouter = null;
      throw err;
    }

    // 4. Create RegionStore with resolved paths
    const serverDir = (context as any).serverDir || process.cwd();
    const worldDbPath = path.resolve(serverDir, this._syncConfig.world_db_path);
    const regionsBasePath = path.resolve(serverDir, this._syncConfig.regions_base_path);
    this._regionStore = new RegionStore(worldDbPath, regionsBasePath, context.logger);

    // 5. Create AuthBridge and initialize
    this._authBridge = new AuthBridge(context.mqtt, context.logger, this._syncConfig.token_cache_ttl_ms);
    await this._authBridge.initialize();

    // 6. Create PermissionChecker and wire auth middleware
    this._permissionChecker = new PermissionChecker(
      this._regionStore,
      this._sessionRouter,
      context.logger,
      this._syncConfig.permission_cache_ttl_ms,
    );

    if (this._syncBridge.service) {
      const middleware = this._authBridge.createAuthMiddleware(this._permissionChecker);
      this._syncBridge.service.useAuth(middleware);
    }

    // Wire world/open and world/close to RegionStore (F1)
    this._sessionRouter.setRegionStoreHook(this._regionStore);

    // Wire token changes from SessionRouter to AuthBridge (F7)
    this._sessionRouter.setTokenChangeListener((userId, token) => {
      this._authBridge!.setUserToken(userId, token);
    });

    // Wire session.create pre-check: validate token → check region write (F9)
    const authBridgeRef = this._authBridge;
    const permCheckerRef = this._permissionChecker;
    this._sessionRouter.setPermissionChecker(async (clientToken: string, tag: string) => {
      const validation = await authBridgeRef.validateToken(clientToken);
      if (!validation.valid) {
        return false;
      }
      return permCheckerRef.checkRegionWriteFromTag(tag, validation.userId);
    });

    context.logger.info('Sync manager started with WorldSync 2.0');
  }

  async onStop(): Promise<void> {
    // Reverse order: auth → region → router → bridge → broker
    if (this._authBridge) {
      await this._authBridge.cleanup();
      this._authBridge = null;
    }

    if (this._regionStore) {
      this._regionStore.cleanup();
      this._regionStore = null;
    }

    this._permissionChecker = null;

    if (this._sessionRouter) {
      await this._sessionRouter.stop();
      this._sessionRouter = null;
    }

    if (this._syncBridge) {
      await this._syncBridge.stop();
      this._syncBridge = null;
    }

    if (this._brokerManager) {
      this._brokerManager.removeAllListeners();
      await this._brokerManager.stop();
      this._brokerManager = null;
    }

    if (this._ctx) {
      this._ctx.logger.info('Sync manager stopped');
    }
    this._ctx = null;
    this._syncConfig = { ...DEFAULT_CONFIG };
  }

  async onHealthCheck(): Promise<HealthCheckResult> {
    const brokerRunning = this._brokerManager?.isRunning ?? false;
    const bridgeRunning = this._syncBridge?.isRunning ?? false;

    // Determine status
    let status: 'ok' | 'degraded' | 'unhealthy';
    if (!brokerRunning && !bridgeRunning) {
      status = 'unhealthy';
    } else if (!brokerRunning || !bridgeRunning) {
      status = 'degraded';
    } else {
      status = 'ok';
    }

    // Get counts from WorldSync service
    let activeSessions = 0;
    let connectedClients = 0;
    let totalEntities = 0;

    if (this._syncBridge?.service) {
      try {
        const sessions = await this._syncBridge.service.listSessions();
        activeSessions = sessions.length;
        for (const session of sessions) {
          const s = session as unknown as Record<string, unknown>;
          // Handle both array and numeric count shapes from WorldSync
          connectedClients += Array.isArray(s.clients)
            ? s.clients.length
            : (typeof s.clientCount === 'number' ? s.clientCount : 0);
          totalEntities += Array.isArray(s.entities)
            ? s.entities.length
            : (typeof s.entityCount === 'number' ? s.entityCount : 0);
        }
      } catch {
        // Service may be unavailable
      }
    }

    return {
      status,
      details: {
        mosquittoRunning: brokerRunning,
        worldSyncRunning: bridgeRunning,
        activeSessions,
        connectedClients,
        totalEntities,
      },
    };
  }

  get config(): SyncManagerConfig {
    return this._syncConfig;
  }
}

// Export singleton plugin instance
export const plugin = new SyncManagerPlugin();

// Re-export types
export * from './types.js';

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
    console.error(`[sync-manager] Failed to start: ${err.message}`);
    process.exit(1);
  });

  const shutdown = () => {
    plugin.stop().then(() => process.exit(0)).catch(() => process.exit(1));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
