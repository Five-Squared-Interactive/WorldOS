/**
 * Dependency Resolver Tests
 *
 * Story 4.6: Dependency Resolution
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { DependencyResolver, DependencyError } from './dependency-resolver.js';

describe('DependencyResolver', () => {
  let tempDir: string;
  let resolver: DependencyResolver;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dep-resolver-test-'));
    resolver = new DependencyResolver();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('resolve order', () => {
    it('should return empty array for no plugins', () => {
      const order = resolver.resolveOrder([]);
      expect(order).toEqual([]);
    });

    it('should return plugins with no dependencies in any order', () => {
      const plugins = [
        { name: 'plugin-a', dependencies: [] },
        { name: 'plugin-b', dependencies: [] },
      ];

      const order = resolver.resolveOrder(plugins);

      expect(order).toHaveLength(2);
      expect(order).toContain('plugin-a');
      expect(order).toContain('plugin-b');
    });

    it('should order plugins with dependencies after their dependencies', () => {
      const plugins = [
        { name: 'plugin-a', dependencies: ['plugin-b'] },
        { name: 'plugin-b', dependencies: [] },
      ];

      const order = resolver.resolveOrder(plugins);

      expect(order.indexOf('plugin-b')).toBeLessThan(order.indexOf('plugin-a'));
    });

    it('should handle deep dependency chains', () => {
      const plugins = [
        { name: 'plugin-c', dependencies: ['plugin-b'] },
        { name: 'plugin-b', dependencies: ['plugin-a'] },
        { name: 'plugin-a', dependencies: [] },
      ];

      const order = resolver.resolveOrder(plugins);

      expect(order.indexOf('plugin-a')).toBeLessThan(order.indexOf('plugin-b'));
      expect(order.indexOf('plugin-b')).toBeLessThan(order.indexOf('plugin-c'));
    });

    it('should handle multiple dependencies', () => {
      const plugins = [
        { name: 'plugin-c', dependencies: ['plugin-a', 'plugin-b'] },
        { name: 'plugin-a', dependencies: [] },
        { name: 'plugin-b', dependencies: [] },
      ];

      const order = resolver.resolveOrder(plugins);

      expect(order.indexOf('plugin-a')).toBeLessThan(order.indexOf('plugin-c'));
      expect(order.indexOf('plugin-b')).toBeLessThan(order.indexOf('plugin-c'));
    });

    it('should detect circular dependencies', () => {
      const plugins = [
        { name: 'plugin-a', dependencies: ['plugin-b'] },
        { name: 'plugin-b', dependencies: ['plugin-a'] },
      ];

      expect(() => resolver.resolveOrder(plugins)).toThrow(DependencyError);
      expect(() => resolver.resolveOrder(plugins)).toThrow(/circular/i);
    });

    it('should detect longer circular dependency chains', () => {
      const plugins = [
        { name: 'plugin-a', dependencies: ['plugin-c'] },
        { name: 'plugin-b', dependencies: ['plugin-a'] },
        { name: 'plugin-c', dependencies: ['plugin-b'] },
      ];

      expect(() => resolver.resolveOrder(plugins)).toThrow(DependencyError);
    });
  });

  describe('check dependencies', () => {
    it('should pass when all dependencies are available', () => {
      const plugin = { name: 'plugin-a', dependencies: ['plugin-b'] };
      const available = ['plugin-b', 'plugin-c'];

      const result = resolver.checkDependencies(plugin, available);

      expect(result.satisfied).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('should fail when dependencies are missing', () => {
      const plugin = { name: 'plugin-a', dependencies: ['plugin-b', 'plugin-c'] };
      const available = ['plugin-b'];

      const result = resolver.checkDependencies(plugin, available);

      expect(result.satisfied).toBe(false);
      expect(result.missing).toContain('plugin-c');
    });

    it('should pass when plugin has no dependencies', () => {
      const plugin = { name: 'plugin-a', dependencies: [] };
      const available: string[] = [];

      const result = resolver.checkDependencies(plugin, available);

      expect(result.satisfied).toBe(true);
    });

    it('should handle undefined dependencies', () => {
      const plugin = { name: 'plugin-a' };
      const available: string[] = [];

      const result = resolver.checkDependencies(plugin, available);

      expect(result.satisfied).toBe(true);
    });
  });

  describe('find dependents', () => {
    it('should find plugins that depend on a given plugin', () => {
      const plugins = [
        { name: 'plugin-a', dependencies: [] },
        { name: 'plugin-b', dependencies: ['plugin-a'] },
        { name: 'plugin-c', dependencies: ['plugin-a'] },
        { name: 'plugin-d', dependencies: [] },
      ];

      const dependents = resolver.findDependents('plugin-a', plugins);

      expect(dependents).toContain('plugin-b');
      expect(dependents).toContain('plugin-c');
      expect(dependents).not.toContain('plugin-d');
    });

    it('should return empty array when no dependents', () => {
      const plugins = [
        { name: 'plugin-a', dependencies: [] },
        { name: 'plugin-b', dependencies: [] },
      ];

      const dependents = resolver.findDependents('plugin-a', plugins);

      expect(dependents).toHaveLength(0);
    });

    it('should find transitive dependents', () => {
      const plugins = [
        { name: 'plugin-a', dependencies: [] },
        { name: 'plugin-b', dependencies: ['plugin-a'] },
        { name: 'plugin-c', dependencies: ['plugin-b'] },
      ];

      const dependents = resolver.findDependents('plugin-a', plugins, { transitive: true });

      expect(dependents).toContain('plugin-b');
      expect(dependents).toContain('plugin-c');
    });
  });

  describe('validate graph', () => {
    it('should pass for valid dependency graph', () => {
      const plugins = [
        { name: 'plugin-a', dependencies: [] },
        { name: 'plugin-b', dependencies: ['plugin-a'] },
      ];

      const result = resolver.validateGraph(plugins);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing dependencies', () => {
      const plugins = [
        { name: 'plugin-a', dependencies: ['plugin-missing'] },
      ];

      const result = resolver.validateGraph(plugins);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          plugin: 'plugin-a',
          type: 'missing',
          dependency: 'plugin-missing',
        })
      );
    });

    it('should detect circular dependencies', () => {
      const plugins = [
        { name: 'plugin-a', dependencies: ['plugin-b'] },
        { name: 'plugin-b', dependencies: ['plugin-a'] },
      ];

      const result = resolver.validateGraph(plugins);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          type: 'circular',
        })
      );
    });

    it('should detect self-dependency', () => {
      const plugins = [
        { name: 'plugin-a', dependencies: ['plugin-a'] },
      ];

      const result = resolver.validateGraph(plugins);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          plugin: 'plugin-a',
          type: 'self-dependency',
        })
      );
    });
  });

  describe('get shutdown order', () => {
    it('should return reverse of startup order', () => {
      const plugins = [
        { name: 'plugin-a', dependencies: [] },
        { name: 'plugin-b', dependencies: ['plugin-a'] },
        { name: 'plugin-c', dependencies: ['plugin-b'] },
      ];

      const startupOrder = resolver.resolveOrder(plugins);
      const shutdownOrder = resolver.getShutdownOrder(plugins);

      expect(shutdownOrder).toEqual([...startupOrder].reverse());
    });
  });
});
