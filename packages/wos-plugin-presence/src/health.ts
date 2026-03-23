/**
 * Presence Health & Metrics
 *
 * Story 11.4: Presence Health & Metrics
 *
 * Health status and metrics reporting for the presence plugin.
 */

import { PresenceTracker } from './presence-tracker.js';

/**
 * Health status values
 */
export type HealthStatusValue = 'ok' | 'degraded' | 'unhealthy';

/**
 * Presence health status
 */
export interface PresenceHealthStatus {
  /** Overall status */
  status: HealthStatusValue;
  /** Online user count */
  onlineUsers: number;
  /** User counts by world */
  worldCounts: Record<string, number>;
  /** Tracker uptime in seconds */
  uptime: number;
  /** Additional details */
  details?: PresenceHealthDetails;
}

/**
 * Health details
 */
export interface PresenceHealthDetails {
  /** MQTT connection status */
  mqttConnected?: boolean;
  /** Time of last user activity */
  lastActivity?: string;
  /** Number of away users */
  awayUsers?: number;
  /** Memory usage (if available) */
  memoryUsage?: {
    heapUsed: number;
    heapTotal: number;
  };
}

/**
 * Presence metrics
 */
export interface PresenceMetrics {
  /** Total users currently online */
  onlineUsers: number;
  /** Total users marked as away */
  awayUsers: number;
  /** Users per world */
  worldCounts: Record<string, number>;
  /** Total number of worlds with users */
  activeWorlds: number;
  /** Plugin uptime in seconds */
  uptime: number;
  /** Timestamp of metrics collection */
  timestamp: string;
}

/**
 * Collect health status from tracker
 */
export function collectHealthStatus(
  tracker: PresenceTracker,
  options?: {
    mqttConnected?: boolean;
  }
): PresenceHealthStatus {
  const users = tracker.getAllUsers();
  const worldCounts = tracker.getWorldCounts();
  const awayUsers = users.filter((u) => u.status === 'away').length;
  const lastActivity = users.length > 0
    ? Math.max(...users.map((u) => u.lastActivity.getTime()))
    : null;

  // Determine status
  let status: HealthStatusValue = 'ok';
  if (options?.mqttConnected === false) {
    status = 'degraded';
  }

  return {
    status,
    onlineUsers: users.length,
    worldCounts,
    uptime: tracker.getUptime(),
    details: {
      mqttConnected: options?.mqttConnected,
      lastActivity: lastActivity ? new Date(lastActivity).toISOString() : undefined,
      awayUsers,
      memoryUsage: getMemoryUsage(),
    },
  };
}

/**
 * Collect metrics from tracker
 */
export function collectMetrics(tracker: PresenceTracker): PresenceMetrics {
  const users = tracker.getAllUsers();
  const worldCounts = tracker.getWorldCounts();
  const awayUsers = users.filter((u) => u.status === 'away').length;

  return {
    onlineUsers: users.length,
    awayUsers,
    worldCounts,
    activeWorlds: Object.keys(worldCounts).length,
    uptime: tracker.getUptime(),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format health status for display
 */
export function formatHealthStatus(health: PresenceHealthStatus): string {
  const lines: string[] = [];

  // Status indicator
  const statusIcon = health.status === 'ok' ? '✓' : health.status === 'degraded' ? '!' : '✗';
  lines.push(`${statusIcon} Status: ${health.status.toUpperCase()}`);

  // Basic metrics
  lines.push(`  Online users: ${health.onlineUsers}`);
  lines.push(`  Uptime: ${formatUptime(health.uptime)}`);

  // World breakdown
  const worlds = Object.entries(health.worldCounts);
  if (worlds.length > 0) {
    lines.push(`  Worlds:`);
    for (const [worldId, count] of worlds) {
      lines.push(`    - ${worldId}: ${count} users`);
    }
  }

  // Details
  if (health.details) {
    if (health.details.mqttConnected === false) {
      lines.push(`  ⚠ MQTT disconnected`);
    }
    if (health.details.awayUsers && health.details.awayUsers > 0) {
      lines.push(`  Away users: ${health.details.awayUsers}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format uptime for display
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

/**
 * Get current memory usage
 */
function getMemoryUsage(): PresenceHealthDetails['memoryUsage'] | undefined {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    const mem = process.memoryUsage();
    return {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
    };
  }
  return undefined;
}

/**
 * Create a health check handler for the plugin
 */
export function createHealthHandler(tracker: PresenceTracker) {
  return function healthCheck(options?: { mqttConnected?: boolean }) {
    return collectHealthStatus(tracker, options);
  };
}
