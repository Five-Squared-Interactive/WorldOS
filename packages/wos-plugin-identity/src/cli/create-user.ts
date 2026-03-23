// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import type { User } from '../user-store.js';

export interface CreateUserOptions {
  username: string;
  email: string;
  password: string;
  role?: string;
  json?: boolean;
}

export interface CreateUserResult {
  user?: User;
  error?: string;
}

export function formatOutput(result: CreateUserResult): string {
  if (result.error) {
    return `Error: ${result.error}`;
  }
  const u = result.user!;
  return [
    `Created user:`,
    `  ID:       ${u.id}`,
    `  Username: ${u.username}`,
    `  Email:    ${u.email}`,
    `  Name:     ${u.displayName}`,
    `  Role:     ${u.role}`,
  ].join('\n');
}

export function formatJson(result: CreateUserResult): string {
  return JSON.stringify(result, null, 2);
}
