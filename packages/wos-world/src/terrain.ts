/**
 * Terrain API
 *
 * Story 9.8: Planet-Type Extensions
 *
 * API for terrain and geographic queries in planet-type worlds.
 */

import { Vector3 } from './entities.js';

/**
 * Geographic coordinates
 */
export interface GeoCoordinates {
  lat: number;
  lon: number;
  altitude?: number;
}

/**
 * Terrain height result
 */
export interface TerrainHeight {
  height: number;
  coordinates: GeoCoordinates;
}

/**
 * Multiple terrain heights result
 */
export interface TerrainHeights {
  heights: TerrainHeight[];
}

/**
 * Terrain normal result
 */
export interface TerrainNormal {
  normal: Vector3;
  coordinates: GeoCoordinates;
}

/**
 * Biome result
 */
export interface BiomeResult {
  biome: string;
  coordinates: GeoCoordinates;
}

/**
 * Region query options
 */
export interface RegionQuery {
  lat: number;
  lon: number;
  radius: number;
  type?: string;
  limit?: number;
  offset?: number;
}

/**
 * Entity in region
 */
export interface RegionEntity {
  id: string;
  type: string;
  distance: number;
  coordinates: GeoCoordinates;
}

/**
 * Region query result
 */
export interface RegionQueryResult {
  entities: RegionEntity[];
  total: number;
  limit?: number;
  offset?: number;
}

/**
 * Geo to world result
 */
export interface GeoToWorldResult {
  position: Vector3;
  coordinates: GeoCoordinates;
}

/**
 * World to geo result
 */
export interface WorldToGeoResult {
  coordinates: GeoCoordinates;
  position: Vector3;
}

/**
 * Terrain error
 */
export class TerrainError extends Error {
  code: string;
  worldId?: string;

  constructor(code: string, message: string, worldId?: string) {
    super(message);
    this.name = 'TerrainError';
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
 * Terrain Manager - manages terrain queries for planet-type worlds
 */
export class TerrainManager {
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
      throw new TerrainError(error.code, error.message);
    }

    if (this.mockResponses.has(operation)) {
      return this.mockResponses.get(operation) as T;
    }

    throw new Error(`No mock set for operation: ${operation}`);
  }

  /**
   * Get terrain height at coordinates
   */
  async getHeight(worldId: string, lat: number, lon: number): Promise<TerrainHeight> {
    return this.getMockResult<TerrainHeight>('getHeight');
  }

  /**
   * Get terrain heights for multiple coordinates
   */
  async getHeights(worldId: string, coordinates: GeoCoordinates[]): Promise<TerrainHeights> {
    return this.getMockResult<TerrainHeights>('getHeights');
  }

  /**
   * Query entities within a geographic region
   */
  async queryRegion(worldId: string, query: RegionQuery): Promise<RegionQueryResult> {
    return this.getMockResult<RegionQueryResult>('queryRegion');
  }

  /**
   * Get terrain normal at coordinates
   */
  async getNormal(worldId: string, lat: number, lon: number): Promise<TerrainNormal> {
    return this.getMockResult<TerrainNormal>('getNormal');
  }

  /**
   * Get biome at coordinates
   */
  async getBiome(worldId: string, lat: number, lon: number): Promise<BiomeResult> {
    return this.getMockResult<BiomeResult>('getBiome');
  }

  /**
   * Convert geographic coordinates to world position
   */
  async geoToWorld(worldId: string, lat: number, lon: number): Promise<GeoToWorldResult> {
    return this.getMockResult<GeoToWorldResult>('geoToWorld');
  }

  /**
   * Convert world position to geographic coordinates
   */
  async worldToGeo(worldId: string, position: Vector3): Promise<WorldToGeoResult> {
    return this.getMockResult<WorldToGeoResult>('worldToGeo');
  }
}
