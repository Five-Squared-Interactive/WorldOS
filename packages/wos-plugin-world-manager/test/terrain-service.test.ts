// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerrainService } from '../src/terrain-service.js';

describe('TerrainService', () => {
  let service: TerrainService;
  let mockMqtt: {
    subscribeWithHandler: ReturnType<typeof vi.fn>;
    publishRaw: ReturnType<typeof vi.fn>;
  };
  let handlers: Map<string, (msg: any) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    handlers = new Map();

    mockMqtt = {
      subscribeWithHandler: vi.fn((topic: string, handler: any) => {
        handlers.set(topic, handler);
      }),
      publishRaw: vi.fn(),
    };

    service = new TerrainService(mockMqtt as any, 'planet');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getHeight', () => {
    it('should send MQTT request and return height', async () => {
      const promise = service.getHeight(45.0, -93.0);

      // Get the correlation ID from the published message
      expect(mockMqtt.publishRaw).toHaveBeenCalledWith(
        'wos/runtime/terrain/height',
        expect.any(String),
      );

      const published = JSON.parse(mockMqtt.publishRaw.mock.calls[0][1]);
      const responseTopic = `wos/runtime/terrain/height/response`;
      const handler = handlers.get(responseTopic);

      // Simulate response
      handler?.({
        topic: responseTopic,
        payload: {
          correlationId: published.correlationId,
          result: { height: 250.5, coordinates: { lat: 45.0, lon: -93.0 } },
        },
        timestamp: Date.now(),
      });

      const result = await promise;
      expect(result.height).toBe(250.5);
    });

    it('should return error for non-planet world', async () => {
      const spaceService = new TerrainService(mockMqtt as any, 'space');
      const result = await spaceService.getHeight(0, 0);

      expect(result.error).toBeDefined();
      expect(result.error).toContain('planet');
    });

    it('should timeout after 5 seconds', async () => {
      const promise = service.getHeight(45.0, -93.0);

      vi.advanceTimersByTime(5001);

      const result = await promise;
      expect(result.error).toBe('terrain_timeout');
    });
  });

  describe('getHeights (batch)', () => {
    it('should send batch request', async () => {
      const promise = service.getHeights([
        { lat: 45.0, lon: -93.0 },
        { lat: 46.0, lon: -94.0 },
      ]);

      const published = JSON.parse(mockMqtt.publishRaw.mock.calls[0][1]);
      expect(published.points).toHaveLength(2);

      const responseTopic = 'wos/runtime/terrain/heights/response';
      const handler = handlers.get(responseTopic);
      handler?.({
        topic: responseTopic,
        payload: {
          correlationId: published.correlationId,
          result: [
            { height: 100, coordinates: { lat: 45.0, lon: -93.0 } },
            { height: 200, coordinates: { lat: 46.0, lon: -94.0 } },
          ],
        },
        timestamp: Date.now(),
      });

      const result = await promise;
      expect(result).toHaveLength(2);
    });

    it('should return error for non-planet world', async () => {
      const spaceService = new TerrainService(mockMqtt as any, 'space');
      const result = await spaceService.getHeights([{ lat: 0, lon: 0 }]);
      expect(result.error).toBeDefined();
    });
  });

  describe('getBiome', () => {
    it('should return biome at coordinates', async () => {
      const promise = service.getBiome(45.0, -93.0);

      const published = JSON.parse(mockMqtt.publishRaw.mock.calls[0][1]);
      const handler = handlers.get('wos/runtime/terrain/biome/response');
      handler?.({
        topic: 'wos/runtime/terrain/biome/response',
        payload: {
          correlationId: published.correlationId,
          result: { biome: 'temperate_forest', coordinates: { lat: 45.0, lon: -93.0 } },
        },
        timestamp: Date.now(),
      });

      const result = await promise;
      expect(result.biome).toBe('temperate_forest');
    });
  });

  describe('geoToWorld', () => {
    it('should convert geo coordinates to world position', async () => {
      const promise = service.geoToWorld(45.0, -93.0);

      const published = JSON.parse(mockMqtt.publishRaw.mock.calls[0][1]);
      const handler = handlers.get('wos/runtime/terrain/geo-to-world/response');
      handler?.({
        topic: 'wos/runtime/terrain/geo-to-world/response',
        payload: {
          correlationId: published.correlationId,
          result: { position: { x: 100, y: 50, z: -200 }, coordinates: { lat: 45.0, lon: -93.0 } },
        },
        timestamp: Date.now(),
      });

      const result = await promise;
      expect(result.position).toEqual({ x: 100, y: 50, z: -200 });
    });
  });

  describe('worldToGeo', () => {
    it('should convert world position to geo coordinates', async () => {
      const promise = service.worldToGeo(100, 50, -200);

      const published = JSON.parse(mockMqtt.publishRaw.mock.calls[0][1]);
      const handler = handlers.get('wos/runtime/terrain/world-to-geo/response');
      handler?.({
        topic: 'wos/runtime/terrain/world-to-geo/response',
        payload: {
          correlationId: published.correlationId,
          result: { coordinates: { lat: 45.0, lon: -93.0 }, position: { x: 100, y: 50, z: -200 } },
        },
        timestamp: Date.now(),
      });

      const result = await promise;
      expect(result.coordinates).toEqual({ lat: 45.0, lon: -93.0 });
    });
  });
});
