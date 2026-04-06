// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

/**
 * Health check module for ROS2 Bridge Plugin
 *
 * Follows wos-plugin-presence/src/health.ts pattern.
 */

import type { ConnectionManager } from './connection-manager.js';
import type { RobotStatus } from './types/rosbridge.js';

export type HealthStatusValue = 'ok' | 'degraded' | 'unhealthy';

export interface BridgeHealthStatus {
  status: HealthStatusValue;
  connectedRobots: number;
  totalRobots: number;
  robots: RobotStatus[];
}

/**
 * Collect health status from the connection manager
 */
export function collectHealthStatus(manager: ConnectionManager): BridgeHealthStatus {
  const statuses = manager.getStatus();
  const connected = manager.getConnectedCount();
  const total = manager.getTotalCount();

  let status: HealthStatusValue;
  if (total === 0) {
    status = 'ok'; // No robots configured is not unhealthy
  } else if (connected === total) {
    status = 'ok';
  } else if (connected > 0) {
    status = 'degraded';
  } else {
    status = 'unhealthy';
  }

  return {
    status,
    connectedRobots: connected,
    totalRobots: total,
    robots: statuses,
  };
}

/**
 * Format health status for CLI/display output
 */
export function formatHealthStatus(health: BridgeHealthStatus): string {
  const lines: string[] = [];

  const icon = health.status === 'ok' ? '✓' : health.status === 'degraded' ? '!' : '✗';
  lines.push(`${icon} Status: ${health.status.toUpperCase()}`);
  lines.push(`  Connected: ${health.connectedRobots}/${health.totalRobots} robots`);

  for (const robot of health.robots) {
    const stateIcon = robot.state === 'connected' ? '●' : '○';
    const latency = robot.latencyMs !== null ? `${robot.latencyMs}ms` : 'N/A';
    lines.push(`  ${stateIcon} ${robot.robotName} (${robot.state}) - latency: ${latency}`);

    const topicCount = robot.topics.length;
    const totalMsgs = robot.topics.reduce((sum, t) => sum + t.messageCount, 0);
    lines.push(`    Topics: ${topicCount}, Messages: ${totalMsgs}, Service calls: ${robot.serviceCallCount}`);
  }

  return lines.join('\n');
}
