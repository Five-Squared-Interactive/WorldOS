// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export interface KickClientResult {
  success: boolean;
  sessionId: string;
  clientId: string;
  error?: string;
}

export function formatOutput(result: KickClientResult): string {
  if (!result.success) {
    return `Error: ${result.error || 'Operation failed'}`;
  }

  return `Client ${result.clientId} removed from session ${result.sessionId}`;
}

export function formatJson(result: KickClientResult): string {
  return JSON.stringify(result, null, 2);
}
