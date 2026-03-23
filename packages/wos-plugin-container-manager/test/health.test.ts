// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi } from 'vitest';
import { collectHealthStatus, collectMetrics } from '../src/health.js';

function mockDockerClient(pingResult: boolean) {
  return { ping: vi.fn().mockResolvedValue(pingResult) } as any;
}

function mockConfigLoader(services: any[]) {
  return { getServices: vi.fn().mockReturnValue(services) } as any;
}

function mockInstanceManager(statuses: any[]) {
  return {
    listInstances: vi.fn().mockResolvedValue(statuses),
  } as any;
}

describe('health', () => {
  describe('collectHealthStatus', () => {
    it('should return ok when Docker is available', async () => {
      const docker = mockDockerClient(true);
      const config = mockConfigLoader([{ id: 'svc', instances: [{ instanceId: 'i1' }] }]);
      const mgr = mockInstanceManager([{ running: true, status: 'running' }]);

      const result = await collectHealthStatus(docker, config, mgr);
      expect(result.status).toBe('ok');
      expect(docker.ping).toHaveBeenCalled();
    });

    it('should return degraded when Docker is unreachable', async () => {
      const docker = mockDockerClient(false);
      const config = mockConfigLoader([]);
      const mgr = mockInstanceManager([]);

      const result = await collectHealthStatus(docker, config, mgr);
      expect(result.status).toBe('degraded');
    });
  });

  describe('collectMetrics', () => {
    it('should count running and total instances', async () => {
      const config = mockConfigLoader([
        { id: 'svc1', instances: [{ instanceId: 'i1' }, { instanceId: 'i2' }] },
      ]);
      const mgr = mockInstanceManager([
        { running: true, status: 'running' },
        { running: false, status: 'exited' },
      ]);

      const metrics = await collectMetrics(config, mgr);
      expect(metrics.services).toBe(1);
      expect(metrics.totalInstances).toBe(2);
      expect(metrics.runningInstances).toBe(1);
      expect(metrics.stoppedInstances).toBe(1);
    });

    it('should handle empty services', async () => {
      const config = mockConfigLoader([]);
      const mgr = mockInstanceManager([]);

      const metrics = await collectMetrics(config, mgr);
      expect(metrics.services).toBe(0);
      expect(metrics.totalInstances).toBe(0);
    });
  });
});
