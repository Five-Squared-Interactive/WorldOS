/**
 * Asset Operations API
 *
 * Story 9.5: Asset Operations
 *
 * API for managing world assets (textures, models, audio, etc).
 */

/**
 * Asset types
 */
export type AssetType = 'texture' | 'model' | 'audio' | 'script' | 'other';

/**
 * Asset representation
 */
export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  size: number;
  url: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}

/**
 * Asset list options
 */
export interface AssetListOptions {
  limit?: number;
  offset?: number;
  type?: AssetType;
}

/**
 * Asset list result
 */
export interface AssetListResult {
  assets: Asset[];
  total: number;
  limit?: number;
  offset?: number;
}

/**
 * Create asset options
 */
export interface CreateAssetOptions {
  name: string;
  type: AssetType;
  data: Buffer | Uint8Array;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create asset result
 */
export interface CreateAssetResult {
  id: string;
  url: string;
}

/**
 * Delete asset result
 */
export interface DeleteAssetResult {
  success: boolean;
  freedBytes?: number;
}

/**
 * Storage usage
 */
export interface StorageUsage {
  usedBytes: number;
  totalBytes: number;
  assetCount: number;
}

/**
 * Asset error
 */
export class AssetError extends Error {
  code: string;
  assetId?: string;

  constructor(code: string, message: string, assetId?: string) {
    super(message);
    this.name = 'AssetError';
    this.code = code;
    this.assetId = assetId;
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
 * Asset Manager - manages world assets
 */
export class AssetManager {
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
      throw new AssetError(error.code, error.message);
    }

    if (this.mockResponses.has(operation)) {
      return this.mockResponses.get(operation) as T;
    }

    throw new Error(`No mock set for operation: ${operation}`);
  }

  /**
   * List assets in a world
   */
  async list(worldId: string, options?: AssetListOptions): Promise<AssetListResult> {
    return this.getMockResult<AssetListResult>('list');
  }

  /**
   * Get asset by ID
   */
  async get(worldId: string, assetId: string): Promise<Asset> {
    return this.getMockResult<Asset>('get');
  }

  /**
   * Create a new asset
   */
  async create(worldId: string, options: CreateAssetOptions): Promise<CreateAssetResult> {
    return this.getMockResult<CreateAssetResult>('create');
  }

  /**
   * Delete an asset
   */
  async delete(worldId: string, assetId: string): Promise<DeleteAssetResult> {
    return this.getMockResult<DeleteAssetResult>('delete');
  }

  /**
   * Get storage usage for a world
   */
  async getUsage(worldId: string): Promise<StorageUsage> {
    return this.getMockResult<StorageUsage>('getUsage');
  }
}
