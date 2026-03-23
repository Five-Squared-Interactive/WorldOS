// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ConfigLoader } from '../src/config-loader.js';
import type { ContainerConfig } from '../src/types.js';

function makeConfig(overrides?: Partial<ContainerConfig>): ContainerConfig {
  return {
    defaults: {
      network: 'wos-network',
      volumeBasePath: './data',
      portRangeStart: 32768,
      portRangeEnd: 60999,
    },
    services: [
      {
        id: 'worldcontainer',
        name: 'World Container',
        image: 'worldcontainer:latest',
        ports: [{ container: 5525, host: 'dynamic' as any }],
        volumes: [{ source: '${volumeBasePath}/${serviceId}/${instanceId}', target: '/data', type: 'bind' }],
        environment: { NODE_ENV: 'production' },
        restart: 'unless-stopped',
        instances: [
          { instanceId: 'container-1' },
          { instanceId: 'container-2', environment: { WORLD_TYPE: 'planet' } },
        ],
      },
    ],
    ...overrides,
  };
}

describe('ConfigLoader', () => {
  let tmpDir: string;
  let configPath: string;
  let loader: ConfigLoader;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cm-config-'));
    configPath = path.join(tmpDir, 'containers.json');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeConfig(config: ContainerConfig) {
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  }

  describe('load', () => {
    it('should load valid config from JSON file', async () => {
      const config = makeConfig();
      await writeConfig(config);
      loader = new ConfigLoader(configPath);
      await loader.load();
      expect(loader.getServices()).toHaveLength(1);
    });

    it('should throw on missing config file', async () => {
      loader = new ConfigLoader(path.join(tmpDir, 'nonexistent.json'));
      await expect(loader.load()).rejects.toThrow();
    });

    it('should throw on invalid config (missing defaults)', async () => {
      await fs.writeFile(configPath, JSON.stringify({ services: [] }));
      loader = new ConfigLoader(configPath);
      await expect(loader.load()).rejects.toThrow();
    });

    it('should throw on invalid config (missing services)', async () => {
      await fs.writeFile(configPath, JSON.stringify({ defaults: { network: 'x', volumeBasePath: '.', portRangeStart: 1, portRangeEnd: 2 } }));
      loader = new ConfigLoader(configPath);
      await expect(loader.load()).rejects.toThrow();
    });

    it('should throw on service missing required fields', async () => {
      const config = makeConfig();
      (config.services[0] as any).id = undefined;
      await writeConfig(config);
      loader = new ConfigLoader(configPath);
      await expect(loader.load()).rejects.toThrow();
    });
  });

  describe('getService / getServices', () => {
    beforeEach(async () => {
      await writeConfig(makeConfig());
      loader = new ConfigLoader(configPath);
      await loader.load();
    });

    it('should get service by ID', () => {
      const svc = loader.getService('worldcontainer');
      expect(svc).toBeDefined();
      expect(svc!.name).toBe('World Container');
    });

    it('should return null for unknown service ID', () => {
      expect(loader.getService('nonexistent')).toBeNull();
    });

    it('should get all services', () => {
      expect(loader.getServices()).toHaveLength(1);
    });
  });

  describe('getInstance / getInstances', () => {
    beforeEach(async () => {
      await writeConfig(makeConfig());
      loader = new ConfigLoader(configPath);
      await loader.load();
    });

    it('should get instance by serviceId + instanceId', () => {
      const inst = loader.getInstance('worldcontainer', 'container-1');
      expect(inst).toBeDefined();
      expect(inst!.instanceId).toBe('container-1');
    });

    it('should return null for unknown instance', () => {
      expect(loader.getInstance('worldcontainer', 'nonexistent')).toBeNull();
    });

    it('should return null for unknown service', () => {
      expect(loader.getInstance('nonexistent', 'container-1')).toBeNull();
    });

    it('should get all instances for a service', () => {
      expect(loader.getInstances('worldcontainer')).toHaveLength(2);
    });

    it('should return empty array for unknown service', () => {
      expect(loader.getInstances('nonexistent')).toEqual([]);
    });
  });

  describe('addInstance / removeInstance', () => {
    beforeEach(async () => {
      await writeConfig(makeConfig());
      loader = new ConfigLoader(configPath);
      await loader.load();
    });

    it('should add instance to service and persist', async () => {
      loader.addInstance('worldcontainer', { instanceId: 'container-3' });
      await loader.save();

      const raw = JSON.parse(await fs.readFile(configPath, 'utf-8'));
      const instances = raw.services[0].instances;
      expect(instances).toHaveLength(3);
      expect(instances[2].instanceId).toBe('container-3');
    });

    it('should throw when adding to nonexistent service', () => {
      expect(() => loader.addInstance('nonexistent', { instanceId: 'x' })).toThrow();
    });

    it('should remove instance from service and persist', async () => {
      const removed = loader.removeInstance('worldcontainer', 'container-2');
      expect(removed).toBe(true);
      await loader.save();

      const raw = JSON.parse(await fs.readFile(configPath, 'utf-8'));
      expect(raw.services[0].instances).toHaveLength(1);
    });

    it('should return false when removing nonexistent instance', () => {
      expect(loader.removeInstance('worldcontainer', 'nonexistent')).toBe(false);
    });
  });

  describe('getContainerName', () => {
    beforeEach(async () => {
      await writeConfig(makeConfig());
      loader = new ConfigLoader(configPath);
      await loader.load();
    });

    it('should generate default container name', () => {
      expect(loader.getContainerName('worldcontainer', 'container-1')).toBe('worldcontainer-container-1');
    });

    it('should use custom containerName if set', async () => {
      const config = makeConfig();
      config.services[0].instances[0].containerName = 'custom-name';
      await writeConfig(config);
      loader = new ConfigLoader(configPath);
      await loader.load();
      expect(loader.getContainerName('worldcontainer', 'container-1')).toBe('custom-name');
    });
  });

  describe('getMergedConfig', () => {
    beforeEach(async () => {
      await writeConfig(makeConfig());
      loader = new ConfigLoader(configPath);
      await loader.load();
    });

    it('should merge service and instance config', () => {
      const merged = loader.getMergedConfig('worldcontainer', 'container-2');
      expect(merged.image).toBe('worldcontainer:latest');
      expect(merged.environment).toEqual({ NODE_ENV: 'production', WORLD_TYPE: 'planet' });
      expect(merged.network).toBe('wos-network');
      expect(merged.restart).toBe('unless-stopped');
    });

    it('should return ports with dynamic marker (MergedConfig)', () => {
      const merged = loader.getMergedConfig('worldcontainer', 'container-1');
      expect(merged.ports).toEqual([{ container: 5525, host: 'dynamic' }]);
    });

    it('should REPLACE ports when instance overrides', async () => {
      const config = makeConfig();
      config.services[0].instances[0].ports = [{ container: 3000, host: 9000 }];
      await writeConfig(config);
      loader = new ConfigLoader(configPath);
      await loader.load();
      const merged = loader.getMergedConfig('worldcontainer', 'container-1');
      expect(merged.ports).toEqual([{ container: 3000, host: 9000 }]);
    });

    it('should CONCATENATE volumes', async () => {
      const config = makeConfig();
      config.services[0].instances[0].volumes = [{ source: '/extra', target: '/extra' }];
      await writeConfig(config);
      loader = new ConfigLoader(configPath);
      await loader.load();
      const merged = loader.getMergedConfig('worldcontainer', 'container-1');
      expect(merged.volumes).toHaveLength(2);
    });

    it('should MERGE environment', () => {
      const merged = loader.getMergedConfig('worldcontainer', 'container-2');
      expect(merged.environment.NODE_ENV).toBe('production');
      expect(merged.environment.WORLD_TYPE).toBe('planet');
    });

    it('should throw for unknown service', () => {
      expect(() => loader.getMergedConfig('nonexistent', 'x')).toThrow();
    });

    it('should throw for unknown instance', () => {
      expect(() => loader.getMergedConfig('worldcontainer', 'nonexistent')).toThrow();
    });
  });

  describe('expandPathTemplate', () => {
    beforeEach(async () => {
      await writeConfig(makeConfig());
      loader = new ConfigLoader(configPath);
      await loader.load();
    });

    it('should expand ${instanceId} and ${serviceId}', () => {
      const result = loader.expandPathTemplate(
        '${volumeBasePath}/${serviceId}/${instanceId}',
        { instanceId: 'container-1', serviceId: 'worldcontainer', volumeBasePath: './data', containerName: 'wc-c1' },
      );
      expect(result).toBe('./data/worldcontainer/container-1');
    });

    it('should leave unknown variables as literal', () => {
      const result = loader.expandPathTemplate('${unknown}/path', { instanceId: 'x', serviceId: 'y', volumeBasePath: '.', containerName: 'z' });
      expect(result).toBe('${unknown}/path');
    });
  });

  describe('getPortAllocations', () => {
    it('should return resolved port allocations', async () => {
      const config = makeConfig();
      config.services[0].instances[0].ports = [{ container: 5525, host: 32768 }];
      config.services[0].instances[1].ports = [{ container: 5525, host: 32769 }];
      await writeConfig(config);
      loader = new ConfigLoader(configPath);
      await loader.load();

      const allocs = loader.getPortAllocations();
      expect(allocs.size).toBe(2);
      expect(allocs.get('worldcontainer-container-1')).toEqual({ 5525: 32768 });
      expect(allocs.get('worldcontainer-container-2')).toEqual({ 5525: 32769 });
    });

    it('should skip dynamic ports', async () => {
      await writeConfig(makeConfig());
      loader = new ConfigLoader(configPath);
      await loader.load();

      const allocs = loader.getPortAllocations();
      expect(allocs.size).toBe(0);
    });
  });
});
