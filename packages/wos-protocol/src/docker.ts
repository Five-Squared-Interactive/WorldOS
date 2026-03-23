/**
 * Docker Plugin Support
 *
 * Story 10.5: Docker Plugin Support
 *
 * Docker container lifecycle management for plugins.
 */

/**
 * Docker runtime configuration
 */
export interface DockerRuntimeConfig {
  /** Container image (e.g., "my-plugin:latest") */
  image: string;
  /** Path to Dockerfile to build (alternative to image) */
  build?: string;
  /** Memory limit (e.g., "512m", "1g") */
  memory?: string;
  /** CPU limit (e.g., "0.5", "2") */
  cpus?: string;
  /** Network mode (default: "host") */
  network?: string;
  /** Volume mounts */
  volumes?: string[];
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Container name prefix */
  namePrefix?: string;
  /** Restart policy */
  restartPolicy?: 'no' | 'on-failure' | 'always' | 'unless-stopped';
}

/**
 * Docker command result
 */
export interface DockerCommand {
  args: string[];
  env?: Record<string, string>;
}

/**
 * Docker container status
 */
export interface ContainerStatus {
  id: string;
  name: string;
  status: 'created' | 'running' | 'paused' | 'restarting' | 'exited' | 'dead';
  health?: 'healthy' | 'unhealthy' | 'starting';
  exitCode?: number;
}

/**
 * Build docker run command
 */
export function buildDockerRunCommand(
  pluginName: string,
  config: DockerRuntimeConfig,
  mqttEnv: Record<string, string>
): DockerCommand {
  const args: string[] = ['run', '--rm'];

  // Container name
  const containerName = config.namePrefix
    ? `${config.namePrefix}-${pluginName}`
    : `wos-plugin-${pluginName}`;
  args.push('--name', containerName);

  // Network mode
  args.push('--network', config.network ?? 'host');

  // Resource limits
  if (config.memory) {
    args.push('--memory', config.memory);
  }
  if (config.cpus) {
    args.push('--cpus', config.cpus);
  }

  // Restart policy
  if (config.restartPolicy && config.restartPolicy !== 'no') {
    args.push('--restart', config.restartPolicy);
  }

  // Environment variables - MQTT connection info
  for (const [key, value] of Object.entries(mqttEnv)) {
    args.push('-e', `${key}=${value}`);
  }

  // Additional environment variables from config
  if (config.env) {
    for (const [key, value] of Object.entries(config.env)) {
      args.push('-e', `${key}=${value}`);
    }
  }

  // Volume mounts
  if (config.volumes) {
    for (const volume of config.volumes) {
      args.push('-v', volume);
    }
  }

  // Image
  args.push(config.image);

  return { args };
}

/**
 * Build docker stop command
 */
export function buildDockerStopCommand(
  pluginName: string,
  timeoutSeconds: number = 10,
  namePrefix?: string
): DockerCommand {
  const containerName = namePrefix
    ? `${namePrefix}-${pluginName}`
    : `wos-plugin-${pluginName}`;

  return {
    args: ['stop', '-t', String(timeoutSeconds), containerName],
  };
}

/**
 * Build docker rm command
 */
export function buildDockerRemoveCommand(
  pluginName: string,
  force: boolean = false,
  namePrefix?: string
): DockerCommand {
  const containerName = namePrefix
    ? `${namePrefix}-${pluginName}`
    : `wos-plugin-${pluginName}`;

  const args = ['rm'];
  if (force) {
    args.push('-f');
  }
  args.push(containerName);

  return { args };
}

/**
 * Build docker build command
 */
export function buildDockerBuildCommand(
  pluginName: string,
  dockerfilePath: string,
  tag?: string
): DockerCommand {
  const imageTag = tag ?? `wos-plugin-${pluginName}:latest`;

  return {
    args: ['build', '-t', imageTag, '-f', dockerfilePath, '.'],
  };
}

/**
 * Build docker inspect command for status
 */
export function buildDockerInspectCommand(
  pluginName: string,
  namePrefix?: string
): DockerCommand {
  const containerName = namePrefix
    ? `${namePrefix}-${pluginName}`
    : `wos-plugin-${pluginName}`;

  return {
    args: [
      'inspect',
      '--format',
      '{{json .State}}',
      containerName,
    ],
  };
}

/**
 * Parse docker inspect output to container status
 */
export function parseContainerStatus(
  pluginName: string,
  inspectOutput: string,
  namePrefix?: string
): ContainerStatus {
  const containerName = namePrefix
    ? `${namePrefix}-${pluginName}`
    : `wos-plugin-${pluginName}`;

  try {
    const state = JSON.parse(inspectOutput);

    return {
      id: state.Id ?? '',
      name: containerName,
      status: mapDockerStatus(state.Status),
      health: state.Health?.Status,
      exitCode: state.ExitCode,
    };
  } catch {
    return {
      id: '',
      name: containerName,
      status: 'exited',
    };
  }
}

/**
 * Map Docker status string to our status type
 */
function mapDockerStatus(
  status: string
): ContainerStatus['status'] {
  const lower = status?.toLowerCase() ?? '';
  if (lower === 'created') return 'created';
  if (lower === 'running') return 'running';
  if (lower === 'paused') return 'paused';
  if (lower === 'restarting') return 'restarting';
  if (lower === 'dead') return 'dead';
  return 'exited';
}

/**
 * Validate Docker runtime configuration
 */
export function validateDockerConfig(config: DockerRuntimeConfig): string[] {
  const errors: string[] = [];

  if (!config.image && !config.build) {
    errors.push('Either image or build must be specified');
  }

  if (config.image && config.build) {
    errors.push('Cannot specify both image and build');
  }

  if (config.memory && !isValidMemoryLimit(config.memory)) {
    errors.push(`Invalid memory limit: ${config.memory}. Use format like "512m" or "1g"`);
  }

  if (config.cpus && !isValidCpuLimit(config.cpus)) {
    errors.push(`Invalid CPU limit: ${config.cpus}. Use format like "0.5" or "2"`);
  }

  if (config.volumes) {
    for (const volume of config.volumes) {
      if (!isValidVolumeMount(volume)) {
        errors.push(`Invalid volume mount: ${volume}. Use format "host:container" or "name:container"`);
      }
    }
  }

  return errors;
}

/**
 * Check if memory limit format is valid
 */
function isValidMemoryLimit(limit: string): boolean {
  return /^\d+[bkmg]?$/i.test(limit);
}

/**
 * Check if CPU limit format is valid
 */
function isValidCpuLimit(limit: string): boolean {
  const num = parseFloat(limit);
  return !isNaN(num) && num > 0;
}

/**
 * Check if volume mount format is valid
 */
function isValidVolumeMount(mount: string): boolean {
  // Basic check: should have at least one colon separating host:container
  return mount.includes(':') && mount.split(':').length >= 2;
}

/**
 * Get container name for a plugin
 */
export function getContainerName(pluginName: string, namePrefix?: string): string {
  return namePrefix
    ? `${namePrefix}-${pluginName}`
    : `wos-plugin-${pluginName}`;
}
