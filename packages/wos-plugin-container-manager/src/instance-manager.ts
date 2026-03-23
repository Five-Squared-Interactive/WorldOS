// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { type DockerClient, DockerApiError } from './docker-client.js';
import type { ConfigLoader } from './config-loader.js';
import type { PortAllocator } from './port-allocator.js';
import type {
  InstanceConfig, InstanceResult, InstanceStatus, ScaleResult,
  ContainerRunConfig, MergedConfig,
} from './types.js';

export class InstanceManager {
  private locks = new Map<string, Promise<void>>();

  constructor(
    private readonly docker: DockerClient,
    private readonly config: ConfigLoader,
    private readonly ports: PortAllocator,
    private readonly logger: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void; debug: (...args: any[]) => void },
  ) {}

  private async withLock<T>(serviceId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(serviceId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    this.locks.set(serviceId, next);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(serviceId) === next) {
        this.locks.delete(serviceId);
      }
    }
  }

  async createInstance(serviceId: string, input: Partial<InstanceConfig> & { instanceId: string }): Promise<InstanceResult> {
    return this.withLock(serviceId, () => this._createInstance(serviceId, input));
  }

  private async _createInstance(serviceId: string, input: Partial<InstanceConfig> & { instanceId: string }): Promise<InstanceResult> {
    const svc = this.config.getService(serviceId);
    if (!svc) throw new Error(`Service not found: ${serviceId}`);

    const instanceId = input.instanceId;
    const instConfig: InstanceConfig = {
      instanceId,
      containerName: input.containerName,
      image: input.image,
      environment: input.environment,
      volumes: input.volumes,
      ports: input.ports,
    };

    this.config.addInstance(serviceId, instConfig);
    const merged = this.config.getMergedConfig(serviceId, instanceId);
    const containerName = this.config.getContainerName(serviceId, instanceId);
    const runConfig = this.resolvePorts(containerName, merged);

    // Persist allocated ports back to config
    const resolvedPorts = runConfig.ports.map((p) => ({ container: p.container, host: p.host }));
    this.config.updateInstancePorts(serviceId, instanceId, resolvedPorts);

    const { id } = await this.docker.createContainer(runConfig);
    await this.config.save();

    this.logger.info(`Created instance ${serviceId}/${instanceId} (container: ${id})`);

    return {
      serviceId,
      instanceId,
      containerName,
      containerId: id,
      status: 'created',
      ports: this.portMapToRecord(runConfig.ports),
    };
  }

  async startInstance(serviceId: string, instanceId: string): Promise<InstanceResult> {
    const containerName = this.config.getContainerName(serviceId, instanceId);

    try {
      const inspect = await this.docker.inspectContainer(containerName);
      if (inspect.State.Running) {
        return { serviceId, instanceId, containerName, containerId: inspect.Id, status: 'already_running' };
      }
      await this.docker.startContainer(inspect.Id);
      this.logger.info(`Started instance ${serviceId}/${instanceId}`);
      return { serviceId, instanceId, containerName, containerId: inspect.Id, status: 'started' };
    } catch (err) {
      if (err instanceof DockerApiError && err.statusCode !== 404) throw err;
      if (!(err instanceof DockerApiError)) throw err;
      // Container doesn't exist (404) — create and start
      const merged = this.config.getMergedConfig(serviceId, instanceId);
      const runConfig = this.resolvePorts(containerName, merged);
      const resolvedPorts = runConfig.ports.map((p) => ({ container: p.container, host: p.host }));
      this.config.updateInstancePorts(serviceId, instanceId, resolvedPorts);
      const { id } = await this.docker.createContainer(runConfig);
      await this.docker.startContainer(id);
      await this.config.save();
      this.logger.info(`Created and started instance ${serviceId}/${instanceId}`);
      return { serviceId, instanceId, containerName, containerId: id, status: 'created_and_started', ports: this.portMapToRecord(runConfig.ports) };
    }
  }

  async stopInstance(serviceId: string, instanceId: string, timeout?: number): Promise<InstanceResult> {
    const containerName = this.config.getContainerName(serviceId, instanceId);
    const inspect = await this.docker.inspectContainer(containerName);
    await this.docker.stopContainer(inspect.Id, timeout);
    this.logger.info(`Stopped instance ${serviceId}/${instanceId}`);
    return { serviceId, instanceId, containerName, containerId: inspect.Id, status: 'stopped' };
  }

  async restartInstance(serviceId: string, instanceId: string): Promise<InstanceResult> {
    const containerName = this.config.getContainerName(serviceId, instanceId);
    const inspect = await this.docker.inspectContainer(containerName);
    await this.docker.restartContainer(inspect.Id);
    this.logger.info(`Restarted instance ${serviceId}/${instanceId}`);
    return { serviceId, instanceId, containerName, containerId: inspect.Id, status: 'restarted' };
  }

  async removeInstance(
    serviceId: string,
    instanceId: string,
    options?: { force?: boolean; removeVolumes?: boolean },
  ): Promise<InstanceResult> {
    return this.withLock(serviceId, () => this._removeInstance(serviceId, instanceId, options));
  }

  private async _removeInstance(
    serviceId: string,
    instanceId: string,
    options?: { force?: boolean; removeVolumes?: boolean },
  ): Promise<InstanceResult> {
    const containerName = this.config.getContainerName(serviceId, instanceId);

    try {
      const inspect = await this.docker.inspectContainer(containerName);
      await this.docker.removeContainer(inspect.Id, options);
    } catch {
      // Container may not exist in Docker — still clean up config
    }

    this.ports.release(containerName);
    this.config.removeInstance(serviceId, instanceId);
    await this.config.save();

    this.logger.info(`Removed instance ${serviceId}/${instanceId}`);
    return { serviceId, instanceId, containerName, status: 'removed' };
  }

  async getStatus(serviceId: string, instanceId: string): Promise<InstanceStatus> {
    const containerName = this.config.getContainerName(serviceId, instanceId);

    try {
      const inspect = await this.docker.inspectContainer(containerName);
      const portMap: Record<string, number> = {};
      if (inspect.NetworkSettings?.Ports) {
        for (const [key, bindings] of Object.entries(inspect.NetworkSettings.Ports)) {
          if (bindings?.[0]?.HostPort) {
            portMap[key] = parseInt(bindings[0].HostPort, 10);
          }
        }
      }
      return {
        serviceId,
        instanceId,
        containerName,
        exists: true,
        running: inspect.State.Running,
        status: inspect.State.Status,
        state: inspect.State as any,
        ports: portMap,
      };
    } catch {
      return {
        serviceId,
        instanceId,
        containerName,
        exists: false,
        running: false,
        status: 'not_found',
      };
    }
  }

  async listInstances(serviceId: string): Promise<InstanceStatus[]> {
    const instances = this.config.getInstances(serviceId);
    return Promise.all(
      instances.map((inst) => this.getStatus(serviceId, inst.instanceId)),
    );
  }

  async scaleService(serviceId: string, targetCount: number): Promise<ScaleResult> {
    return this.withLock(serviceId, () => this._scaleService(serviceId, targetCount));
  }

  private async _scaleService(serviceId: string, targetCount: number): Promise<ScaleResult> {
    const svc = this.config.getService(serviceId);
    if (!svc) throw new Error(`Service not found: ${serviceId}`);

    const currentInstances = this.config.getInstances(serviceId);
    const currentCount = currentInstances.length;
    const results: ScaleResult['instances'] = [];

    if (targetCount > currentCount) {
      // Scale up — find next available instance ID
      let nextIdx = this.getNextInstanceIndex(currentInstances);
      for (let i = 0; i < targetCount - currentCount; i++) {
        const instanceId = `instance-${nextIdx++}`;
        await this._createInstance(serviceId, { instanceId });
        results.push({ instanceId, action: 'created', status: 'created' });
      }
      for (const inst of currentInstances) {
        results.push({ instanceId: inst.instanceId, action: 'unchanged', status: 'unchanged' });
      }
    } else if (targetCount < currentCount) {
      // Scale down — remove from end (highest ID first)
      const sorted = [...currentInstances].sort((a, b) => {
        const aNum = this.extractInstanceNum(a.instanceId);
        const bNum = this.extractInstanceNum(b.instanceId);
        if (aNum !== null && bNum !== null) return bNum - aNum;
        if (aNum !== null) return -1; // numeric before user-named
        if (bNum !== null) return 1;
        return b.instanceId.localeCompare(a.instanceId);
      });
      const toRemove = sorted.slice(0, currentCount - targetCount);
      const toKeep = sorted.slice(currentCount - targetCount);

      for (const inst of toRemove) {
        await this._removeInstance(serviceId, inst.instanceId, { force: true });
        results.push({ instanceId: inst.instanceId, action: 'removed', status: 'removed' });
      }
      for (const inst of toKeep) {
        results.push({ instanceId: inst.instanceId, action: 'unchanged', status: 'unchanged' });
      }
    } else {
      for (const inst of currentInstances) {
        results.push({ instanceId: inst.instanceId, action: 'unchanged', status: 'unchanged' });
      }
    }

    return { serviceId, targetCount, instances: results };
  }

  async startAll(serviceId?: string): Promise<InstanceResult[]> {
    const services = serviceId
      ? [this.config.getService(serviceId)].filter(Boolean) as any[]
      : this.config.getServices();

    const results: InstanceResult[] = [];
    for (const svc of services) {
      for (const inst of svc.instances) {
        results.push(await this.startInstance(svc.id, inst.instanceId));
      }
    }
    return results;
  }

  async stopAll(serviceId?: string, timeout?: number): Promise<InstanceResult[]> {
    const services = serviceId
      ? [this.config.getService(serviceId)].filter(Boolean) as any[]
      : this.config.getServices();

    const results: InstanceResult[] = [];
    for (const svc of services) {
      for (const inst of svc.instances) {
        try {
          results.push(await this.stopInstance(svc.id, inst.instanceId, timeout));
        } catch (err: any) {
          results.push({
            serviceId: svc.id,
            instanceId: inst.instanceId,
            containerName: this.config.getContainerName(svc.id, inst.instanceId),
            status: 'error',
            error: err.message,
          });
        }
      }
    }
    return results;
  }

  async getLogs(serviceId: string, instanceId: string, tail?: number, since?: string): Promise<string> {
    const containerName = this.config.getContainerName(serviceId, instanceId);
    const inspect = await this.docker.inspectContainer(containerName);
    return this.docker.getContainerLogs(inspect.Id, tail, since);
  }

  private resolvePorts(containerName: string, merged: MergedConfig): ContainerRunConfig {
    const resolvedPorts = merged.ports.map((p) => {
      if (typeof p.host === 'number') return { container: p.container, host: p.host };
      return { container: p.container, host: this.ports.allocate(containerName, p.container) };
    });

    return {
      ...merged,
      ports: resolvedPorts,
    };
  }

  private portMapToRecord(ports: Array<{ container: number; host: number }>): Record<string, number> {
    const record: Record<string, number> = {};
    for (const p of ports) {
      record[String(p.container)] = p.host;
    }
    return record;
  }

  private getNextInstanceIndex(instances: { instanceId: string }[]): number {
    let max = 0;
    for (const inst of instances) {
      const num = this.extractInstanceNum(inst.instanceId);
      if (num !== null && num >= max) max = num + 1;
    }
    return max;
  }

  private extractInstanceNum(instanceId: string): number | null {
    const match = instanceId.match(/^instance-(\d+)$/);
    if (match) return parseInt(match[1], 10);
    // Also check container-N pattern
    const match2 = instanceId.match(/^container-(\d+)$/);
    if (match2) return parseInt(match2[1], 10);
    return null;
  }
}
