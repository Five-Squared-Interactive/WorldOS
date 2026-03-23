// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import type { DockerClient } from './docker-client.js';
import type { ConfigLoader } from './config-loader.js';
import type { InstanceManager } from './instance-manager.js';

export interface HealthResult {
  status: 'ok' | 'degraded' | 'unhealthy';
  details: {
    dockerAvailable: boolean;
    services: number;
    totalInstances: number;
    runningInstances: number;
  };
}

export interface MetricsResult {
  services: number;
  totalInstances: number;
  runningInstances: number;
  stoppedInstances: number;
  perService: Array<{
    serviceId: string;
    total: number;
    running: number;
  }>;
}

export async function collectHealthStatus(
  docker: DockerClient,
  config: ConfigLoader,
  instanceManager: InstanceManager,
): Promise<HealthResult> {
  let dockerAvailable = false;
  try {
    dockerAvailable = await docker.ping();
  } catch {
    dockerAvailable = false;
  }
  const metrics = await collectMetrics(config, instanceManager);

  return {
    status: dockerAvailable ? 'ok' : 'degraded',
    details: {
      dockerAvailable,
      services: metrics.services,
      totalInstances: metrics.totalInstances,
      runningInstances: metrics.runningInstances,
    },
  };
}

export async function collectMetrics(
  config: ConfigLoader,
  instanceManager: InstanceManager,
): Promise<MetricsResult> {
  const services = config.getServices();
  let totalInstances = 0;
  let runningInstances = 0;
  const perService: MetricsResult['perService'] = [];

  for (const svc of services) {
    const statuses = await instanceManager.listInstances(svc.id);
    const running = statuses.filter((s) => s.running).length;
    totalInstances += statuses.length;
    runningInstances += running;
    perService.push({
      serviceId: svc.id,
      total: statuses.length,
      running,
    });
  }

  return {
    services: services.length,
    totalInstances,
    runningInstances,
    stoppedInstances: totalInstances - runningInstances,
    perService,
  };
}
