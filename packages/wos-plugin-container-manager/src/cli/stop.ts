// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import type { InstanceResult } from '../types.js';

export interface StopResult {
  results: InstanceResult[];
}

export function formatOutput(result: StopResult): string {
  if (result.results.length === 0) return 'No instances to stop.';

  return result.results
    .map((r) => `${r.serviceId}/${r.instanceId}: ${r.status}${r.error ? ` (${r.error})` : ''}`)
    .join('\n');
}

export function formatJson(result: StopResult): string {
  return JSON.stringify(result, null, 2);
}
