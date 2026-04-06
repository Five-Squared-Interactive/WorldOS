// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { parseRegionFromTag } from './types.js';
import type { RegionCoords } from './types.js';
import type { SyncBridge } from './sync-bridge.js';
import type { PluginMqttClient, Logger } from '@worldos/plugin-sdk';

export type PermissionPreCheck = (clientToken: string, tag: string) => Promise<boolean>;

export interface RegionStoreHook {
  openWorld(worldDbPath?: string): void;
  closeWorld(): void;
}

export type TokenChangeListener = (userId: string, token: string) => void;

export class SessionRouter {
  private _bridge: SyncBridge;
  private _mqtt: PluginMqttClient;
  private _logger: Logger;
  private _permissionPreCheck: PermissionPreCheck | null = null;
  private _regionStoreHook: RegionStoreHook | null = null;
  private _tokenChangeListener: TokenChangeListener | null = null;
  private _sessionRegionMap = new Map<string, RegionCoords>();
  private _userTokenMap = new Map<string, string>();
  private _currentWorldId: string | null = null;
  private _subscribedTopics: string[] = [];

  constructor(bridge: SyncBridge, mqtt: PluginMqttClient, logger: Logger) {
    this._bridge = bridge;
    this._mqtt = mqtt;
    this._logger = logger;
  }

  setPermissionChecker(checker: PermissionPreCheck): void {
    this._permissionPreCheck = checker;
  }

  setRegionStoreHook(hook: RegionStoreHook): void {
    this._regionStoreHook = hook;
  }

  setTokenChangeListener(listener: TokenChangeListener): void {
    this._tokenChangeListener = listener;
  }

  async subscribe(): Promise<void> {
    const topics = [
      'wos/sync-manager/session/create',
      'wos/sync-manager/session/destroy',
      'wos/sync-manager/session/list',
      'wos/sync-manager/session/get',
      'wos/sync-manager/world/open',
      'wos/sync-manager/world/close',
      'wos/sync-manager/user/token',
    ];

    const handlers: Record<string, (payload: any) => Promise<void>> = {
      'wos/sync-manager/session/create': (p) => this._handleSessionCreate(p),
      'wos/sync-manager/session/destroy': (p) => this._handleSessionDestroy(p),
      'wos/sync-manager/session/list': (p) => this._handleSessionList(p),
      'wos/sync-manager/session/get': (p) => this._handleSessionGet(p),
      'wos/sync-manager/world/open': (p) => this._handleWorldOpen(p),
      'wos/sync-manager/world/close': (p) => this._handleWorldClose(p),
      'wos/sync-manager/user/token': (p) => this._handleUserToken(p),
    };

    for (const topic of topics) {
      await this._mqtt.subscribeWithHandler(topic, (msg: any) => handlers[topic](msg.payload));
    }

    // Legacy backward-compatible topic aliases (Epic 6)
    const legacyTopics = [
      'wos/sync/createsession',
      'wos/sync/deletesession',
      'wos/sync/getsessions',
      'wos/sync/usertoken',
      'wos/sync/openworld',
      'wos/sync/closeworld',
    ];

    const legacyHandlers: Record<string, (payload: any) => Promise<void>> = {
      'wos/sync/createsession': (p) => this._handleLegacyCreateSession(p),
      'wos/sync/deletesession': (p) => this._handleLegacyDeleteSession(p),
      'wos/sync/getsessions': (p) => this._handleLegacyGetSessions(p),
      'wos/sync/usertoken': (p) => this._handleLegacyUserToken(p),
      'wos/sync/openworld': (p) => this._handleLegacyWorldOpen(p),
      'wos/sync/closeworld': (p) => this._handleLegacyWorldClose(p),
    };

    for (const topic of legacyTopics) {
      await this._mqtt.subscribeWithHandler(topic, (msg: any) => {
        this._logger.warn(`Topic '${topic}' is deprecated. Use 'wos/sync-manager/*' topics instead.`);
        return legacyHandlers[topic](msg.payload);
      });
    }

    this._subscribedTopics = [...topics, ...legacyTopics];
    this._logger.info('SessionRouter subscribed to WOS bus topics');
  }

  async stop(): Promise<void> {
    for (const topic of this._subscribedTopics) {
      try {
        await this._mqtt.unsubscribe(topic);
      } catch {
        // Topic may already be unsubscribed
      }
    }
    this._subscribedTopics = [];
    this._sessionRegionMap.clear();
    this._userTokenMap.clear();
    this._currentWorldId = null;
    this._logger.info('SessionRouter stopped');
  }

  getRegionCoords(sessionId: string): RegionCoords | undefined {
    return this._sessionRegionMap.get(sessionId);
  }

  getUserToken(userId: string): string | undefined {
    return this._userTokenMap.get(userId);
  }

  get currentWorldId(): string | null {
    return this._currentWorldId;
  }

  get sessionRegionMap(): Map<string, RegionCoords> {
    return this._sessionRegionMap;
  }

  get userTokenMap(): Map<string, string> {
    return this._userTokenMap;
  }

  private _requireService() {
    const svc = this._bridge.service;
    if (!svc) {
      throw new Error('SyncBridge is not running');
    }
    return svc;
  }

  private async _handleSessionCreate(payload: any): Promise<void> {
    const { correlationId, tag, clientId, clientToken } = payload;
    try {
      // Pre-check permissions before creating session (F9: use clientToken, not clientId)
      if (this._permissionPreCheck && clientToken) {
        const allowed = await this._permissionPreCheck(clientToken, tag);
        if (!allowed) {
          this._mqtt.publishRaw('wos/sync-manager/session/create/response', {
            correlationId,
            success: false,
            error: 'Permission denied',
          });
          return;
        }
      }

      const svc = this._requireService();
      const result = await svc.createSession(tag, {
        clientId,
        ...(clientToken ? { clientToken } : {}),
      });

      // Store region mapping from tag
      const coords = parseRegionFromTag(tag);
      if (coords && result.sessionId) {
        this._sessionRegionMap.set(result.sessionId, coords);
      }

      this._mqtt.publishRaw('wos/sync-manager/session/create/response', {
        correlationId,
        success: true,
        sessionId: result.sessionId,
        tag,
      });

      // Domain lifecycle event
      this._mqtt.publishRaw('wos/sync-manager/lifecycle/session-created', {
        sessionId: result.sessionId,
        tag,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      this._mqtt.publishRaw('wos/sync-manager/session/create/response', {
        correlationId,
        success: false,
        error: err.message,
      });
    }
  }

  private async _handleSessionDestroy(payload: any): Promise<void> {
    const { correlationId, sessionId } = payload;
    try {
      const svc = this._requireService();
      await svc.destroySession(sessionId);
      this._sessionRegionMap.delete(sessionId);

      this._mqtt.publishRaw('wos/sync-manager/session/destroy/response', {
        correlationId,
        success: true,
      });

      // Domain lifecycle event
      this._mqtt.publishRaw('wos/sync-manager/lifecycle/session-destroyed', {
        sessionId,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      this._mqtt.publishRaw('wos/sync-manager/session/destroy/response', {
        correlationId,
        success: false,
        error: err.message,
      });
    }
  }

  private async _handleSessionList(payload: any): Promise<void> {
    const { correlationId } = payload;
    try {
      const svc = this._requireService();
      const sessions = await svc.listSessions();
      this._mqtt.publishRaw('wos/sync-manager/session/list/response', {
        correlationId,
        sessions,
      });
    } catch (err: any) {
      this._mqtt.publishRaw('wos/sync-manager/session/list/response', {
        correlationId,
        sessions: [],
        error: err.message,
      });
    }
  }

  private async _handleSessionGet(payload: any): Promise<void> {
    const { correlationId, sessionId } = payload;
    try {
      const svc = this._requireService();
      const info = await svc.getSessionInfo(sessionId);
      this._mqtt.publishRaw('wos/sync-manager/session/get/response', {
        correlationId,
        ...info,
      });
    } catch (err: any) {
      this._mqtt.publishRaw('wos/sync-manager/session/get/response', {
        correlationId,
        error: err.message,
      });
    }
  }

  private async _handleWorldOpen(payload: any): Promise<void> {
    const { correlationId, worldId, worldDbPath } = payload;
    this._currentWorldId = worldId;

    // Open region store for this world (F1: wire world/open to regionStore)
    if (this._regionStoreHook) {
      try {
        this._regionStoreHook.openWorld(worldDbPath);
      } catch (err: any) {
        this._logger.error(`Failed to open region store: ${err.message}`);
      }
    }

    this._logger.info(`World opened: ${worldId}`);

    if (correlationId) {
      this._mqtt.publishRaw('wos/sync-manager/world/open/response', {
        correlationId,
        success: true,
        worldId,
      });
    }
  }

  private async _handleWorldClose(payload: any): Promise<void> {
    const { correlationId } = payload;
    this._currentWorldId = null;
    this._sessionRegionMap.clear();

    // Close region store (F1: wire world/close to regionStore)
    if (this._regionStoreHook) {
      try {
        this._regionStoreHook.closeWorld();
      } catch (err: any) {
        this._logger.error(`Failed to close region store: ${err.message}`);
      }
    }

    this._logger.info('World closed');

    if (correlationId) {
      this._mqtt.publishRaw('wos/sync-manager/world/close/response', {
        correlationId,
        success: true,
      });
    }
  }

  private async _handleUserToken(payload: any): Promise<void> {
    const { userId, token } = payload;
    this._userTokenMap.set(userId, token);

    // Notify AuthBridge of token change (F7: wire userTokenMap to authBridge)
    if (this._tokenChangeListener) {
      this._tokenChangeListener(userId, token);
    }

    this._logger.debug(`Token stored for user: ${userId}`);
  }

  // ── Legacy backward-compatible handlers (Epic 6) ──

  private async _handleLegacyCreateSession(payload: any): Promise<void> {
    // Legacy format: { id, tag } where `id` was caller-provided session ID.
    // WorldSync 2.0 generates IDs internally, so we use `id` as clientId instead.
    const { id, tag, clientToken } = payload;
    try {
      // Permission pre-check (same as new handler)
      if (this._permissionPreCheck && clientToken) {
        const allowed = await this._permissionPreCheck(clientToken, tag);
        if (!allowed) {
          this._mqtt.publishRaw('wos/sync/createsession/response', {
            success: false,
            error: 'Permission denied',
          });
          return;
        }
      }

      const svc = this._requireService();
      const result = await svc.createSession(tag, { clientId: id });

      const coords = parseRegionFromTag(tag);
      if (coords && result.sessionId) {
        this._sessionRegionMap.set(result.sessionId, coords);
      }

      this._mqtt.publishRaw('wos/sync/createsession/response', {
        success: true,
        sessionId: result.sessionId,
        tag,
      });

      this._mqtt.publishRaw('wos/sync-manager/lifecycle/session-created', {
        sessionId: result.sessionId,
        tag,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      this._mqtt.publishRaw('wos/sync/createsession/response', {
        success: false,
        error: err.message,
      });
    }
  }

  private async _handleLegacyDeleteSession(payload: any): Promise<void> {
    // Legacy format: { id } where `id` is session ID
    const { id } = payload;
    try {
      const svc = this._requireService();
      await svc.destroySession(id);
      this._sessionRegionMap.delete(id);

      this._mqtt.publishRaw('wos/sync/deletesession/response', {
        success: true,
      });

      this._mqtt.publishRaw('wos/sync-manager/lifecycle/session-destroyed', {
        sessionId: id,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      this._mqtt.publishRaw('wos/sync/deletesession/response', {
        success: false,
        error: err.message,
      });
    }
  }

  private async _handleLegacyGetSessions(payload: any): Promise<void> {
    try {
      const svc = this._requireService();
      const sessions = await svc.listSessions();
      this._mqtt.publishRaw('wos/sync/getsessions/response', {
        sessions,
      });
    } catch (err: any) {
      this._mqtt.publishRaw('wos/sync/getsessions/response', {
        sessions: [],
        error: err.message,
      });
    }
  }

  private async _handleLegacyUserToken(payload: any): Promise<void> {
    // Legacy format: { userid, token } (lowercase 'userid')
    const { userid, token } = payload;
    this._userTokenMap.set(userid, token);

    if (this._tokenChangeListener) {
      this._tokenChangeListener(userid, token);
    }

    this._logger.debug(`Token stored for user (legacy): ${userid}`);
  }

  private async _handleLegacyWorldOpen(payload: any): Promise<void> {
    const { worldId, worldDbPath } = payload;
    this._currentWorldId = worldId;

    if (this._regionStoreHook) {
      try {
        this._regionStoreHook.openWorld(worldDbPath);
      } catch (err: any) {
        this._logger.error(`Failed to open region store: ${err.message}`);
      }
    }

    this._logger.info(`World opened (legacy): ${worldId}`);

    this._mqtt.publishRaw('wos/sync/openworld/response', {
      success: true,
      worldId,
    });
  }

  private async _handleLegacyWorldClose(_payload: any): Promise<void> {
    this._currentWorldId = null;
    this._sessionRegionMap.clear();

    if (this._regionStoreHook) {
      try {
        this._regionStoreHook.closeWorld();
      } catch (err: any) {
        this._logger.error(`Failed to close region store: ${err.message}`);
      }
    }

    this._logger.info('World closed (legacy)');

    this._mqtt.publishRaw('wos/sync/closeworld/response', {
      success: true,
    });
  }
}
