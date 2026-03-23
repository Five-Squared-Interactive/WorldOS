/**
 * World State API
 *
 * Story 9.4: World Metadata API
 * Story 9.7: World Lifecycle Events
 *
 * API for world metadata and lifecycle management.
 */

import { EventEmitter } from 'events';

/**
 * World types
 */
export type WorldType = 'space' | 'planet' | 'custom';

/**
 * World permissions
 */
export interface WorldPermissions {
  read: boolean;
  write: boolean;
  admin: boolean;
}

/**
 * World metadata
 */
export interface WorldMetadata {
  id: string;
  name: string;
  owner: string;
  type: WorldType;
  permissions: WorldPermissions;
  createdAt: Date;
  updatedAt: Date;
  description?: string;
  thumbnail?: string;
}

/**
 * World summary for listing
 */
export interface WorldSummary {
  id: string;
  name: string;
  type: WorldType;
  owner?: string;
}

/**
 * World list result
 */
export interface WorldListResult {
  worlds: WorldSummary[];
  total: number;
  limit?: number;
  offset?: number;
}

/**
 * World list options
 */
export interface WorldListOptions {
  limit?: number;
  offset?: number;
  type?: WorldType;
  owner?: string;
}

/**
 * Lifecycle event types
 */
export type WorldLifecycleEventType = 'created' | 'loaded' | 'unloaded' | 'deleted';

/**
 * Lifecycle event
 */
export interface WorldLifecycleEvent {
  event: WorldLifecycleEventType;
  worldId: string;
  metadata?: Partial<WorldMetadata>;
  timestamp: Date;
}

/**
 * Lifecycle event handler
 */
export type WorldLifecycleHandler = (event: WorldLifecycleEvent) => void;

/**
 * World state error
 */
export class WorldStateError extends Error {
  code: string;
  worldId?: string;

  constructor(code: string, message: string, worldId?: string) {
    super(message);
    this.name = 'WorldStateError';
    this.code = code;
    this.worldId = worldId;
  }
}

/**
 * MQTT client interface
 */
export interface MqttClient {
  publish: (topic: string, message: unknown) => void;
  subscribe: (topic: string) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
}

/**
 * World Manager - manages world metadata and lifecycle
 */
export class WorldManager extends EventEmitter {
  private mqttClient: MqttClient;
  private lifecycleHandlers: WorldLifecycleHandler[] = [];
  private mockResponses: Map<string, unknown> = new Map();
  private mockErrors: Map<string, { code: string; message: string }> = new Map();

  constructor(mqttClient: MqttClient) {
    super();
    this.mqttClient = mqttClient;
  }

  /**
   * Set mock response for testing
   */
  setMockResponse(operation: string, response: unknown): void {
    this.mockResponses.set(operation, response);
    this.mockErrors.delete(operation);
  }

  /**
   * Set mock error for testing
   */
  setMockError(operation: string, error: { code: string; message: string }): void {
    this.mockErrors.set(operation, error);
    this.mockResponses.delete(operation);
  }

  /**
   * Get mock result or throw error
   */
  private getMockResult<T>(operation: string): T {
    if (this.mockErrors.has(operation)) {
      const error = this.mockErrors.get(operation)!;
      throw new WorldStateError(error.code, error.message);
    }

    if (this.mockResponses.has(operation)) {
      return this.mockResponses.get(operation) as T;
    }

    throw new Error(`No mock set for operation: ${operation}`);
  }

  /**
   * Get world metadata
   */
  async getMetadata(worldId: string): Promise<WorldMetadata> {
    return this.getMockResult<WorldMetadata>('getMetadata');
  }

  /**
   * List accessible worlds
   */
  async listWorlds(options?: WorldListOptions): Promise<WorldListResult> {
    return this.getMockResult<WorldListResult>('listWorlds');
  }

  /**
   * Get currently loaded world IDs
   */
  async getLoadedWorlds(): Promise<string[]> {
    return this.getMockResult<string[]>('getLoadedWorlds');
  }

  /**
   * Check permission for a world
   */
  async checkPermission(worldId: string, permission: keyof WorldPermissions): Promise<boolean> {
    const metadata = await this.getMetadata(worldId);
    return metadata.permissions[permission];
  }

  /**
   * Subscribe to world lifecycle events
   */
  onLifecycle(handler: WorldLifecycleHandler): () => void {
    this.lifecycleHandlers.push(handler);

    return () => {
      const index = this.lifecycleHandlers.indexOf(handler);
      if (index !== -1) {
        this.lifecycleHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Emit lifecycle event (for testing and internal use)
   */
  emitLifecycleEvent(
    event: WorldLifecycleEventType,
    worldId: string,
    metadata?: Partial<WorldMetadata>
  ): void {
    const lifecycleEvent: WorldLifecycleEvent = {
      event,
      worldId,
      metadata,
      timestamp: new Date(),
    };

    for (const handler of this.lifecycleHandlers) {
      handler(lifecycleEvent);
    }
  }

  /**
   * Get lifecycle handler count
   */
  getLifecycleHandlerCount(): number {
    return this.lifecycleHandlers.length;
  }
}
