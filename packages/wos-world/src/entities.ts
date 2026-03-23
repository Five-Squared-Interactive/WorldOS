/**
 * Entity Query API
 *
 * Story 9.1: Entity Query API
 * Story 9.2: Entity CRUD Operations
 * Story 9.3: Entity Event Subscriptions
 *
 * API for querying and manipulating entities within worlds.
 */

import { EventEmitter } from 'events';

/**
 * 3D Vector
 */
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Quaternion for rotation
 */
export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * Entity representation
 */
export interface Entity {
  id: string;
  type: string;
  position: Vector3;
  rotation: Quaternion;
  scale: Vector3;
  properties: Record<string, unknown>;
  parentId?: string;
  children?: string[];
}

/**
 * Entity filter for queries
 */
export interface EntityFilter {
  id?: string;
  type?: string;
  properties?: Record<string, unknown>;
  parentId?: string;
}

/**
 * Pagination options
 */
export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

/**
 * Query result
 */
export interface EntityQueryResult {
  entities: Entity[];
  total: number;
  limit?: number;
  offset?: number;
}

/**
 * Create entity options
 */
export interface CreateEntityOptions {
  type: string;
  position: Vector3;
  rotation?: Quaternion;
  scale?: Vector3;
  properties?: Record<string, unknown>;
  parentId?: string;
}

/**
 * Update entity options
 */
export interface UpdateEntityOptions {
  position?: Vector3;
  rotation?: Quaternion;
  scale?: Vector3;
  properties?: Record<string, unknown>;
}

/**
 * Create result
 */
export interface CreateResult {
  id: string;
}

/**
 * Update result
 */
export interface UpdateResult {
  success: boolean;
  fieldsUpdated?: string[];
}

/**
 * Delete result
 */
export interface DeleteResult {
  success: boolean;
}

/**
 * Entity event types
 */
export type EntityEventType = 'created' | 'modified' | 'deleted';

/**
 * Entity event
 */
export interface EntityEvent {
  event: EntityEventType;
  worldId: string;
  entity: Partial<Entity>;
  previousValues?: Partial<Entity>;
  timestamp: Date;
}

/**
 * Entity event handler
 */
export type EntityEventHandler = (event: EntityEvent) => void;

/**
 * Subscription
 */
interface Subscription {
  worldId: string;
  filter: EntityFilter;
  handler: EntityEventHandler;
}

/**
 * World state error
 */
export class WorldStateError extends Error {
  code: string;
  worldId?: string;
  entityId?: string;

  constructor(code: string, message: string, details?: { worldId?: string; entityId?: string }) {
    super(message);
    this.name = 'WorldStateError';
    this.code = code;
    this.worldId = details?.worldId;
    this.entityId = details?.entityId;
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
 * Entity Manager - manages entity queries and operations
 */
export class EntityManager extends EventEmitter {
  private mqttClient: MqttClient;
  private subscriptions: Subscription[] = [];
  private mockResponses: Map<string, unknown> = new Map();
  private mockErrors: Map<string, { code: string; message: string; worldId?: string }> = new Map();

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
  setMockError(operation: string, error: { code: string; message: string; worldId?: string }): void {
    this.mockErrors.set(operation, error);
    this.mockResponses.delete(operation);
  }

  /**
   * Get mock result or throw error
   */
  private getMockResult<T>(operation: string): T {
    if (this.mockErrors.has(operation)) {
      const error = this.mockErrors.get(operation)!;
      const worldError = new WorldStateError(error.code, error.message, { worldId: error.worldId });
      throw worldError;
    }

    if (this.mockResponses.has(operation)) {
      return this.mockResponses.get(operation) as T;
    }

    throw new Error(`No mock set for operation: ${operation}`);
  }

  /**
   * Build filter query from EntityFilter
   */
  buildFilterQuery(filter: EntityFilter): Record<string, unknown> {
    const query: Record<string, unknown> = {};

    if (filter.id) {
      query.id = filter.id;
    }

    if (filter.type) {
      query.type = filter.type;
    }

    if (filter.properties) {
      query.properties = filter.properties;
    }

    if (filter.parentId) {
      query.parentId = filter.parentId;
    }

    return query;
  }

  /**
   * Query entities in a world
   */
  async query(worldId: string, filter: EntityFilter, pagination?: PaginationOptions): Promise<EntityQueryResult> {
    return this.getMockResult<EntityQueryResult>('query');
  }

  /**
   * Create a new entity
   */
  async create(worldId: string, options: CreateEntityOptions): Promise<CreateResult> {
    return this.getMockResult<CreateResult>('create');
  }

  /**
   * Update an existing entity
   */
  async update(worldId: string, entityId: string, options: UpdateEntityOptions): Promise<UpdateResult> {
    return this.getMockResult<UpdateResult>('update');
  }

  /**
   * Delete an entity
   */
  async delete(worldId: string, entityId: string): Promise<DeleteResult> {
    return this.getMockResult<DeleteResult>('delete');
  }

  /**
   * Subscribe to entity events
   */
  subscribe(worldId: string, filter: EntityFilter, handler: EntityEventHandler): () => void {
    const subscription: Subscription = { worldId, filter, handler };
    this.subscriptions.push(subscription);

    // Return unsubscribe function
    return () => {
      const index = this.subscriptions.indexOf(subscription);
      if (index !== -1) {
        this.subscriptions.splice(index, 1);
      }
    };
  }

  /**
   * Emit entity event (for testing and internal use)
   */
  emitEvent(worldId: string, event: EntityEventType, entity: Partial<Entity>, previousValues?: Partial<Entity>): void {
    const entityEvent: EntityEvent = {
      event,
      worldId,
      entity,
      previousValues,
      timestamp: new Date(),
    };

    for (const subscription of this.subscriptions) {
      if (subscription.worldId !== worldId) {
        continue;
      }

      // Check filter
      if (subscription.filter.type && entity.type !== subscription.filter.type) {
        continue;
      }

      if (subscription.filter.id && entity.id !== subscription.filter.id) {
        continue;
      }

      subscription.handler(entityEvent);
    }
  }

  /**
   * Get subscription count
   */
  getSubscriptionCount(): number {
    return this.subscriptions.length;
  }
}
