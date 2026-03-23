// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import * as fs from 'fs';
import * as path from 'path';
import type { AssetStore } from './asset-store.js';

interface HealthResult {
  status: 'ok' | 'degraded' | 'unhealthy';
  details: {
    totalAssets: number;
    totalSizeBytes: number;
    worldCount: number;
    assetDirExists: boolean;
    error?: string;
  };
}

export async function collectHealthStatus(store: AssetStore, baseDir: string): Promise<HealthResult> {
  const assetDir = path.join(baseDir, 'assets');
  const assetDirExists = fs.existsSync(assetDir);

  let totalAssets = 0;
  let totalSizeBytes = 0;
  let worldCount = 0;

  try {
    const metrics = store.getHealthMetrics();
    totalAssets = metrics.totalAssets;
    totalSizeBytes = metrics.totalSizeBytes;
    worldCount = metrics.worldCount;
  } catch {
    return {
      status: 'unhealthy',
      details: { totalAssets: 0, totalSizeBytes: 0, worldCount: 0, assetDirExists, error: 'Database query failed' },
    };
  }

  const status = assetDirExists ? 'ok' : 'degraded';

  return {
    status,
    details: { totalAssets, totalSizeBytes, worldCount, assetDirExists },
  };
}
