// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { collectHealthStatus, formatHealthStatus } from './health.js';

function createMockManager(connected: number, total: number, statuses: any[] = []) {
  return {
    getConnectedCount: () => connected,
    getTotalCount: () => total,
    getStatus: () => statuses,
  };
}

describe('Health', () => {
  it('returns ok when all robots connected', () => {
    const result = collectHealthStatus(
      createMockManager(2, 2, [
        { robotName: 'arm-1', state: 'connected', latencyMs: 5, topics: [], serviceCallCount: 0, serviceErrorCount: 0 },
        { robotName: 'arm-2', state: 'connected', latencyMs: 8, topics: [], serviceCallCount: 0, serviceErrorCount: 0 },
      ]) as any,
    );

    expect(result.status).toBe('ok');
    expect(result.connectedRobots).toBe(2);
    expect(result.totalRobots).toBe(2);
  });

  it('returns degraded when some robots disconnected', () => {
    const result = collectHealthStatus(
      createMockManager(1, 2, [
        { robotName: 'arm-1', state: 'connected', latencyMs: 5, topics: [], serviceCallCount: 0, serviceErrorCount: 0 },
        { robotName: 'arm-2', state: 'disconnected', latencyMs: null, topics: [], serviceCallCount: 0, serviceErrorCount: 0 },
      ]) as any,
    );

    expect(result.status).toBe('degraded');
  });

  it('returns unhealthy when no robots connected', () => {
    const result = collectHealthStatus(
      createMockManager(0, 2, [
        { robotName: 'arm-1', state: 'disconnected', latencyMs: null, topics: [], serviceCallCount: 0, serviceErrorCount: 0 },
        { robotName: 'arm-2', state: 'disconnected', latencyMs: null, topics: [], serviceCallCount: 0, serviceErrorCount: 0 },
      ]) as any,
    );

    expect(result.status).toBe('unhealthy');
  });

  it('returns ok when no robots configured', () => {
    const result = collectHealthStatus(createMockManager(0, 0) as any);
    expect(result.status).toBe('ok');
  });

  it('formats health status for display', () => {
    const health = {
      status: 'degraded' as const,
      connectedRobots: 1,
      totalRobots: 2,
      robots: [
        {
          robotName: 'arm-1',
          url: 'ws://localhost:9090',
          state: 'connected' as const,
          latencyMs: 5,
          topics: [{ name: '/odom', direction: 'ros-to-mqtt' as const, messageCount: 100, lastMessageAt: Date.now() }],
          serviceCallCount: 3,
          serviceErrorCount: 0,
          connectedSince: Date.now(),
        },
        {
          robotName: 'arm-2',
          url: 'ws://localhost:9091',
          state: 'disconnected' as const,
          latencyMs: null,
          topics: [],
          serviceCallCount: 0,
          serviceErrorCount: 0,
          connectedSince: null,
        },
      ],
    };

    const output = formatHealthStatus(health);
    expect(output).toContain('DEGRADED');
    expect(output).toContain('1/2 robots');
    expect(output).toContain('arm-1');
    expect(output).toContain('arm-2');
    expect(output).toContain('connected');
    expect(output).toContain('disconnected');
  });
});
