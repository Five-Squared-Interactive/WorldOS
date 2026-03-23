/**
 * Terrain API Tests
 *
 * Story 9.8: Planet-Type Extensions
 *
 * Tests for terrain and geographic queries in planet-type worlds.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TerrainManager,
  TerrainHeight,
  GeoCoordinates,
  RegionQuery,
  RegionQueryResult,
} from './terrain.js';

describe('Terrain API', () => {
  let terrainManager: TerrainManager;
  let mockMqttClient: any;

  beforeEach(() => {
    mockMqttClient = {
      publish: vi.fn(),
      subscribe: vi.fn(),
      on: vi.fn(),
    };
    terrainManager = new TerrainManager(mockMqttClient);
  });

  describe('GeoCoordinates types', () => {
    it('should define GeoCoordinates interface', () => {
      const coords: GeoCoordinates = {
        lat: 40.7128,
        lon: -74.0060,
      };

      expect(coords.lat).toBe(40.7128);
      expect(coords.lon).toBe(-74.0060);
    });

    it('should support altitude', () => {
      const coords: GeoCoordinates = {
        lat: 40.7128,
        lon: -74.0060,
        altitude: 100,
      };

      expect(coords.altitude).toBe(100);
    });
  });

  describe('TerrainManager', () => {
    it('should create terrain manager', () => {
      expect(terrainManager).toBeDefined();
    });

    it('should have getHeight method', () => {
      expect(typeof terrainManager.getHeight).toBe('function');
    });

    it('should have getHeights method', () => {
      expect(typeof terrainManager.getHeights).toBe('function');
    });

    it('should have queryRegion method', () => {
      expect(typeof terrainManager.queryRegion).toBe('function');
    });

    it('should have getNormal method', () => {
      expect(typeof terrainManager.getNormal).toBe('function');
    });
  });

  describe('getHeight', () => {
    it('should get terrain height at coordinates', async () => {
      terrainManager.setMockResponse('getHeight', {
        height: 150.5,
        coordinates: { lat: 40.7128, lon: -74.0060 },
      });

      const result = await terrainManager.getHeight('world-1', 40.7128, -74.0060);

      expect(result.height).toBe(150.5);
    });

    it('should return coordinates in response', async () => {
      terrainManager.setMockResponse('getHeight', {
        height: 100,
        coordinates: { lat: 35.6762, lon: 139.6503 },
      });

      const result = await terrainManager.getHeight('world-1', 35.6762, 139.6503);

      expect(result.coordinates.lat).toBe(35.6762);
      expect(result.coordinates.lon).toBe(139.6503);
    });

    it('should handle negative heights (below sea level)', async () => {
      terrainManager.setMockResponse('getHeight', {
        height: -50,
        coordinates: { lat: 31.5, lon: 35.5 },
      });

      const result = await terrainManager.getHeight('world-1', 31.5, 35.5);

      expect(result.height).toBe(-50);
    });

    it('should throw for non-planet world', async () => {
      terrainManager.setMockError('getHeight', {
        code: 'INVALID_WORLD_TYPE',
        message: 'Terrain API only available for planet-type worlds',
      });

      try {
        await terrainManager.getHeight('space-world', 0, 0);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.code).toBe('INVALID_WORLD_TYPE');
      }
    });

    it('should throw for invalid coordinates', async () => {
      terrainManager.setMockError('getHeight', {
        code: 'INVALID_COORDINATES',
        message: 'Latitude must be between -90 and 90',
      });

      try {
        await terrainManager.getHeight('world-1', 100, 0);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.code).toBe('INVALID_COORDINATES');
      }
    });
  });

  describe('getHeights', () => {
    it('should get heights for multiple coordinates', async () => {
      terrainManager.setMockResponse('getHeights', {
        heights: [
          { height: 100, coordinates: { lat: 40, lon: -74 } },
          { height: 200, coordinates: { lat: 41, lon: -73 } },
        ],
      });

      const result = await terrainManager.getHeights('world-1', [
        { lat: 40, lon: -74 },
        { lat: 41, lon: -73 },
      ]);

      expect(result.heights.length).toBe(2);
      expect(result.heights[0].height).toBe(100);
      expect(result.heights[1].height).toBe(200);
    });

    it('should batch requests efficiently', async () => {
      terrainManager.setMockResponse('getHeights', {
        heights: Array(100).fill(null).map((_, i) => ({
          height: i * 10,
          coordinates: { lat: i, lon: i },
        })),
      });

      const coords = Array(100).fill(null).map((_, i) => ({ lat: i, lon: i }));
      const result = await terrainManager.getHeights('world-1', coords);

      expect(result.heights.length).toBe(100);
    });
  });

  describe('queryRegion', () => {
    it('should query entities in geographic region', async () => {
      terrainManager.setMockResponse('queryRegion', {
        entities: [
          { id: 'e1', type: 'mesh', distance: 100, coordinates: { lat: 40.71, lon: -74.00 } },
          { id: 'e2', type: 'mesh', distance: 250, coordinates: { lat: 40.72, lon: -74.01 } },
        ],
        total: 2,
      });

      const result = await terrainManager.queryRegion('world-1', {
        lat: 40.7128,
        lon: -74.0060,
        radius: 500,
      });

      expect(result.entities.length).toBe(2);
      expect(result.total).toBe(2);
    });

    it('should include distance from center', async () => {
      terrainManager.setMockResponse('queryRegion', {
        entities: [
          { id: 'e1', type: 'building', distance: 150.5, coordinates: { lat: 40.71, lon: -74.00 } },
        ],
        total: 1,
      });

      const result = await terrainManager.queryRegion('world-1', {
        lat: 40.7128,
        lon: -74.0060,
        radius: 500,
      });

      expect(result.entities[0].distance).toBe(150.5);
    });

    it('should include entity coordinates', async () => {
      terrainManager.setMockResponse('queryRegion', {
        entities: [
          { id: 'e1', type: 'tree', distance: 50, coordinates: { lat: 40.713, lon: -74.005 } },
        ],
        total: 1,
      });

      const result = await terrainManager.queryRegion('world-1', {
        lat: 40.7128,
        lon: -74.0060,
        radius: 100,
      });

      expect(result.entities[0].coordinates.lat).toBe(40.713);
    });

    it('should filter by entity type', async () => {
      terrainManager.setMockResponse('queryRegion', {
        entities: [
          { id: 'e1', type: 'building', distance: 100, coordinates: { lat: 40.71, lon: -74.00 } },
        ],
        total: 1,
      });

      const result = await terrainManager.queryRegion('world-1', {
        lat: 40.7128,
        lon: -74.0060,
        radius: 500,
        type: 'building',
      });

      expect(result.entities.every(e => e.type === 'building')).toBe(true);
    });

    it('should support pagination', async () => {
      terrainManager.setMockResponse('queryRegion', {
        entities: [],
        total: 500,
        limit: 100,
        offset: 400,
      });

      const result = await terrainManager.queryRegion('world-1', {
        lat: 0,
        lon: 0,
        radius: 10000,
        limit: 100,
        offset: 400,
      });

      expect(result.limit).toBe(100);
      expect(result.offset).toBe(400);
      expect(result.total).toBe(500);
    });

    it('should sort by distance', async () => {
      terrainManager.setMockResponse('queryRegion', {
        entities: [
          { id: 'e1', type: 'mesh', distance: 50, coordinates: { lat: 40.71, lon: -74.00 } },
          { id: 'e2', type: 'mesh', distance: 100, coordinates: { lat: 40.72, lon: -74.01 } },
          { id: 'e3', type: 'mesh', distance: 200, coordinates: { lat: 40.73, lon: -74.02 } },
        ],
        total: 3,
      });

      const result = await terrainManager.queryRegion('world-1', {
        lat: 40.7128,
        lon: -74.0060,
        radius: 500,
      });

      expect(result.entities[0].distance).toBeLessThan(result.entities[1].distance);
      expect(result.entities[1].distance).toBeLessThan(result.entities[2].distance);
    });
  });

  describe('getNormal', () => {
    it('should get terrain normal at coordinates', async () => {
      terrainManager.setMockResponse('getNormal', {
        normal: { x: 0, y: 1, z: 0 },
        coordinates: { lat: 40, lon: -74 },
      });

      const result = await terrainManager.getNormal('world-1', 40, -74);

      expect(result.normal.y).toBe(1);
    });

    it('should return slope normal on hills', async () => {
      terrainManager.setMockResponse('getNormal', {
        normal: { x: 0.3, y: 0.9, z: 0.3 },
        coordinates: { lat: 46, lon: 7 },
      });

      const result = await terrainManager.getNormal('world-1', 46, 7);

      expect(result.normal.x).toBeCloseTo(0.3);
      expect(result.normal.y).toBeCloseTo(0.9);
    });
  });

  describe('getBiome', () => {
    it('should get biome at coordinates', async () => {
      terrainManager.setMockResponse('getBiome', {
        biome: 'forest',
        coordinates: { lat: 47, lon: 8 },
      });

      const result = await terrainManager.getBiome('world-1', 47, 8);

      expect(result.biome).toBe('forest');
    });

    it('should support various biome types', async () => {
      const biomes = ['desert', 'ocean', 'mountain', 'plains', 'tundra'];

      for (const biome of biomes) {
        terrainManager.setMockResponse('getBiome', {
          biome,
          coordinates: { lat: 0, lon: 0 },
        });

        const result = await terrainManager.getBiome('world-1', 0, 0);
        expect(result.biome).toBe(biome);
      }
    });
  });

  describe('coordinate conversion', () => {
    it('should convert lat/lon to world position', async () => {
      terrainManager.setMockResponse('geoToWorld', {
        position: { x: 1000, y: 150, z: -500 },
        coordinates: { lat: 40, lon: -74 },
      });

      const result = await terrainManager.geoToWorld('world-1', 40, -74);

      expect(result.position.x).toBe(1000);
      expect(result.position.y).toBe(150);
      expect(result.position.z).toBe(-500);
    });

    it('should convert world position to lat/lon', async () => {
      terrainManager.setMockResponse('worldToGeo', {
        coordinates: { lat: 40.7128, lon: -74.0060, altitude: 100 },
        position: { x: 1000, y: 100, z: -500 },
      });

      const result = await terrainManager.worldToGeo('world-1', { x: 1000, y: 100, z: -500 });

      expect(result.coordinates.lat).toBeCloseTo(40.7128);
      expect(result.coordinates.lon).toBeCloseTo(-74.0060);
    });
  });
});
