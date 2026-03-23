// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DockerClient } from '../src/docker-client.js';

// Mock http module to intercept Docker API calls
vi.mock('http', () => {
  const mockResponse = {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    on: vi.fn(),
    setEncoding: vi.fn(),
  };
  const mockRequest = {
    on: vi.fn(),
    end: vi.fn(),
    write: vi.fn(),
    destroy: vi.fn(),
  };
  return {
    default: {
      request: vi.fn(() => mockRequest),
    },
    request: vi.fn(() => mockRequest),
  };
});

import http from 'http';

function setupMockResponse(statusCode: number, body: any) {
  const mockReq = (http.request as any).mock.results?.slice(-1)[0]?.value ?? {
    on: vi.fn(),
    end: vi.fn(),
    write: vi.fn(),
    destroy: vi.fn(),
  };

  // Reset and setup
  (http.request as any).mockImplementation((opts: any, callback: any) => {
    const res = {
      statusCode,
      headers: { 'content-type': 'application/json' },
      on: vi.fn((event: string, handler: any) => {
        if (event === 'data') {
          setTimeout(() => handler(JSON.stringify(body)), 0);
        }
        if (event === 'end') {
          setTimeout(() => handler(), 1);
        }
        return res;
      }),
      setEncoding: vi.fn(),
    };
    setTimeout(() => callback(res), 0);
    return {
      on: vi.fn().mockReturnThis(),
      end: vi.fn(),
      write: vi.fn(),
      destroy: vi.fn(),
    };
  });
}

function setupMockError(errorMessage: string) {
  (http.request as any).mockImplementation((_opts: any, _callback: any) => {
    const req = {
      on: vi.fn((event: string, handler: any) => {
        if (event === 'error') {
          setTimeout(() => handler(new Error(errorMessage)), 0);
        }
        return req;
      }),
      end: vi.fn(),
      write: vi.fn(),
      destroy: vi.fn(),
    };
    return req;
  });
}

function getLastRequestOptions(): any {
  const calls = (http.request as any).mock.calls;
  return calls[calls.length - 1]?.[0];
}

describe('DockerClient', () => {
  let client: DockerClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new DockerClient({ socketPath: '/var/run/docker.sock' });
  });

  describe('constructor', () => {
    it('should use provided socket path', () => {
      const c = new DockerClient({ socketPath: '/custom/docker.sock' });
      expect(c).toBeDefined();
    });

    it('should detect platform when no socket path provided', () => {
      const c = new DockerClient();
      expect(c).toBeDefined();
    });
  });

  describe('ping', () => {
    it('should return true when Docker is available', async () => {
      setupMockResponse(200, 'OK');
      const result = await client.ping();
      expect(result).toBe(true);
      const opts = getLastRequestOptions();
      expect(opts.path).toBe('/_ping');
      expect(opts.method).toBe('GET');
    });

    it('should return false when Docker is unavailable', async () => {
      setupMockError('connect ENOENT /var/run/docker.sock');
      const result = await client.ping();
      expect(result).toBe(false);
    });
  });

  describe('listContainers', () => {
    it('should list running containers by default', async () => {
      const containers = [
        { Id: 'abc123', Names: ['/test-1'], State: 'running', Status: 'Up 2 hours', Ports: [], Image: 'nginx' },
      ];
      setupMockResponse(200, containers);
      const result = await client.listContainers();
      expect(result).toEqual(containers);
      const opts = getLastRequestOptions();
      expect(opts.path).toBe('/containers/json');
    });

    it('should list all containers when all=true', async () => {
      setupMockResponse(200, []);
      await client.listContainers(true);
      const opts = getLastRequestOptions();
      expect(opts.path).toBe('/containers/json?all=true');
    });
  });

  describe('createContainer', () => {
    it('should create a container with config', async () => {
      setupMockResponse(201, { Id: 'new-container-id' });
      const result = await client.createContainer({
        name: 'test-container',
        image: 'nginx:latest',
        ports: [{ container: 80, host: 8080 }],
        volumes: [],
        environment: { NODE_ENV: 'production' },
        network: 'wos-network',
        restart: 'unless-stopped',
      });
      expect(result).toEqual({ id: 'new-container-id' });
      const opts = getLastRequestOptions();
      expect(opts.path).toContain('/containers/create');
      expect(opts.path).toContain('name=test-container');
      expect(opts.method).toBe('POST');
    });
  });

  describe('inspectContainer', () => {
    it('should return container details', async () => {
      const inspectData = {
        Id: 'abc123',
        Name: '/test-1',
        State: { Status: 'running', Running: true, Pid: 1234, ExitCode: 0 },
        NetworkSettings: { Ports: { '80/tcp': [{ HostPort: '8080' }] } },
        Config: { Env: ['NODE_ENV=production'], Image: 'nginx' },
        HostConfig: { RestartPolicy: { Name: 'unless-stopped' } },
      };
      setupMockResponse(200, inspectData);
      const result = await client.inspectContainer('abc123');
      expect(result).toEqual(inspectData);
      const opts = getLastRequestOptions();
      expect(opts.path).toBe('/containers/abc123/json');
    });

    it('should throw on 404 (container not found)', async () => {
      setupMockResponse(404, { message: 'No such container' });
      await expect(client.inspectContainer('nonexistent')).rejects.toThrow();
    });
  });

  describe('startContainer', () => {
    it('should start a container', async () => {
      setupMockResponse(204, '');
      await client.startContainer('abc123');
      const opts = getLastRequestOptions();
      expect(opts.path).toBe('/containers/abc123/start');
      expect(opts.method).toBe('POST');
    });

    it('should not throw on 304 (already started)', async () => {
      setupMockResponse(304, '');
      await expect(client.startContainer('abc123')).resolves.toBeUndefined();
    });
  });

  describe('stopContainer', () => {
    it('should stop a container with default timeout', async () => {
      setupMockResponse(204, '');
      await client.stopContainer('abc123');
      const opts = getLastRequestOptions();
      expect(opts.path).toBe('/containers/abc123/stop?t=10');
      expect(opts.method).toBe('POST');
    });

    it('should stop with custom timeout', async () => {
      setupMockResponse(204, '');
      await client.stopContainer('abc123', 30);
      const opts = getLastRequestOptions();
      expect(opts.path).toBe('/containers/abc123/stop?t=30');
    });

    it('should not throw on 304 (already stopped)', async () => {
      setupMockResponse(304, '');
      await expect(client.stopContainer('abc123')).resolves.toBeUndefined();
    });
  });

  describe('restartContainer', () => {
    it('should restart a container', async () => {
      setupMockResponse(204, '');
      await client.restartContainer('abc123');
      const opts = getLastRequestOptions();
      expect(opts.path).toBe('/containers/abc123/restart');
      expect(opts.method).toBe('POST');
    });
  });

  describe('removeContainer', () => {
    it('should remove a container with defaults', async () => {
      setupMockResponse(204, '');
      await client.removeContainer('abc123');
      const opts = getLastRequestOptions();
      expect(opts.path).toBe('/containers/abc123');
      expect(opts.method).toBe('DELETE');
    });

    it('should remove with force and volumes', async () => {
      setupMockResponse(204, '');
      await client.removeContainer('abc123', { force: true, removeVolumes: true });
      const opts = getLastRequestOptions();
      expect(opts.path).toContain('force=true');
      expect(opts.path).toContain('v=true');
    });

    it('should throw on 404', async () => {
      setupMockResponse(404, { message: 'No such container' });
      await expect(client.removeContainer('nonexistent')).rejects.toThrow();
    });
  });

  describe('getContainerLogs', () => {
    it('should get container logs', async () => {
      setupMockResponse(200, 'log line 1\nlog line 2');
      const logs = await client.getContainerLogs('abc123');
      expect(typeof logs).toBe('string');
      const opts = getLastRequestOptions();
      expect(opts.path).toContain('/containers/abc123/logs');
      expect(opts.path).toContain('stdout=true');
      expect(opts.path).toContain('stderr=true');
    });

    it('should pass tail parameter', async () => {
      setupMockResponse(200, 'last line');
      await client.getContainerLogs('abc123', 100);
      const opts = getLastRequestOptions();
      expect(opts.path).toContain('tail=100');
    });

    it('should pass since parameter', async () => {
      setupMockResponse(200, 'recent');
      await client.getContainerLogs('abc123', undefined, '2026-01-01T00:00:00Z');
      const opts = getLastRequestOptions();
      expect(opts.path).toContain('since=');
    });
  });

  describe('imageExists', () => {
    it('should return true when image exists', async () => {
      setupMockResponse(200, { Id: 'sha256:abc' });
      const result = await client.imageExists('nginx:latest');
      expect(result).toBe(true);
      const opts = getLastRequestOptions();
      expect(opts.path).toContain('/images/');
      expect(opts.path).toContain('/json');
    });

    it('should return false when image not found', async () => {
      setupMockResponse(404, { message: 'No such image' });
      const result = await client.imageExists('nonexistent:latest');
      expect(result).toBe(false);
    });
  });

  describe('pullImage', () => {
    it('should pull an image', async () => {
      setupMockResponse(200, { status: 'Downloaded' });
      await client.pullImage('nginx', 'latest');
      const opts = getLastRequestOptions();
      expect(opts.path).toContain('/images/create');
      expect(opts.path).toContain('fromImage=nginx');
      expect(opts.path).toContain('tag=latest');
      expect(opts.method).toBe('POST');
    });

    it('should default tag to latest', async () => {
      setupMockResponse(200, { status: 'Downloaded' });
      await client.pullImage('nginx');
      const opts = getLastRequestOptions();
      expect(opts.path).toContain('tag=latest');
    });
  });

  describe('listImages', () => {
    it('should list images', async () => {
      const images = [
        { Id: 'sha256:abc', RepoTags: ['nginx:latest'], Size: 1024, Created: 1234567890 },
      ];
      setupMockResponse(200, images);
      const result = await client.listImages();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('sha256:abc');
      expect(result[0].tags).toEqual(['nginx:latest']);
      const opts = getLastRequestOptions();
      expect(opts.path).toBe('/images/json');
    });
  });

  describe('error handling', () => {
    it('should throw DockerApiError on 500', async () => {
      setupMockResponse(500, { message: 'Internal server error' });
      await expect(client.listContainers()).rejects.toThrow();
    });

    it('should throw on connection error', async () => {
      setupMockError('connect ENOENT /var/run/docker.sock');
      await expect(client.listContainers()).rejects.toThrow();
    });
  });
});
