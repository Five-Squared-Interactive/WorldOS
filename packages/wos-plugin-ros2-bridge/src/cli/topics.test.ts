// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { executeTopics } from './topics.js';
import type { RobotStatus } from '../types/rosbridge.js';

const mockStatuses: RobotStatus[] = [
  {
    robotName: 'arm-1',
    url: 'ws://localhost:9090',
    state: 'connected',
    latencyMs: 5,
    topics: [
      { name: '/joint_states', direction: 'ros-to-mqtt', messageCount: 50, lastMessageAt: Date.now() },
      { name: '/cmd_vel', direction: 'mqtt-to-ros', messageCount: 10, lastMessageAt: Date.now() },
    ],
    serviceCallCount: 0,
    serviceErrorCount: 0,
    connectedSince: Date.now(),
  },
];

describe('CLI topics', () => {
  it('lists all topics', () => {
    const output = executeTopics(mockStatuses, {});
    expect(output).toContain('/joint_states');
    expect(output).toContain('/cmd_vel');
    expect(output).toContain('ROS→MQTT');
    expect(output).toContain('MQTT→ROS');
  });

  it('filters by robot', () => {
    const output = executeTopics(mockStatuses, { robot: 'arm-1' });
    expect(output).toContain('arm-1');
  });

  it('returns JSON', () => {
    const output = executeTopics(mockStatuses, { json: true });
    const parsed = JSON.parse(output);
    expect(parsed.topics).toHaveLength(2);
  });

  it('handles no topics', () => {
    const output = executeTopics([], {});
    expect(output).toContain('No bridged topics');
  });

  it('handles robot not found', () => {
    const output = executeTopics(mockStatuses, { robot: 'nonexistent' });
    expect(output).toContain('No topics found');
  });
});
