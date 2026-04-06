// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

/**
 * CLI Topics Command - wos ros2 topics
 *
 * Lists all bridged topics per robot with direction and message counts.
 */

import type { RobotStatus, TopicStats } from '../types/rosbridge.js';

export interface TopicsOptions {
  robot?: string;
  json?: boolean;
}

export interface TopicsResult {
  topics: Array<{ robotName: string } & TopicStats>;
  filteredBy?: string;
}

export function formatTopicsOutput(result: TopicsResult): string {
  if (result.topics.length === 0) {
    if (result.filteredBy) {
      return `No topics found for robot "${result.filteredBy}"`;
    }
    return 'No bridged topics';
  }

  const lines: string[] = [];
  lines.push('Bridged Topics');
  lines.push('');

  // Group by robot
  const byRobot = new Map<string, Array<TopicStats>>();
  for (const t of result.topics) {
    if (!byRobot.has(t.robotName)) byRobot.set(t.robotName, []);
    byRobot.get(t.robotName)!.push(t);
  }

  for (const [robotName, topics] of byRobot) {
    lines.push(`  ${robotName}:`);
    for (const t of topics) {
      const dir = t.direction === 'ros-to-mqtt' ? 'ROS→MQTT' : 'MQTT→ROS';
      const lastMsg = t.lastMessageAt
        ? new Date(t.lastMessageAt).toISOString()
        : 'never';
      lines.push(`    ${dir}  ${t.name}  (${t.messageCount} msgs, last: ${lastMsg})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatTopicsJson(result: TopicsResult): string {
  return JSON.stringify(result, null, 2);
}

export function executeTopics(
  statuses: RobotStatus[],
  options: TopicsOptions,
): string {
  const filtered = options.robot
    ? statuses.filter((s) => s.robotName === options.robot)
    : statuses;

  const topics = filtered.flatMap((s) =>
    s.topics.map((t) => ({ robotName: s.robotName, ...t })),
  );

  const result: TopicsResult = {
    topics,
    filteredBy: options.robot,
  };

  return options.json ? formatTopicsJson(result) : formatTopicsOutput(result);
}
