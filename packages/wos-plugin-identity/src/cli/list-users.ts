// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import type { User } from '../user-store.js';

export interface ListUsersOptions {
  role?: string;
  json?: boolean;
}

export interface ListUsersResult {
  users: User[];
  count: number;
}

export function formatOutput(result: ListUsersResult): string {
  if (result.count === 0) {
    return 'No users found';
  }

  const lines: string[] = ['Users:', ''];
  for (const u of result.users) {
    lines.push(`  ${u.username} (${u.role}) - ${u.email} [${u.id}]`);
  }
  lines.push('');
  lines.push(`Total: ${result.count} user${result.count !== 1 ? 's' : ''}`);
  return lines.join('\n');
}

export function formatJson(result: ListUsersResult): string {
  return JSON.stringify(result, null, 2);
}
