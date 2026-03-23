// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import type { ScaleResult } from '../types.js';

export function formatOutput(result: ScaleResult): string {
  const lines = [`Scaled ${result.serviceId} to ${result.targetCount} instances:`, ''];
  for (const inst of result.instances) {
    lines.push(`  ${inst.instanceId}: ${inst.action}`);
  }
  return lines.join('\n');
}

export function formatJson(result: ScaleResult): string {
  return JSON.stringify(result, null, 2);
}
