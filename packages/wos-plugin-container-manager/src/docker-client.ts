// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import http from 'http';
import type { ContainerRunConfig, DockerContainerInfo, DockerInspectResult, ImageInfo } from './types.js';

export class DockerApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'DockerApiError';
  }
}

export interface DockerClientOptions {
  socketPath?: string;
}

export class DockerClient {
  private socketPath: string;

  constructor(options?: DockerClientOptions) {
    this.socketPath = options?.socketPath ?? this.detectSocketPath();
  }

  private detectSocketPath(): string {
    return process.platform === 'win32'
      ? '//./pipe/docker_engine'
      : '/var/run/docker.sock';
  }

  private static MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10MB

  private request(method: string, path: string, body?: any, options?: { maxBytes?: number }): Promise<{ statusCode: number; body: any }> {
    const maxBytes = options?.maxBytes ?? DockerClient.MAX_RESPONSE_BYTES;
    return new Promise((resolve, reject) => {
      const opts: http.RequestOptions = {
        socketPath: this.socketPath,
        path,
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
      };

      const req = http.request(opts, (res) => {
        let data = '';
        let bytes = 0;
        let truncated = false;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          bytes += Buffer.byteLength(chunk);
          if (!truncated) {
            data += chunk;
            if (bytes > maxBytes) truncated = true;
          }
        });
        res.on('end', () => {
          let parsed: any = truncated ? data + '\n[truncated]' : data;
          if (!truncated) {
            try { parsed = JSON.parse(data); } catch { /* raw string is fine */ }
          }
          resolve({ statusCode: res.statusCode ?? 0, body: parsed });
        });
      });

      req.on('error', reject);

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  private async apiCall(method: string, path: string, body?: any, allowedStatuses?: number[]): Promise<any> {
    const { statusCode, body: responseBody } = await this.request(method, path, body);
    const allowed = allowedStatuses ?? [200, 201, 204];
    if (!allowed.includes(statusCode)) {
      const msg = typeof responseBody === 'object' ? responseBody.message : String(responseBody);
      throw new DockerApiError(statusCode, msg ?? `Docker API error: ${statusCode}`);
    }
    return responseBody;
  }

  async ping(): Promise<boolean> {
    try {
      await this.request('GET', '/_ping');
      return true;
    } catch {
      return false;
    }
  }

  async listContainers(all?: boolean): Promise<DockerContainerInfo[]> {
    const path = all ? '/containers/json?all=true' : '/containers/json';
    return this.apiCall('GET', path);
  }

  async createContainer(config: ContainerRunConfig): Promise<{ id: string }> {
    const body = this.buildCreateBody(config);
    const path = `/containers/create?name=${encodeURIComponent(config.name)}`;
    const result = await this.apiCall('POST', path, body, [200, 201]);
    return { id: result.Id };
  }

  async inspectContainer(id: string): Promise<DockerInspectResult> {
    return this.apiCall('GET', `/containers/${encodeURIComponent(id)}/json`);
  }

  async startContainer(id: string): Promise<void> {
    await this.apiCall('POST', `/containers/${encodeURIComponent(id)}/start`, undefined, [200, 204, 304]);
  }

  async stopContainer(id: string, timeout = 10): Promise<void> {
    await this.apiCall('POST', `/containers/${encodeURIComponent(id)}/stop?t=${timeout}`, undefined, [200, 204, 304]);
  }

  async restartContainer(id: string): Promise<void> {
    await this.apiCall('POST', `/containers/${encodeURIComponent(id)}/restart`, undefined, [200, 204]);
  }

  async removeContainer(id: string, options?: { force?: boolean; removeVolumes?: boolean }): Promise<void> {
    const params = new URLSearchParams();
    if (options?.force) params.set('force', 'true');
    if (options?.removeVolumes) params.set('v', 'true');
    const qs = params.toString();
    const path = `/containers/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`;
    await this.apiCall('DELETE', path, undefined, [200, 204]);
  }

  async getContainerLogs(id: string, tail?: number, since?: string): Promise<string> {
    const params = new URLSearchParams({ stdout: 'true', stderr: 'true' });
    if (tail !== undefined) params.set('tail', String(tail));
    if (since) params.set('since', since);
    const path = `/containers/${encodeURIComponent(id)}/logs?${params.toString()}`;
    const result = await this.request('GET', path);
    if (result.statusCode >= 400) {
      throw new DockerApiError(result.statusCode, 'Failed to get logs');
    }
    return typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
  }

  async imageExists(name: string): Promise<boolean> {
    try {
      await this.apiCall('GET', `/images/${encodeURIComponent(name)}/json`);
      return true;
    } catch (err) {
      if (err instanceof DockerApiError && err.statusCode === 404) return false;
      throw err;
    }
  }

  async pullImage(name: string, tag = 'latest'): Promise<void> {
    const path = `/images/create?fromImage=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`;
    // Docker streams newline-delimited JSON progress — we only need the status code
    const result = await this.request('POST', path);
    if (result.statusCode >= 400) {
      throw new DockerApiError(result.statusCode, `Failed to pull image ${name}:${tag}`);
    }
  }

  async listImages(): Promise<ImageInfo[]> {
    const raw: any[] = await this.apiCall('GET', '/images/json');
    return raw.map((img) => ({
      id: img.Id,
      tags: img.RepoTags ?? [],
      size: img.Size,
      created: typeof img.Created === 'number'
        ? new Date(img.Created * 1000).toISOString()
        : String(img.Created),
    }));
  }

  private buildCreateBody(config: ContainerRunConfig): any {
    const exposedPorts: Record<string, object> = {};
    const portBindings: Record<string, Array<{ HostPort: string }>> = {};
    for (const p of config.ports) {
      const key = `${p.container}/tcp`;
      exposedPorts[key] = {};
      portBindings[key] = [{ HostPort: String(p.host) }];
    }

    const binds = config.volumes.map(
      (v) => `${v.source}:${v.target}`,
    );

    const env = Object.entries(config.environment).map(
      ([k, v]) => `${k}=${v}`,
    );

    return {
      Image: config.image,
      Env: env,
      Cmd: config.command,
      ExposedPorts: exposedPorts,
      HostConfig: {
        PortBindings: portBindings,
        Binds: binds,
        NetworkMode: config.network,
        RestartPolicy: { Name: config.restart },
      },
    };
  }
}
