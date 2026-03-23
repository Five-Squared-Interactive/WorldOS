/**
 * Panel Loader Tests
 *
 * Story 7.7: Admin Panel Loader
 *
 * Tests for dynamically loading plugin UI panels.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PanelLoader,
  PanelLoaderOptions,
  PanelContext,
  PanelModule,
  PanelInfo,
} from './panel-loader.js';

describe('PanelLoader', () => {
  let loader: PanelLoader;
  let mockContext: PanelContext;

  beforeEach(() => {
    mockContext = {
      mqtt: {
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        publish: vi.fn(),
      },
      api: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
      },
      config: {},
    };

    loader = new PanelLoader({ context: mockContext });
  });

  describe('initialization', () => {
    it('should create panel loader with context', () => {
      expect(loader).toBeDefined();
    });
  });

  describe('panel registration', () => {
    it('should register a panel', () => {
      loader.registerPanel({
        name: 'my-plugin',
        displayName: 'My Plugin',
        entryPoint: '/plugins/my-plugin/admin.js',
      });

      const panels = loader.getPanels();
      expect(panels).toHaveLength(1);
      expect(panels[0].name).toBe('my-plugin');
    });

    it('should register multiple panels', () => {
      loader.registerPanel({
        name: 'plugin-a',
        displayName: 'Plugin A',
        entryPoint: '/plugins/plugin-a/admin.js',
      });

      loader.registerPanel({
        name: 'plugin-b',
        displayName: 'Plugin B',
        entryPoint: '/plugins/plugin-b/admin.js',
      });

      const panels = loader.getPanels();
      expect(panels).toHaveLength(2);
    });

    it('should not register duplicate panels', () => {
      loader.registerPanel({
        name: 'my-plugin',
        displayName: 'My Plugin',
        entryPoint: '/plugins/my-plugin/admin.js',
      });

      loader.registerPanel({
        name: 'my-plugin',
        displayName: 'Updated Name',
        entryPoint: '/plugins/my-plugin/v2/admin.js',
      });

      const panels = loader.getPanels();
      expect(panels).toHaveLength(1);
      // Should use the latest registration
      expect(panels[0].displayName).toBe('Updated Name');
    });

    it('should unregister a panel', () => {
      loader.registerPanel({
        name: 'my-plugin',
        displayName: 'My Plugin',
        entryPoint: '/plugins/my-plugin/admin.js',
      });

      loader.unregisterPanel('my-plugin');

      expect(loader.getPanels()).toHaveLength(0);
    });
  });

  describe('panel loading', () => {
    it('should load a panel module', async () => {
      const mockModule: PanelModule = {
        mount: vi.fn(),
        unmount: vi.fn(),
      };

      // Mock the dynamic import
      loader.setModuleLoader(async () => mockModule);

      loader.registerPanel({
        name: 'my-plugin',
        displayName: 'My Plugin',
        entryPoint: '/plugins/my-plugin/admin.js',
      });

      const module = await loader.loadPanel('my-plugin');
      expect(module).toBe(mockModule);
    });

    it('should throw for unknown panel', async () => {
      await expect(loader.loadPanel('unknown')).rejects.toThrow('Panel not found');
    });

    it('should cache loaded modules', async () => {
      const mockModule: PanelModule = {
        mount: vi.fn(),
        unmount: vi.fn(),
      };

      let loadCount = 0;
      loader.setModuleLoader(async () => {
        loadCount++;
        return mockModule;
      });

      loader.registerPanel({
        name: 'my-plugin',
        displayName: 'My Plugin',
        entryPoint: '/plugins/my-plugin/admin.js',
      });

      await loader.loadPanel('my-plugin');
      await loader.loadPanel('my-plugin');

      expect(loadCount).toBe(1);
    });

    it('should clear cache on unregister', async () => {
      const mockModule: PanelModule = {
        mount: vi.fn(),
        unmount: vi.fn(),
      };

      let loadCount = 0;
      loader.setModuleLoader(async () => {
        loadCount++;
        return mockModule;
      });

      loader.registerPanel({
        name: 'my-plugin',
        displayName: 'My Plugin',
        entryPoint: '/plugins/my-plugin/admin.js',
      });

      await loader.loadPanel('my-plugin');
      loader.unregisterPanel('my-plugin');

      loader.registerPanel({
        name: 'my-plugin',
        displayName: 'My Plugin',
        entryPoint: '/plugins/my-plugin/admin.js',
      });

      await loader.loadPanel('my-plugin');

      expect(loadCount).toBe(2);
    });
  });

  describe('panel mounting', () => {
    it('should mount a panel with container and context', async () => {
      const mockMount = vi.fn();
      const mockModule: PanelModule = {
        mount: mockMount,
        unmount: vi.fn(),
      };

      loader.setModuleLoader(async () => mockModule);

      loader.registerPanel({
        name: 'my-plugin',
        displayName: 'My Plugin',
        entryPoint: '/plugins/my-plugin/admin.js',
      });

      const container = { id: 'test-container' } as any;
      await loader.mountPanel('my-plugin', container);

      expect(mockMount).toHaveBeenCalledWith(container, mockContext);
    });

    it('should track mounted panel', async () => {
      const mockModule: PanelModule = {
        mount: vi.fn(),
        unmount: vi.fn(),
      };

      loader.setModuleLoader(async () => mockModule);

      loader.registerPanel({
        name: 'my-plugin',
        displayName: 'My Plugin',
        entryPoint: '/plugins/my-plugin/admin.js',
      });

      const container = {} as any;
      await loader.mountPanel('my-plugin', container);

      expect(loader.getCurrentPanel()).toBe('my-plugin');
    });
  });

  describe('panel unmounting', () => {
    it('should unmount current panel', async () => {
      const mockUnmount = vi.fn();
      const mockModule: PanelModule = {
        mount: vi.fn(),
        unmount: mockUnmount,
      };

      loader.setModuleLoader(async () => mockModule);

      loader.registerPanel({
        name: 'my-plugin',
        displayName: 'My Plugin',
        entryPoint: '/plugins/my-plugin/admin.js',
      });

      const container = {} as any;
      await loader.mountPanel('my-plugin', container);
      await loader.unmountCurrentPanel();

      expect(mockUnmount).toHaveBeenCalled();
      expect(loader.getCurrentPanel()).toBeNull();
    });

    it('should unmount previous panel when mounting new one', async () => {
      const mockUnmount1 = vi.fn();
      const mockUnmount2 = vi.fn();

      const modules: Record<string, PanelModule> = {
        '/plugins/plugin-a/admin.js': { mount: vi.fn(), unmount: mockUnmount1 },
        '/plugins/plugin-b/admin.js': { mount: vi.fn(), unmount: mockUnmount2 },
      };

      loader.setModuleLoader(async (url: string) => modules[url]);

      loader.registerPanel({
        name: 'plugin-a',
        displayName: 'Plugin A',
        entryPoint: '/plugins/plugin-a/admin.js',
      });

      loader.registerPanel({
        name: 'plugin-b',
        displayName: 'Plugin B',
        entryPoint: '/plugins/plugin-b/admin.js',
      });

      const container = {} as any;
      await loader.mountPanel('plugin-a', container);
      await loader.mountPanel('plugin-b', container);

      expect(mockUnmount1).toHaveBeenCalled();
      expect(loader.getCurrentPanel()).toBe('plugin-b');
    });

    it('should handle missing unmount function gracefully', async () => {
      const mockModule: PanelModule = {
        mount: vi.fn(),
        // No unmount function
      };

      loader.setModuleLoader(async () => mockModule);

      loader.registerPanel({
        name: 'my-plugin',
        displayName: 'My Plugin',
        entryPoint: '/plugins/my-plugin/admin.js',
      });

      const container = {} as any;
      await loader.mountPanel('my-plugin', container);

      // Should not throw
      await expect(loader.unmountCurrentPanel()).resolves.toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should emit error on load failure', async () => {
      const errorHandler = vi.fn();
      loader.on('error', errorHandler);

      loader.setModuleLoader(async () => {
        throw new Error('Module not found');
      });

      loader.registerPanel({
        name: 'broken-plugin',
        displayName: 'Broken Plugin',
        entryPoint: '/plugins/broken/admin.js',
      });

      await expect(loader.loadPanel('broken-plugin')).rejects.toThrow();
      expect(errorHandler).toHaveBeenCalled();
    });

    it('should emit error on mount failure', async () => {
      const errorHandler = vi.fn();
      loader.on('error', errorHandler);

      const mockModule: PanelModule = {
        mount: () => {
          throw new Error('Mount failed');
        },
        unmount: vi.fn(),
      };

      loader.setModuleLoader(async () => mockModule);

      loader.registerPanel({
        name: 'my-plugin',
        displayName: 'My Plugin',
        entryPoint: '/plugins/my-plugin/admin.js',
      });

      await expect(loader.mountPanel('my-plugin', {} as any)).rejects.toThrow();
      expect(errorHandler).toHaveBeenCalled();
    });

    it('should provide error details in event', async () => {
      let emittedError: { panel: string; error: Error } | null = null;
      loader.on('error', (err) => {
        emittedError = err;
      });

      loader.setModuleLoader(async () => {
        throw new Error('Custom error');
      });

      loader.registerPanel({
        name: 'my-plugin',
        displayName: 'My Plugin',
        entryPoint: '/plugins/my-plugin/admin.js',
      });

      try {
        await loader.loadPanel('my-plugin');
      } catch {
        // Expected
      }

      expect(emittedError).toBeDefined();
      expect(emittedError!.panel).toBe('my-plugin');
      expect(emittedError!.error.message).toBe('Custom error');
    });
  });

  describe('panel info', () => {
    it('should include icon in panel info', () => {
      loader.registerPanel({
        name: 'my-plugin',
        displayName: 'My Plugin',
        entryPoint: '/plugins/my-plugin/admin.js',
        icon: 'plugin-icon.svg',
      });

      const panels = loader.getPanels();
      expect(panels[0].icon).toBe('plugin-icon.svg');
    });

    it('should include route in panel info', () => {
      loader.registerPanel({
        name: 'my-plugin',
        displayName: 'My Plugin',
        entryPoint: '/plugins/my-plugin/admin.js',
        route: '/plugins/my-plugin',
      });

      const panels = loader.getPanels();
      expect(panels[0].route).toBe('/plugins/my-plugin');
    });

    it('should generate default route if not provided', () => {
      loader.registerPanel({
        name: 'my-plugin',
        displayName: 'My Plugin',
        entryPoint: '/plugins/my-plugin/admin.js',
      });

      const panels = loader.getPanels();
      expect(panels[0].route).toBe('/plugins/my-plugin');
    });
  });
});
