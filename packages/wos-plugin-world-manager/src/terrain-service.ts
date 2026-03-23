// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import crypto from 'crypto';
import type { WorldType } from './types.js';

const TERRAIN_TIMEOUT_MS = 5000;
const PLANET_ONLY_ERROR = 'Terrain operations are only available for planet-type worlds';

interface MqttLike {
  subscribeWithHandler: (topic: string, handler: (msg: any) => void) => void;
  publishRaw: (topic: string, payload: string) => void;
}

interface PendingRequest {
  resolve: (value: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class TerrainService {
  private mqtt: MqttLike;
  private worldType: WorldType;
  private pending = new Map<string, PendingRequest>();

  constructor(mqtt: MqttLike, worldType: WorldType) {
    this.mqtt = mqtt;
    this.worldType = worldType;

    // Subscribe to response topics
    const methods = ['height', 'heights', 'biome', 'normal', 'region', 'geo-to-world', 'world-to-geo'];
    for (const method of methods) {
      this.mqtt.subscribeWithHandler(`wos/runtime/terrain/${method}/response`, (msg: any) => {
        const payload = msg.payload;
        const pending = this.pending.get(payload.correlationId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(payload.correlationId);
          pending.resolve(payload.result ?? payload);
        }
      });
    }
  }

  async getHeight(lat: number, lon: number): Promise<any> {
    if (this.worldType !== 'planet') {
      return { error: PLANET_ONLY_ERROR };
    }
    return this.request('height', { lat, lon });
  }

  async getHeights(points: { lat: number; lon: number }[]): Promise<any> {
    if (this.worldType !== 'planet') {
      return { error: PLANET_ONLY_ERROR };
    }
    return this.request('heights', { points });
  }

  async getBiome(lat: number, lon: number): Promise<any> {
    if (this.worldType !== 'planet') {
      return { error: PLANET_ONLY_ERROR };
    }
    return this.request('biome', { lat, lon });
  }

  async getNormal(lat: number, lon: number): Promise<any> {
    if (this.worldType !== 'planet') {
      return { error: PLANET_ONLY_ERROR };
    }
    return this.request('normal', { lat, lon });
  }

  async queryRegion(query: any): Promise<any> {
    if (this.worldType !== 'planet') {
      return { error: PLANET_ONLY_ERROR };
    }
    return this.request('region', query);
  }

  async geoToWorld(lat: number, lon: number): Promise<any> {
    if (this.worldType !== 'planet') {
      return { error: PLANET_ONLY_ERROR };
    }
    return this.request('geo-to-world', { lat, lon });
  }

  async worldToGeo(x: number, y: number, z: number): Promise<any> {
    if (this.worldType !== 'planet') {
      return { error: PLANET_ONLY_ERROR };
    }
    return this.request('world-to-geo', { x, y, z });
  }

  private request(method: string, params: Record<string, unknown>): Promise<any> {
    return new Promise((resolve) => {
      const correlationId = crypto.randomUUID();

      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        resolve({ error: 'terrain_timeout', message: 'Runtime did not respond' });
      }, TERRAIN_TIMEOUT_MS);

      this.pending.set(correlationId, { resolve, timer });

      this.mqtt.publishRaw(
        `wos/runtime/terrain/${method}`,
        JSON.stringify({ correlationId, ...params }),
      );
    });
  }
}
