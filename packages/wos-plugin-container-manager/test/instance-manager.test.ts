// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstanceManager } from '../src/instance-manager.js';
import { DockerApiError, type DockerClient } from '../src/docker-client.js';
import type { ConfigLoader } from '../src/config-loader.js';
import type { PortAllocator } from '../src/port-allocator.js';

function mockDockerClient(): DockerClient {
  return {
    ping: vi.fn().mockResolvedValue(true),
    listContainers: vi.fn().mockResolvedValue([]),
    createContainer: vi.fn().mockResolvedValue({ id: 'docker-id-123' }),
    inspectContainer: vi.fn().mockResolvedValue({
      Id: 'docker-id-123',
      Name: '/worldcontainer-container-1',
      State: { Status: 'running', Running: true, Pid: 1234, ExitCode: 0 },
      NetworkSettings: { Ports: { '5525/tcp': [{ HostPort: '32768' }] } },
      Config: { Env: [], Image: 'worldcontainer:latest' },
      HostConfig: { RestartPolicy: { Name: 'unless-stopped' } },
    }),
    startContainer: vi.fn().mockResolvedValue(undefined),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    restartContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    getContainerLogs: vi.fn().mockResolvedValue('log output'),
    imageExists: vi.fn().mockResolvedValue(true),
    pullImage: vi.fn().mockResolvedValue(undefined),
    listImages: vi.fn().mockResolvedValue([]),
  } as any;
}

function mockConfigLoader(): ConfigLoader {
  const instances = [
    { instanceId: 'container-1' },
    { instanceId: 'container-2', environment: { WORLD_TYPE: 'planet' } },
  ];

  return {
    getService: vi.fn().mockReturnValue({
      id: 'worldcontainer',
      name: 'World Container',
      image: 'worldcontainer:latest',
      ports: [{ container: 5525, host: 'dynamic' }],
      instances,
    }),
    getServices: vi.fn().mockReturnValue([{
      id: 'worldcontainer',
      name: 'World Container',
      image: 'worldcontainer:latest',
      instances,
    }]),
    getInstances: vi.fn().mockReturnValue(instances),
    getInstance: vi.fn().mockImplementation((_svc: string, instId: string) =>
      instances.find((i) => i.instanceId === instId) ?? null),
    getContainerName: vi.fn().mockImplementation((svc: string, inst: string) => `${svc}-${inst}`),
    getMergedConfig: vi.fn().mockReturnValue({
      name: 'worldcontainer-container-1',
      image: 'worldcontainer:latest',
      ports: [{ container: 5525, host: 'dynamic' }],
      volumes: [{ source: './data/worldcontainer/container-1', target: '/data', type: 'bind' }],
      environment: { NODE_ENV: 'production' },
      network: 'wos-network',
      restart: 'unless-stopped',
    }),
    addInstance: vi.fn(),
    removeInstance: vi.fn().mockReturnValue(true),
    save: vi.fn().mockResolvedValue(undefined),
    updateInstancePorts: vi.fn(),
  } as any;
}

function mockPortAllocator(): PortAllocator {
  return {
    allocate: vi.fn().mockReturnValue(32768),
    release: vi.fn(),
    getAllocated: vi.fn().mockReturnValue({ 5525: 32768 }),
    getAllAllocated: vi.fn().mockReturnValue(new Map()),
    isAllocated: vi.fn().mockReturnValue(false),
    restore: vi.fn(),
  } as any;
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe('InstanceManager', () => {
  let docker: ReturnType<typeof mockDockerClient>;
  let config: ReturnType<typeof mockConfigLoader>;
  let ports: ReturnType<typeof mockPortAllocator>;
  let manager: InstanceManager;

  beforeEach(() => {
    vi.clearAllMocks();
    docker = mockDockerClient();
    config = mockConfigLoader();
    ports = mockPortAllocator();
    manager = new InstanceManager(docker as any, config as any, ports as any, mockLogger as any);
  });

  describe('createInstance', () => {
    it('should create a new instance with allocated ports', async () => {
      const result = await manager.createInstance('worldcontainer', { instanceId: 'container-3' });
      expect(result.serviceId).toBe('worldcontainer');
      expect(result.instanceId).toBe('container-3');
      expect(result.status).toBe('created');
      expect(config.addInstance).toHaveBeenCalled();
      expect(docker.createContainer).toHaveBeenCalled();
      expect(config.save).toHaveBeenCalled();
    });

    it('should resolve MergedConfig dynamic ports via PortAllocator', async () => {
      await manager.createInstance('worldcontainer', { instanceId: 'container-3' });
      expect(ports.allocate).toHaveBeenCalled();
      const createCall = (docker.createContainer as any).mock.calls[0][0];
      expect(createCall.ports[0].host).toBe(32768);
    });

    it('should throw if service not found', async () => {
      (config.getService as any).mockReturnValue(null);
      await expect(manager.createInstance('nonexistent', { instanceId: 'x' }))
        .rejects.toThrow();
    });
  });

  describe('startInstance', () => {
    it('should start an existing stopped container', async () => {
      (docker.inspectContainer as any).mockResolvedValue({
        Id: 'docker-id-123',
        Name: '/worldcontainer-container-1',
        State: { Status: 'exited', Running: false, Pid: 0, ExitCode: 0 },
        NetworkSettings: { Ports: {} },
        Config: { Env: [], Image: 'worldcontainer:latest' },
        HostConfig: { RestartPolicy: { Name: 'unless-stopped' } },
      });
      const result = await manager.startInstance('worldcontainer', 'container-1');
      expect(result.status).toBe('started');
      expect(docker.startContainer).toHaveBeenCalled();
    });

    it('should return success if already running (idempotent)', async () => {
      const result = await manager.startInstance('worldcontainer', 'container-1');
      expect(result.status).toBe('already_running');
      expect(docker.startContainer).not.toHaveBeenCalled();
    });

    it('should create and start if container does not exist', async () => {
      (docker.inspectContainer as any).mockRejectedValueOnce(new DockerApiError(404, 'No such container'));
      const result = await manager.startInstance('worldcontainer', 'container-1');
      expect(result.status).toBe('created_and_started');
      expect(docker.createContainer).toHaveBeenCalled();
      expect(docker.startContainer).toHaveBeenCalled();
    });
  });

  describe('stopInstance', () => {
    it('should stop a running container', async () => {
      const result = await manager.stopInstance('worldcontainer', 'container-1');
      expect(result.status).toBe('stopped');
      expect(docker.stopContainer).toHaveBeenCalled();
    });

    it('should pass timeout parameter', async () => {
      await manager.stopInstance('worldcontainer', 'container-1', 30);
      expect(docker.stopContainer).toHaveBeenCalledWith('docker-id-123', 30);
    });
  });

  describe('restartInstance', () => {
    it('should restart a container', async () => {
      const result = await manager.restartInstance('worldcontainer', 'container-1');
      expect(result.status).toBe('restarted');
      expect(docker.restartContainer).toHaveBeenCalled();
    });
  });

  describe('removeInstance', () => {
    it('should remove container and release ports', async () => {
      const result = await manager.removeInstance('worldcontainer', 'container-1');
      expect(result.status).toBe('removed');
      expect(docker.removeContainer).toHaveBeenCalled();
      expect(ports.release).toHaveBeenCalledWith('worldcontainer-container-1');
      expect(config.removeInstance).toHaveBeenCalledWith('worldcontainer', 'container-1');
      expect(config.save).toHaveBeenCalled();
    });

    it('should pass force and removeVolumes options', async () => {
      await manager.removeInstance('worldcontainer', 'container-1', { force: true, removeVolumes: true });
      expect(docker.removeContainer).toHaveBeenCalledWith('docker-id-123', { force: true, removeVolumes: true });
    });
  });

  describe('getStatus', () => {
    it('should return running status', async () => {
      const status = await manager.getStatus('worldcontainer', 'container-1');
      expect(status.running).toBe(true);
      expect(status.exists).toBe(true);
      expect(status.serviceId).toBe('worldcontainer');
    });

    it('should return not-exists status on inspect failure', async () => {
      (docker.inspectContainer as any).mockRejectedValue(new Error('not found'));
      const status = await manager.getStatus('worldcontainer', 'container-1');
      expect(status.exists).toBe(false);
      expect(status.running).toBe(false);
    });
  });

  describe('listInstances', () => {
    it('should list all instances with status', async () => {
      const list = await manager.listInstances('worldcontainer');
      expect(list).toHaveLength(2);
    });
  });

  describe('scaleService', () => {
    it('should scale up by creating new instances', async () => {
      const result = await manager.scaleService('worldcontainer', 4);
      expect(result.targetCount).toBe(4);
      // Already has 2, needs 2 more
      const created = result.instances.filter((i) => i.action === 'created');
      expect(created.length).toBe(2);
    });

    it('should scale down by removing excess instances', async () => {
      const result = await manager.scaleService('worldcontainer', 1);
      expect(result.targetCount).toBe(1);
      const removed = result.instances.filter((i) => i.action === 'removed');
      expect(removed.length).toBe(1);
    });

    it('should not change when count matches', async () => {
      const result = await manager.scaleService('worldcontainer', 2);
      const unchanged = result.instances.filter((i) => i.action === 'unchanged');
      expect(unchanged.length).toBe(2);
    });
  });

  describe('startAll / stopAll', () => {
    it('should start all instances of a service', async () => {
      const results = await manager.startAll('worldcontainer');
      expect(results).toHaveLength(2);
    });

    it('should stop all instances of a service', async () => {
      const results = await manager.stopAll('worldcontainer');
      expect(results).toHaveLength(2);
    });
  });

  describe('getLogs', () => {
    it('should return container logs', async () => {
      const logs = await manager.getLogs('worldcontainer', 'container-1');
      expect(logs).toBe('log output');
    });

    it('should pass tail and since parameters', async () => {
      await manager.getLogs('worldcontainer', 'container-1', 100, '2026-01-01');
      expect(docker.getContainerLogs).toHaveBeenCalledWith('docker-id-123', 100, '2026-01-01');
    });
  });
});
