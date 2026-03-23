/**
 * Dependency Resolver
 *
 * Story 4.6: Dependency Resolution
 *
 * Resolves plugin dependencies, determines startup order,
 * and validates dependency graphs.
 */

/**
 * Plugin with dependencies
 */
export interface PluginDependencies {
  name: string;
  dependencies?: string[];
}

/**
 * Dependency check result
 */
export interface DependencyCheckResult {
  satisfied: boolean;
  missing: string[];
}

/**
 * Graph validation error
 */
export interface GraphError {
  plugin: string;
  type: 'missing' | 'circular' | 'self-dependency';
  dependency?: string;
  cycle?: string[];
}

/**
 * Graph validation result
 */
export interface GraphValidationResult {
  valid: boolean;
  errors: GraphError[];
}

/**
 * Options for finding dependents
 */
export interface FindDependentsOptions {
  /** Include transitive dependents */
  transitive?: boolean;
}

/**
 * Custom error for dependency issues
 */
export class DependencyError extends Error {
  constructor(message: string, public cycle?: string[]) {
    super(message);
    this.name = 'DependencyError';
  }
}

/**
 * Resolves plugin dependencies using topological sort
 */
export class DependencyResolver {
  /**
   * Resolve startup order for plugins (topological sort)
   *
   * Plugins with no dependencies come first, followed by plugins
   * whose dependencies have already been resolved.
   *
   * @throws DependencyError if circular dependency detected
   */
  resolveOrder(plugins: PluginDependencies[]): string[] {
    if (plugins.length === 0) {
      return [];
    }

    // Build adjacency list and in-degree count
    const graph = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    const pluginSet = new Set<string>();

    // Initialize
    for (const plugin of plugins) {
      pluginSet.add(plugin.name);
      graph.set(plugin.name, []);
      inDegree.set(plugin.name, 0);
    }

    // Build edges (dependency -> dependent)
    for (const plugin of plugins) {
      const deps = plugin.dependencies ?? [];
      for (const dep of deps) {
        // Only count dependencies that are in our plugin set
        if (pluginSet.has(dep)) {
          graph.get(dep)!.push(plugin.name);
          inDegree.set(plugin.name, (inDegree.get(plugin.name) ?? 0) + 1);
        }
      }
    }

    // Kahn's algorithm for topological sort
    const queue: string[] = [];
    const result: string[] = [];

    // Start with nodes that have no incoming edges
    for (const [name, degree] of inDegree) {
      if (degree === 0) {
        queue.push(name);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      // Process all dependents
      for (const dependent of graph.get(current) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, newDegree);

        if (newDegree === 0) {
          queue.push(dependent);
        }
      }
    }

    // If we didn't process all nodes, there's a cycle
    if (result.length !== plugins.length) {
      const remaining = plugins
        .filter(p => !result.includes(p.name))
        .map(p => p.name);
      throw new DependencyError(
        `Circular dependency detected involving: ${remaining.join(', ')}`,
        remaining
      );
    }

    return result;
  }

  /**
   * Get shutdown order (reverse of startup order)
   */
  getShutdownOrder(plugins: PluginDependencies[]): string[] {
    return this.resolveOrder(plugins).reverse();
  }

  /**
   * Check if a plugin's dependencies are satisfied
   */
  checkDependencies(
    plugin: PluginDependencies,
    availablePlugins: string[]
  ): DependencyCheckResult {
    const deps = plugin.dependencies ?? [];
    const missing: string[] = [];

    for (const dep of deps) {
      if (!availablePlugins.includes(dep)) {
        missing.push(dep);
      }
    }

    return {
      satisfied: missing.length === 0,
      missing,
    };
  }

  /**
   * Find plugins that depend on a given plugin
   */
  findDependents(
    pluginName: string,
    plugins: PluginDependencies[],
    options?: FindDependentsOptions
  ): string[] {
    const directDependents: string[] = [];

    for (const plugin of plugins) {
      if (plugin.dependencies?.includes(pluginName)) {
        directDependents.push(plugin.name);
      }
    }

    if (!options?.transitive) {
      return directDependents;
    }

    // Find transitive dependents (BFS)
    const allDependents = new Set<string>(directDependents);
    const queue = [...directDependents];

    while (queue.length > 0) {
      const current = queue.shift()!;

      for (const plugin of plugins) {
        if (plugin.dependencies?.includes(current) && !allDependents.has(plugin.name)) {
          allDependents.add(plugin.name);
          queue.push(plugin.name);
        }
      }
    }

    return Array.from(allDependents);
  }

  /**
   * Validate entire dependency graph
   */
  validateGraph(plugins: PluginDependencies[]): GraphValidationResult {
    const errors: GraphError[] = [];
    const pluginSet = new Set(plugins.map(p => p.name));

    // Check for self-dependencies and missing dependencies
    for (const plugin of plugins) {
      const deps = plugin.dependencies ?? [];

      for (const dep of deps) {
        if (dep === plugin.name) {
          errors.push({
            plugin: plugin.name,
            type: 'self-dependency',
          });
        } else if (!pluginSet.has(dep)) {
          errors.push({
            plugin: plugin.name,
            type: 'missing',
            dependency: dep,
          });
        }
      }
    }

    // Check for circular dependencies
    try {
      this.resolveOrder(plugins);
    } catch (e) {
      if (e instanceof DependencyError && e.cycle) {
        errors.push({
          plugin: e.cycle[0],
          type: 'circular',
          cycle: e.cycle,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
