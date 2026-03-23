/**
 * Template API
 *
 * Story 9.6: Template API
 *
 * API for entity templates.
 */

import { Vector3, Quaternion } from './entities.js';

/**
 * Entity template
 */
export interface EntityTemplate {
  id: string;
  name: string;
  type: string;
  properties: Record<string, unknown>;
  components?: string[];
  defaultPosition?: Vector3;
  defaultRotation?: Quaternion;
  defaultScale?: Vector3;
}

/**
 * Template list options
 */
export interface TemplateListOptions {
  limit?: number;
  offset?: number;
  type?: string;
}

/**
 * Template list result
 */
export interface TemplateListResult {
  templates: EntityTemplate[];
  total: number;
  limit?: number;
  offset?: number;
}

/**
 * Instantiate options
 */
export interface InstantiateOptions {
  position: Vector3;
  rotation?: Quaternion;
  scale?: Vector3;
  properties?: Record<string, unknown>;
  parentId?: string;
}

/**
 * Instantiate result
 */
export interface InstantiateResult {
  entityId: string;
  position?: Vector3;
  rotation?: Quaternion;
  scale?: Vector3;
  properties?: Record<string, unknown>;
}

/**
 * Template error
 */
export class TemplateError extends Error {
  code: string;
  templateId?: string;

  constructor(code: string, message: string, templateId?: string) {
    super(message);
    this.name = 'TemplateError';
    this.code = code;
    this.templateId = templateId;
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
 * Template Manager - manages entity templates
 */
export class TemplateManager {
  private mqttClient: MqttClient;
  private mockResponses: Map<string, unknown> = new Map();
  private mockErrors: Map<string, { code: string; message: string }> = new Map();

  constructor(mqttClient: MqttClient) {
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
      throw new TemplateError(error.code, error.message);
    }

    if (this.mockResponses.has(operation)) {
      return this.mockResponses.get(operation) as T;
    }

    throw new Error(`No mock set for operation: ${operation}`);
  }

  /**
   * List templates in a world
   */
  async list(worldId: string, options?: TemplateListOptions): Promise<TemplateListResult> {
    return this.getMockResult<TemplateListResult>('list');
  }

  /**
   * Get template by ID
   */
  async get(worldId: string, templateId: string): Promise<EntityTemplate> {
    return this.getMockResult<EntityTemplate>('get');
  }

  /**
   * Instantiate a template to create a new entity
   */
  async instantiate(
    worldId: string,
    templateId: string,
    options: InstantiateOptions
  ): Promise<InstantiateResult> {
    return this.getMockResult<InstantiateResult>('instantiate');
  }
}
