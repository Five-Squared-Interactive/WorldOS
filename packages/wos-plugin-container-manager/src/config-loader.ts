// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import * as fs from 'fs/promises';
import type {
  ContainerConfig, DefaultsConfig, ServiceConfig, InstanceConfig,
  MergedConfig, PortConfig,
} from './types.js';

interface PathTemplateVars {
  instanceId: string;
  serviceId: string;
  volumeBasePath: string;
  containerName: string;
}

export class ConfigLoader {
  private config!: ContainerConfig;
  private loaded = false;

  constructor(private readonly configPath: string) {}

  async load(): Promise<void> {
    const raw = await fs.readFile(this.configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    this.validate(parsed);
    this.config = parsed;
    this.loaded = true;
  }

  async save(): Promise<void> {
    this.ensureLoaded();
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
  }

  getService(id: string): ServiceConfig | null {
    this.ensureLoaded();
    return this.config.services.find((s) => s.id === id) ?? null;
  }

  getServices(): ServiceConfig[] {
    this.ensureLoaded();
    return this.config.services;
  }

  getDefaults(): DefaultsConfig {
    this.ensureLoaded();
    return this.config.defaults;
  }

  getInstance(serviceId: string, instanceId: string): InstanceConfig | null {
    const svc = this.getService(serviceId);
    if (!svc) return null;
    return svc.instances.find((i) => i.instanceId === instanceId) ?? null;
  }

  getInstances(serviceId: string): InstanceConfig[] {
    const svc = this.getService(serviceId);
    if (!svc) return [];
    return svc.instances;
  }

  addInstance(serviceId: string, instance: InstanceConfig): void {
    const svc = this.getService(serviceId);
    if (!svc) throw new Error(`Service not found: ${serviceId}`);
    svc.instances.push(instance);
  }

  removeInstance(serviceId: string, instanceId: string): boolean {
    const svc = this.getService(serviceId);
    if (!svc) return false;
    const idx = svc.instances.findIndex((i) => i.instanceId === instanceId);
    if (idx === -1) return false;
    svc.instances.splice(idx, 1);
    return true;
  }

  getContainerName(serviceId: string, instanceId: string): string {
    const inst = this.getInstance(serviceId, instanceId);
    if (inst?.containerName) return inst.containerName;
    return `${serviceId}-${instanceId}`;
  }

  getMergedConfig(serviceId: string, instanceId: string): MergedConfig {
    const svc = this.getService(serviceId);
    if (!svc) throw new Error(`Service not found: ${serviceId}`);
    const inst = svc.instances.find((i) => i.instanceId === instanceId);
    if (!inst) throw new Error(`Instance not found: ${serviceId}/${instanceId}`);
    const defaults = this.config.defaults;

    const containerName = inst.containerName || `${serviceId}-${instanceId}`;

    // Ports: REPLACE
    const ports: PortConfig[] = inst.ports?.length ? inst.ports : (svc.ports ?? []);

    // Volumes: CONCATENATE then expand templates
    const vars: PathTemplateVars = {
      instanceId,
      serviceId,
      volumeBasePath: defaults.volumeBasePath,
      containerName,
    };
    const svcVolumes = (svc.volumes ?? []).map((v) => ({
      source: this.expandPathTemplate(v.source, vars),
      target: v.target,
      type: v.type ?? 'bind',
    }));
    const instVolumes = (inst.volumes ?? []).map((v) => ({
      source: this.expandPathTemplate(v.source, vars),
      target: v.target,
      type: v.type ?? 'bind',
    }));

    return {
      name: containerName,
      image: inst.image || svc.image,
      ports,
      volumes: [...svcVolumes, ...instVolumes],
      environment: { ...svc.environment, ...inst.environment },
      network: svc.network || defaults.network,
      restart: inst.restart || svc.restart || 'unless-stopped',
      command: inst.command || svc.command,
    };
  }

  expandPathTemplate(template: string, vars: PathTemplateVars): string {
    return template.replace(/\$\{(\w+)\}/g, (match, key) => {
      if (key in vars) return (vars as any)[key];
      return match; // leave unknown variables as literal
    });
  }

  getPortAllocations(): Map<string, Record<number, number>> {
    this.ensureLoaded();
    const allocations = new Map<string, Record<number, number>>();

    for (const svc of this.config.services) {
      for (const inst of svc.instances) {
        const containerName = inst.containerName || `${svc.id}-${inst.instanceId}`;
        // Use instance-level ports if present, else service-level
        const ports = inst.ports?.length ? inst.ports : (svc.ports ?? []);
        const resolved: Record<number, number> = {};
        let hasResolved = false;
        for (const p of ports) {
          if (typeof p.host === 'number') {
            resolved[p.container] = p.host;
            hasResolved = true;
          }
        }
        if (hasResolved) {
          allocations.set(containerName, resolved);
        }
      }
    }

    return allocations;
  }

  /** Update a specific instance's port config (for persisting allocated ports) */
  updateInstancePorts(serviceId: string, instanceId: string, ports: PortConfig[]): void {
    const inst = this.getInstance(serviceId, instanceId);
    if (!inst) throw new Error(`Instance not found: ${serviceId}/${instanceId}`);
    inst.ports = ports;
  }

  private validate(config: any): void {
    if (!config.defaults) throw new Error('Config missing "defaults" section');
    if (!Array.isArray(config.services)) throw new Error('Config missing "services" array');

    const d = config.defaults;
    if (!d.network || !d.volumeBasePath || d.portRangeStart === undefined || d.portRangeEnd === undefined) {
      throw new Error('Config defaults missing required fields');
    }

    for (const svc of config.services) {
      if (!svc.id || !svc.image || !Array.isArray(svc.instances)) {
        throw new Error(`Service missing required fields: id, image, instances`);
      }
    }
  }

  private ensureLoaded(): void {
    if (!this.loaded) throw new Error('Config not loaded. Call load() first.');
  }
}
