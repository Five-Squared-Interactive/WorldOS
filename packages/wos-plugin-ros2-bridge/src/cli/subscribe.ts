// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

/**
 * CLI Subscribe Command - wos ros2 subscribe <robot> <topic>
 *
 * Subscribes to wos/ros2/{robot}/{topic} and prints incoming messages.
 */

export interface SubscribeArgs {
  robot: string;
  topic: string;
}

export interface SubscribeOptions {
  json?: boolean;
  count?: number;
}

export function buildSubscribeTopic(robot: string, topic: string): string {
  const stripped = topic.startsWith('/') ? topic.slice(1) : topic;
  return `wos/ros2/${robot}/${stripped}`;
}

export function formatMessage(payload: unknown, json: boolean): string {
  if (json) {
    return JSON.stringify(payload);
  }

  if (typeof payload === 'object' && payload !== null) {
    return JSON.stringify(payload, null, 2);
  }

  return String(payload);
}
