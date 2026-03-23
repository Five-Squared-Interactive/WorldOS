/**
 * Panel Loader
 *
 * Story 7.7: Admin Panel Loader
 *
 * Dynamically loads and manages plugin UI panels.
 */

import { EventEmitter } from 'events';

/**
 * Panel context provided to mounted panels
 */
export interface PanelContext {
  mqtt: {
    subscribe: (topic: string, callback: (payload: unknown) => void) => void;
    unsubscribe: (topic: string) => void;
    publish: (topic: string, payload: unknown) => void;
  };
  api: {
    get: (url: string) => Promise<unknown>;
    post: (url: string, data: unknown) => Promise<unknown>;
    put: (url: string, data: unknown) => Promise<unknown>;
    delete: (url: string) => Promise<unknown>;
  };
  config: Record<string, unknown>;
}

/**
 * Panel module interface
 */
export interface PanelModule {
  mount: (container: HTMLElement, context: PanelContext) => void | Promise<void>;
  unmount?: () => void | Promise<void>;
}

/**
 * Panel registration info
 */
export interface PanelInfo {
  name: string;
  displayName: string;
  entryPoint: string;
  icon?: string;
  route?: string;
}

/**
 * Panel loader options
 */
export interface PanelLoaderOptions {
  context: PanelContext;
}

/**
 * Module loader function type
 */
type ModuleLoader = (url: string) => Promise<PanelModule>;

/**
 * Panel Loader - dynamically loads and manages plugin UI panels
 */
export class PanelLoader extends EventEmitter {
  private context: PanelContext;
  private panels: Map<string, PanelInfo> = new Map();
  private loadedModules: Map<string, PanelModule> = new Map();
  private currentPanel: string | null = null;
  private currentModule: PanelModule | null = null;
  private moduleLoader: ModuleLoader;

  constructor(options: PanelLoaderOptions) {
    super();
    this.context = options.context;

    // Default module loader uses dynamic import
    this.moduleLoader = async (url: string) => {
      return await import(/* @vite-ignore */ url);
    };
  }

  /**
   * Set custom module loader (useful for testing)
   */
  setModuleLoader(loader: ModuleLoader): void {
    this.moduleLoader = loader;
  }

  /**
   * Register a panel
   */
  registerPanel(info: PanelInfo): void {
    // Generate default route if not provided
    const panelInfo: PanelInfo = {
      ...info,
      route: info.route ?? `/plugins/${info.name}`,
    };

    this.panels.set(info.name, panelInfo);
  }

  /**
   * Unregister a panel
   */
  unregisterPanel(name: string): void {
    this.panels.delete(name);
    this.loadedModules.delete(name);
  }

  /**
   * Get all registered panels
   */
  getPanels(): PanelInfo[] {
    return Array.from(this.panels.values());
  }

  /**
   * Get currently mounted panel name
   */
  getCurrentPanel(): string | null {
    return this.currentPanel;
  }

  /**
   * Load a panel module
   */
  async loadPanel(name: string): Promise<PanelModule> {
    const info = this.panels.get(name);
    if (!info) {
      throw new Error(`Panel not found: ${name}`);
    }

    // Return cached module if available
    const cached = this.loadedModules.get(name);
    if (cached) {
      return cached;
    }

    try {
      const module = await this.moduleLoader(info.entryPoint);
      this.loadedModules.set(name, module);
      return module;
    } catch (error) {
      this.emit('error', { panel: name, error: error as Error });
      throw error;
    }
  }

  /**
   * Mount a panel into a container
   */
  async mountPanel(name: string, container: HTMLElement): Promise<void> {
    // Unmount current panel if any
    if (this.currentPanel) {
      await this.unmountCurrentPanel();
    }

    const module = await this.loadPanel(name);

    try {
      await module.mount(container, this.context);
      this.currentPanel = name;
      this.currentModule = module;
      this.emit('mounted', { panel: name });
    } catch (error) {
      this.emit('error', { panel: name, error: error as Error });
      throw error;
    }
  }

  /**
   * Unmount the current panel
   */
  async unmountCurrentPanel(): Promise<void> {
    if (!this.currentModule || !this.currentPanel) {
      return;
    }

    try {
      if (this.currentModule.unmount) {
        await this.currentModule.unmount();
      }
      this.emit('unmounted', { panel: this.currentPanel });
    } catch (error) {
      this.emit('error', { panel: this.currentPanel, error: error as Error });
    } finally {
      this.currentPanel = null;
      this.currentModule = null;
    }
  }
}
