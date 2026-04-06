// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export interface SessionSummary {
  sessionId: string;
  tag: string;
  clientCount: number;
  entityCount: number;
  createdAt: number;
}

export interface ListSessionsResult {
  sessions: SessionSummary[];
  error?: string;
}

export function formatOutput(result: ListSessionsResult): string {
  if (result.error) {
    return `Error: ${result.error}`;
  }

  if (result.sessions.length === 0) {
    return 'No active sessions';
  }

  const lines: string[] = [
    'Session ID         Tag              Clients  Entities  Created',
    '─'.repeat(74),
  ];

  for (const s of result.sessions) {
    const created = new Date(s.createdAt).toISOString().replace('T', ' ').slice(0, 19);
    const id = s.sessionId.length > 17 ? s.sessionId.slice(0, 14) + '...' : s.sessionId;
    lines.push(
      `${id.padEnd(19)}${s.tag.padEnd(17)}${String(s.clientCount).padStart(7)}  ${String(s.entityCount).padStart(8)}  ${created}`,
    );
  }

  lines.push('');
  lines.push(`Total: ${result.sessions.length} session${result.sessions.length !== 1 ? 's' : ''}`);
  return lines.join('\n');
}

export function formatJson(result: ListSessionsResult): string {
  return JSON.stringify(result, null, 2);
}
