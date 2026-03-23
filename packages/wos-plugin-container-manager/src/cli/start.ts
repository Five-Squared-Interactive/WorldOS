// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import type { InstanceResult } from '../types.js';

export interface StartResult {
  results: InstanceResult[];
}

export function formatOutput(result: StartResult): string {
  if (result.results.length === 0) return 'No instances to start.';

  return result.results
    .map((r) => `${r.serviceId}/${r.instanceId}: ${r.status}${r.error ? ` (${r.error})` : ''}`)
    .join('\n');
}

export function formatJson(result: StartResult): string {
  return JSON.stringify(result, null, 2);
}
