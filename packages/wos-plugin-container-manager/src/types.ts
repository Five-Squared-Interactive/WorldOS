// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

/**
 * Container Manager Plugin - Shared Types
 */

// ── Service Configuration ───────────────────────────────────────────

export interface ServiceConfig {
  id: string;
  name: string;
  image: string;
  ports?: PortConfig[];
  volumes?: VolumeConfig[];
  environment?: Record<string, string>;
  network?: string;
  restart?: RestartPolicy;
  command?: string[];
  instances: InstanceConfig[];
}

export interface InstanceConfig {
  instanceId: string;
  containerName?: string;
  image?: string;
  environment?: Record<string, string>;
  volumes?: VolumeConfig[];
  ports?: PortConfig[];
  restart?: RestartPolicy;
  command?: string[];
}

export interface PortConfig {
  container: number;
  host?: number | 'dynamic';
}

export interface VolumeConfig {
  source: string;
  target: string;
  type?: 'bind' | 'volume';
}

export type RestartPolicy = 'no' | 'always' | 'unless-stopped' | 'on-failure';

export interface DefaultsConfig {
  network: string;
  volumeBasePath: string;
  portRangeStart: number;
  portRangeEnd: number;
}

export interface ContainerConfig {
  defaults: DefaultsConfig;
  services: ServiceConfig[];
}

// ── Merged & Resolved Config ────────────────────────────────────────

export interface MergedConfig {
  name: string;
  image: string;
  ports: PortConfig[];
  volumes: Array<{ source: string; target: string; type: string }>;
  environment: Record<string, string>;
  network: string;
  restart: RestartPolicy;
  command?: string[];
}

export interface ContainerRunConfig {
  name: string;
  image: string;
  ports: Array<{ container: number; host: number }>;
  volumes: Array<{ source: string; target: string; type: string }>;
  environment: Record<string, string>;
  network: string;
  restart: RestartPolicy;
  command?: string[];
}

// ── Operation Results ───────────────────────────────────────────────

export interface InstanceResult {
  serviceId: string;
  instanceId: string;
  containerName: string;
  containerId?: string;
  status: string;
  ports?: Record<string, number>;
  error?: string;
}

export interface InstanceStatus {
  serviceId: string;
  instanceId: string;
  containerName: string;
  exists: boolean;
  running: boolean;
  status: string;
  state?: Record<string, unknown>;
  ports?: Record<string, number>;
}

export interface ScaleResult {
  serviceId: string;
  targetCount: number;
  instances: Array<{
    instanceId: string;
    action: 'created' | 'removed' | 'unchanged';
    status: string;
    ports?: Record<string, number>;
  }>;
}

export interface ImageInfo {
  id: string;
  tags: string[];
  size: number;
  created: string;
}

export interface ImageCheckResult {
  image: string;
  exists: boolean;
}

export interface ImagePullResult {
  image: string;
  status: string;
  error?: string;
}

export interface ServiceInfo {
  id: string;
  name: string;
  image: string;
  instanceCount: number;
  runningCount: number;
  instances: InstanceStatus[];
}

// ── Docker API Response Types ───────────────────────────────────────

export interface DockerContainerInfo {
  Id: string;
  Names: string[];
  State: string;
  Status: string;
  Ports: Array<{ PrivatePort: number; PublicPort?: number; Type: string }>;
  Image: string;
}

export interface DockerInspectResult {
  Id: string;
  Name: string;
  State: { Status: string; Running: boolean; Pid: number; ExitCode: number };
  NetworkSettings: { Ports: Record<string, Array<{ HostPort: string }> | null> };
  Config: { Env: string[]; Image: string };
  HostConfig: { RestartPolicy: { Name: string } };
}
