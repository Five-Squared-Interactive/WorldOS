// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export interface EntityCountResult {
  total: number;
  byType: Record<string, number>;
}

export function formatOutput(result: EntityCountResult): string {
  const lines = [`Total entities: ${result.total}`];

  const types = Object.entries(result.byType).sort((a, b) => b[1] - a[1]);
  if (types.length > 0) {
    lines.push('');
    lines.push('By type:');
    for (const [type, count] of types) {
      lines.push(`  ${type}: ${count}`);
    }
  }

  return lines.join('\n');
}

export function formatJson(result: EntityCountResult): string {
  return JSON.stringify(result, null, 2);
}
