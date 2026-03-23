/**
 * Plugin Registry
 *
 * Story 4.8: Plugin Registry (State)
 *
 * Manages plugin state in wos.yaml. Tracks installed plugins,
 * their enabled/disabled state, and source information.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';

/**
 * Local plugin source
 */
export interface LocalSource {
  type: 'local';
  path: string;
}

/**
 * GitHub plugin source
 */
export interface GitHubSource {
  type: 'github';
  repo: string;
  ref?: string;
}

/**
 * Git URL plugin source
 */
export interface GitSource {
  type: 'git';
  url: string;
  ref?: string;
}

/**
 * Plugin source union type
 */
export type PluginSource = LocalSource | GitHubSource | GitSource;

/**
 * Plugin registry entry
 */
export interface PluginEntry {
  name: string;
  version: string;
  enabled: boolean;
  source: PluginSource;
  installedAt: string;
  description?: string;
}

/**
 * Options for register operation
 */
export interface RegisterOptions {
  force?: boolean;
}

/**
 * Plugin Registry - manages installed plugins in wos.yaml
 */
export class PluginRegistry {
  private serverDir: string;
  private configPath: string;
  private pluginsDir: string;
  private plugins: Map<string, PluginEntry> = new Map();
  private config: Record<string, unknown> = {};

  constructor(serverDir: string) {
    this.serverDir = serverDir;
    this.configPath = path.join(serverDir, 'wos.yaml');
    this.pluginsDir = path.join(serverDir, 'plugins');
  }

  /**
   * Load registry from wos.yaml
   */
  async load(): Promise<void> {
    // Ensure plugins directory exists
    await fs.mkdir(this.pluginsDir, { recursive: true });

    // Load config
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      this.config = yaml.parse(content) ?? {};
    } catch {
      this.config = {};
    }

    // Parse plugins section
    this.plugins.clear();
    const pluginsSection = this.config.plugins as Record<string, unknown> | undefined;

    if (pluginsSection && typeof pluginsSection === 'object') {
      for (const [name, data] of Object.entries(pluginsSection)) {
        if (data && typeof data === 'object') {
          const entry = this.parsePluginEntry(name, data as Record<string, unknown>);
          if (entry) {
            this.plugins.set(name, entry);
          }
        }
      }
    }
  }

  /**
   * Parse a plugin entry from config
   */
  private parsePluginEntry(name: string, data: Record<string, unknown>): PluginEntry | null {
    const source = this.parseSource(data.source as string | Record<string, unknown>)
      ?? { type: 'local' as const, path: `./plugins/${name}` };

    return {
      name,
      version: (data.version as string) ?? '0.0.0',
      enabled: Boolean(data.enabled),
      source,
      installedAt: (data.installedAt as string) ?? new Date().toISOString(),
      description: data.description as string | undefined,
    };
  }

  /**
   * Parse source from config value
   */
  private parseSource(value: string | Record<string, unknown> | undefined): PluginSource | null {
    if (!value) return null;

    if (typeof value === 'string') {
      // Parse string format: "github:user/repo#ref" or "./path"
      if (value.startsWith('github:')) {
        const rest = value.slice(7);
        const [repo, ref] = rest.split('#');
        return { type: 'github', repo, ref };
      } else if (value.startsWith('git:')) {
        const rest = value.slice(4);
        const [url, ref] = rest.split('#');
        return { type: 'git', url, ref };
      } else {
        return { type: 'local', path: value };
      }
    }

    // Parse object format
    if (value.type === 'local') {
      return { type: 'local', path: value.path as string };
    } else if (value.type === 'github') {
      return { type: 'github', repo: value.repo as string, ref: value.ref as string | undefined };
    } else if (value.type === 'git') {
      return { type: 'git', url: value.url as string, ref: value.ref as string | undefined };
    }

    return null;
  }

  /**
   * Serialize source for config
   */
  private serializeSource(source: PluginSource): string {
    switch (source.type) {
      case 'local':
        return source.path;
      case 'github':
        return source.ref ? `github:${source.repo}#${source.ref}` : `github:${source.repo}`;
      case 'git':
        return source.ref ? `git:${source.url}#${source.ref}` : `git:${source.url}`;
    }
  }

  /**
   * Save registry to wos.yaml
   */
  private async save(): Promise<void> {
    // Build plugins section
    const pluginsSection: Record<string, unknown> = {};

    for (const entry of this.plugins.values()) {
      pluginsSection[entry.name] = {
        enabled: entry.enabled,
        version: entry.version,
        source: this.serializeSource(entry.source),
        installedAt: entry.installedAt,
        ...(entry.description && { description: entry.description }),
      };
    }

    // Update config
    this.config.plugins = pluginsSection;

    // Write to file
    const content = yaml.stringify(this.config);
    await fs.writeFile(this.configPath, content, 'utf-8');
  }

  /**
   * Register a plugin
   */
  async register(entry: PluginEntry, options?: RegisterOptions): Promise<void> {
    if (this.plugins.has(entry.name) && !options?.force) {
      throw new Error(`Plugin '${entry.name}' is already registered`);
    }

    this.plugins.set(entry.name, entry);
    await this.save();
  }

  /**
   * Unregister a plugin
   */
  async unregister(name: string): Promise<void> {
    if (!this.plugins.has(name)) {
      throw new Error(`Plugin '${name}' not found`);
    }

    this.plugins.delete(name);
    await this.save();
  }

  /**
   * Enable a plugin
   */
  async enable(name: string): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) {
      throw new Error(`Plugin '${name}' not found`);
    }

    entry.enabled = true;
    await this.save();
  }

  /**
   * Disable a plugin
   */
  async disable(name: string): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) {
      throw new Error(`Plugin '${name}' not found`);
    }

    entry.enabled = false;
    await this.save();
  }

  /**
   * Get a plugin entry
   */
  get(name: string): PluginEntry | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get all plugin entries
   */
  getAll(): PluginEntry[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get enabled plugins only
   */
  getEnabled(): PluginEntry[] {
    return this.getAll().filter(p => p.enabled);
  }

  /**
   * Check if a plugin is registered
   */
  has(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * Check if a plugin is enabled
   */
  isEnabled(name: string): boolean {
    return this.plugins.get(name)?.enabled ?? false;
  }

  /**
   * Get the plugins directory path
   */
  getPluginsDir(): string {
    return this.pluginsDir;
  }

  /**
   * Get the server directory path
   */
  getServerDir(): string {
    return this.serverDir;
  }
}
