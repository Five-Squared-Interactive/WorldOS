// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

/**
 * CLI Status Command - wos ros2 status
 *
 * Shows connection state, latency, and topic counts per robot.
 */

import type { RobotStatus } from '../types/rosbridge.js';

export interface StatusOptions {
  robot?: string;
  json?: boolean;
}

export interface StatusResult {
  robots: RobotStatus[];
  filteredBy?: string;
}

export function formatStatusOutput(result: StatusResult): string {
  if (result.robots.length === 0) {
    if (result.filteredBy) {
      return `No robot found with name "${result.filteredBy}"`;
    }
    return 'No robots configured';
  }

  const lines: string[] = [];

  if (result.filteredBy) {
    lines.push(`Status for robot: ${result.filteredBy}`);
  } else {
    lines.push('ROS2 Bridge Status');
  }
  lines.push('');

  for (const robot of result.robots) {
    const stateIcon = robot.state === 'connected' ? '●' : '○';
    const latency = robot.latencyMs !== null ? `${robot.latencyMs}ms` : 'N/A';

    lines.push(`  ${stateIcon} ${robot.robotName}`);
    lines.push(`    URL:       ${robot.url}`);
    lines.push(`    State:     ${robot.state}`);
    lines.push(`    Latency:   ${latency}`);
    lines.push(`    Topics:    ${robot.topics.length}`);
    lines.push(`    Services:  ${robot.serviceCallCount} calls (${robot.serviceErrorCount} errors)`);

    if (robot.connectedSince) {
      const uptime = Math.floor((Date.now() - robot.connectedSince) / 1000);
      lines.push(`    Uptime:    ${formatUptime(uptime)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatStatusJson(result: StatusResult): string {
  return JSON.stringify(
    {
      robots: result.robots.map((r) => ({
        robotName: r.robotName,
        url: r.url,
        state: r.state,
        latencyMs: r.latencyMs,
        topicCount: r.topics.length,
        serviceCallCount: r.serviceCallCount,
        serviceErrorCount: r.serviceErrorCount,
        connectedSince: r.connectedSince,
      })),
      filteredBy: result.filteredBy,
    },
    null,
    2,
  );
}

export function executeStatus(
  statuses: RobotStatus[],
  options: StatusOptions,
): string {
  const filtered = options.robot
    ? statuses.filter((s) => s.robotName === options.robot)
    : statuses;

  const result: StatusResult = {
    robots: filtered,
    filteredBy: options.robot,
  };

  return options.json ? formatStatusJson(result) : formatStatusOutput(result);
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}
