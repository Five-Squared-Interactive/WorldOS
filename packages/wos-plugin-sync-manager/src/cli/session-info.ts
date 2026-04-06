// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export interface SessionInfoResult {
  sessionId?: string;
  tag?: string;
  clients?: string[];
  entityCount?: number;
  regionCoords?: { x: number; y: number };
  error?: string;
}

export function formatOutput(result: SessionInfoResult): string {
  if (result.error) {
    return `Error: ${result.error}`;
  }

  const lines: string[] = [];
  lines.push(`Session: ${result.sessionId ?? '--'}`);
  lines.push(`Tag: ${result.tag ?? '--'}`);

  if (result.regionCoords) {
    lines.push(`Region: (${result.regionCoords.x}, ${result.regionCoords.y})`);
  }

  lines.push(`Entities: ${result.entityCount ?? 0}`);

  if (result.clients && result.clients.length > 0) {
    lines.push(`Clients (${result.clients.length}):`);
    for (const c of result.clients) {
      lines.push(`  - ${c}`);
    }
  } else {
    lines.push('No clients connected');
  }

  return lines.join('\n');
}

export function formatJson(result: SessionInfoResult): string {
  return JSON.stringify(result, null, 2);
}
