// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

/**
 * CLI Publish Command - wos ros2 publish <robot> <topic> <message>
 *
 * Publishes a JSON message to wos/ros2/{robot}/publish/{topic}
 * which the plugin bridges to rosbridge.
 */

export interface PublishArgs {
  robot: string;
  topic: string;
  message: string;
}

export function buildPublishTopic(robot: string, topic: string): string {
  // Strip leading slash from topic
  const stripped = topic.startsWith('/') ? topic.slice(1) : topic;
  return `wos/ros2/${robot}/publish/${stripped}`;
}

export function parsePublishMessage(messageStr: string): unknown {
  try {
    return JSON.parse(messageStr);
  } catch {
    throw new Error(`Invalid JSON message: ${messageStr}`);
  }
}

export function formatPublishResult(topic: string, success: boolean): string {
  if (success) {
    return `Published to ${topic}`;
  }
  return `Failed to publish to ${topic}`;
}
