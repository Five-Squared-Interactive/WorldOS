/**
 * Presence List Command
 *
 * Story 11.2: Presence CLI Commands
 *
 * Lists all online users with optional world filtering.
 */

import { UserPresence } from '../presence-tracker.js';

/**
 * List command options
 */
export interface ListOptions {
  /** Filter by world ID */
  worldId?: string;
  /** Output as JSON */
  json?: boolean;
}

/**
 * List command result
 */
export interface ListResult {
  users: UserPresence[];
  count: number;
  worldId?: string;
}

/**
 * Format user for display
 */
export function formatUser(user: UserPresence): string {
  const parts = [
    user.displayName || user.userId,
    `(${user.sessionId})`,
  ];

  if (user.worldId) {
    parts.push(`in ${user.worldId}`);
  }

  parts.push(`joined ${formatTime(user.joinedAt)}`);

  if (user.status !== 'online') {
    parts.push(`[${user.status}]`);
  }

  return parts.join(' ');
}

/**
 * Format time for display
 */
function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ago`;
  }
  if (hours > 0) {
    return `${hours}h ago`;
  }
  if (minutes > 0) {
    return `${minutes}m ago`;
  }
  return 'just now';
}

/**
 * Format list output for terminal
 */
export function formatListOutput(result: ListResult): string {
  if (result.count === 0) {
    if (result.worldId) {
      return `No users online in world ${result.worldId}`;
    }
    return 'No users online';
  }

  const lines: string[] = [];

  if (result.worldId) {
    lines.push(`Users in world ${result.worldId}:`);
  } else {
    lines.push('Online users:');
  }

  lines.push('');

  for (const user of result.users) {
    lines.push(`  • ${formatUser(user)}`);
  }

  lines.push('');
  lines.push(`Total: ${result.count} user${result.count !== 1 ? 's' : ''}`);

  return lines.join('\n');
}

/**
 * Format list output as JSON
 */
export function formatListJson(result: ListResult): string {
  return JSON.stringify(
    {
      users: result.users.map((user) => ({
        userId: user.userId,
        sessionId: user.sessionId,
        displayName: user.displayName,
        worldId: user.worldId,
        status: user.status,
        joinedAt: user.joinedAt.toISOString(),
        lastActivity: user.lastActivity.toISOString(),
      })),
      count: result.count,
      worldId: result.worldId,
    },
    null,
    2
  );
}

/**
 * Execute list command
 */
export function executeList(
  users: UserPresence[],
  options: ListOptions
): string {
  const filteredUsers = options.worldId
    ? users.filter((u) => u.worldId === options.worldId)
    : users;

  const result: ListResult = {
    users: filteredUsers,
    count: filteredUsers.length,
    worldId: options.worldId,
  };

  if (options.json) {
    return formatListJson(result);
  }

  return formatListOutput(result);
}
