// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { executeStatus, formatStatusOutput, formatStatusJson } from './status.js';
import type { RobotStatus } from '../types/rosbridge.js';

const mockStatuses: RobotStatus[] = [
  {
    robotName: 'arm-1',
    url: 'ws://192.168.1.10:9090',
    state: 'connected',
    latencyMs: 5,
    topics: [
      { name: '/joint_states', direction: 'ros-to-mqtt', messageCount: 100, lastMessageAt: Date.now() },
    ],
    serviceCallCount: 3,
    serviceErrorCount: 0,
    connectedSince: Date.now() - 60000,
  },
  {
    robotName: 'arm-2',
    url: 'ws://192.168.1.11:9090',
    state: 'disconnected',
    latencyMs: null,
    topics: [],
    serviceCallCount: 0,
    serviceErrorCount: 0,
    connectedSince: null,
  },
];

describe('CLI status', () => {
  it('formats text output for all robots', () => {
    const output = executeStatus(mockStatuses, {});
    expect(output).toContain('arm-1');
    expect(output).toContain('arm-2');
    expect(output).toContain('connected');
    expect(output).toContain('disconnected');
    expect(output).toContain('5ms');
  });

  it('filters by robot name', () => {
    const output = executeStatus(mockStatuses, { robot: 'arm-1' });
    expect(output).toContain('arm-1');
    expect(output).not.toContain('arm-2');
  });

  it('returns JSON output', () => {
    const output = executeStatus(mockStatuses, { json: true });
    const parsed = JSON.parse(output);
    expect(parsed.robots).toHaveLength(2);
    expect(parsed.robots[0].robotName).toBe('arm-1');
  });

  it('handles no robots', () => {
    const output = executeStatus([], {});
    expect(output).toContain('No robots configured');
  });

  it('handles robot not found', () => {
    const output = executeStatus(mockStatuses, { robot: 'nonexistent' });
    expect(output).toContain('No robot found');
  });
});
