// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi } from 'vitest';
import { collectHealthStatus, collectMetrics } from '../src/health.js';

const makeMockWorldStore = (opts: { initialized?: boolean; name?: string; type?: string; dbOk?: boolean } = {}) => ({
  isInitialized: () => {
    if (opts.dbOk === false) throw new Error('database is closed');
    return opts.initialized ?? true;
  },
  getMetadata: () => {
    if (opts.dbOk === false) throw new Error('database is closed');
    if (!opts.initialized && opts.initialized !== undefined) return null;
    return { name: opts.name ?? 'Test', type: opts.type ?? 'space' };
  },
});

const makeMockEntityStore = (opts: { entityCount?: number; templateCount?: number; dbOk?: boolean } = {}) => ({
  getEntityCount: () => {
    if (opts.dbOk === false) throw new Error('database is closed');
    return opts.entityCount ?? 0;
  },
  getTemplateCount: () => {
    if (opts.dbOk === false) throw new Error('database is closed');
    return opts.templateCount ?? 0;
  },
  getEntityCountByType: () => {
    if (opts.dbOk === false) throw new Error('database is closed');
    return { mesh: opts.entityCount ?? 0 };
  },
});

describe('Health', () => {
  describe('collectHealthStatus', () => {
    it('should return ok status with world info', () => {
      const status = collectHealthStatus(
        makeMockWorldStore({ initialized: true, name: 'My World', type: 'space' }) as any,
        makeMockEntityStore({ entityCount: 10, templateCount: 3 }) as any,
      );

      expect(status.status).toBe('ok');
      expect(status.details.worldName).toBe('My World');
      expect(status.details.worldType).toBe('space');
      expect(status.details.entityCount).toBe(10);
      expect(status.details.templateCount).toBe(3);
      expect(status.details.initialized).toBe(true);
    });

    it('should return ok with uninitialized world', () => {
      const status = collectHealthStatus(
        makeMockWorldStore({ initialized: false }) as any,
        makeMockEntityStore() as any,
      );

      expect(status.status).toBe('ok');
      expect(status.details.initialized).toBe(false);
    });

    it('should return degraded when DB is unreachable', () => {
      const status = collectHealthStatus(
        makeMockWorldStore({ dbOk: false }) as any,
        makeMockEntityStore({ dbOk: false }) as any,
      );

      expect(status.status).toBe('degraded');
      expect(status.details.error).toBeDefined();
    });
  });

  describe('collectMetrics', () => {
    it('should return entity and template counts', () => {
      const metrics = collectMetrics(
        makeMockWorldStore({ initialized: true }) as any,
        makeMockEntityStore({ entityCount: 25, templateCount: 5 }) as any,
      );

      expect(metrics.entityCount).toBe(25);
      expect(metrics.templateCount).toBe(5);
      expect(metrics.initialized).toBe(true);
    });
  });
});
