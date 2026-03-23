// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import type { WorldStore } from './world-store.js';
import type { EntityStore } from './entity-store.js';

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
  details: {
    initialized: boolean;
    worldName?: string;
    worldType?: string;
    entityCount?: number;
    templateCount?: number;
    error?: string;
  };
}

export interface HealthMetrics {
  initialized: boolean;
  entityCount: number;
  templateCount: number;
  entityCountByType: Record<string, number>;
}

export function collectHealthStatus(
  worldStore: WorldStore,
  entityStore: EntityStore,
): HealthStatus {
  try {
    const initialized = worldStore.isInitialized();
    const meta = worldStore.getMetadata();
    const entityCount = entityStore.getEntityCount();
    const templateCount = entityStore.getTemplateCount();

    return {
      status: 'ok',
      details: {
        initialized,
        worldName: meta?.name,
        worldType: meta?.type,
        entityCount,
        templateCount,
      },
    };
  } catch (err) {
    return {
      status: 'degraded',
      details: {
        initialized: false,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export function collectMetrics(
  worldStore: WorldStore,
  entityStore: EntityStore,
): HealthMetrics {
  return {
    initialized: worldStore.isInitialized(),
    entityCount: entityStore.getEntityCount(),
    templateCount: entityStore.getTemplateCount(),
    entityCountByType: entityStore.getEntityCountByType(),
  };
}
