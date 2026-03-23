// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export interface RevokeTokenOptions {
  token?: string;
  user?: string;
  json?: boolean;
}

export interface RevokeTokenResult {
  revoked: boolean;
  count: number;
  error?: string;
}

export function formatOutput(result: RevokeTokenResult): string {
  if (result.error) {
    return `Error: Token not found`;
  }
  if (result.count === 1) {
    return 'Revoked 1 token';
  }
  return `Revoked ${result.count} tokens`;
}

export function formatJson(result: RevokeTokenResult): string {
  return JSON.stringify(result, null, 2);
}
