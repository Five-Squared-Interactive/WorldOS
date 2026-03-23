/**
 * Startup Apps Tests
 *
 * Story 3.7: Startup Apps Support
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StartupAppManager, StartupAppConfig, StartupApp } from './startup-apps.js';

describe('StartupAppManager', () => {
  let manager: StartupAppManager;

  beforeEach(() => {
    manager = new StartupAppManager();
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  describe('configuration parsing', () => {
    it('should accept valid startup app config', () => {
      const config: StartupAppConfig = {
        name: 'world-manager',
        command: 'node',
        args: ['./apps/world-manager/dist/wosapp.js'],
      };

      expect(() => manager.register(config)).not.toThrow();
    });

    it('should require name field', () => {
      const config = {
        command: 'node',
        args: ['./app.js'],
      } as StartupAppConfig;

      expect(() => manager.register(config)).toThrow(/name/i);
    });

    it('should require command field', () => {
      const config = {
        name: 'test-app',
        args: ['./app.js'],
      } as StartupAppConfig;

      expect(() => manager.register(config)).toThrow(/command/i);
    });

    it('should allow optional args', () => {
      const config: StartupAppConfig = {
        name: 'simple-app',
        command: '/usr/bin/myapp',
      };

      expect(() => manager.register(config)).not.toThrow();
    });

    it('should allow optional workingDirectory', () => {
      const config: StartupAppConfig = {
        name: 'app-with-cwd',
        command: 'node',
        args: ['app.js'],
        workingDirectory: '/var/app',
      };

      expect(() => manager.register(config)).not.toThrow();
    });

    it('should allow optional environment variables', () => {
      const config: StartupAppConfig = {
        name: 'app-with-env',
        command: 'node',
        args: ['app.js'],
        environment: {
          NODE_ENV: 'production',
          DEBUG: 'true',
        },
      };

      expect(() => manager.register(config)).not.toThrow();
    });
  });

  describe('app registration', () => {
    it('should register multiple apps', () => {
      manager.register({ name: 'app1', command: 'node', args: ['app1.js'] });
      manager.register({ name: 'app2', command: 'node', args: ['app2.js'] });

      expect(manager.getRegisteredApps()).toHaveLength(2);
    });

    it('should prevent duplicate app names', () => {
      manager.register({ name: 'app1', command: 'node', args: ['app1.js'] });

      expect(() => {
        manager.register({ name: 'app1', command: 'python', args: ['app1.py'] });
      }).toThrow(/already registered/i);
    });

    it('should return registered app configs', () => {
      const config: StartupAppConfig = {
        name: 'test-app',
        command: 'node',
        args: ['test.js'],
      };

      manager.register(config);

      const apps = manager.getRegisteredApps();
      expect(apps[0]?.name).toBe('test-app');
      expect(apps[0]?.command).toBe('node');
    });
  });

  describe('app status', () => {
    it('should track app as pending before start', () => {
      manager.register({ name: 'app1', command: 'node', args: ['app.js'] });

      const status = manager.getAppStatus('app1');
      expect(status?.state).toBe('pending');
    });

    it('should return undefined for unknown app', () => {
      const status = manager.getAppStatus('nonexistent');
      expect(status).toBeUndefined();
    });

    it('should list all app statuses', () => {
      manager.register({ name: 'app1', command: 'node', args: ['app1.js'] });
      manager.register({ name: 'app2', command: 'node', args: ['app2.js'] });

      const statuses = manager.getAllAppStatuses();
      expect(statuses).toHaveLength(2);
      expect(statuses.map(s => s.name)).toContain('app1');
      expect(statuses.map(s => s.name)).toContain('app2');
    });
  });

  describe('events', () => {
    it('should emit app:registered event', () => {
      const handler = vi.fn();
      manager.on('app:registered', handler);

      manager.register({ name: 'app1', command: 'node', args: ['app.js'] });

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ name: 'app1' }));
    });

    it('should emit app:starting event on startAll', async () => {
      const handler = vi.fn();
      manager.on('app:starting', handler);

      manager.register({
        name: 'echo-app',
        command: process.platform === 'win32' ? 'cmd' : 'echo',
        args: process.platform === 'win32' ? ['/c', 'echo', 'hello'] : ['hello'],
      });

      // Start but don't wait for it to complete
      manager.startAll().catch(() => {});

      // Give it a moment to emit the event
      await new Promise(r => setTimeout(r, 50));

      expect(handler).toHaveBeenCalledWith('echo-app');
    });
  });

  describe('restart policy', () => {
    it('should respect restartOnCrash config', () => {
      const config: StartupAppConfig = {
        name: 'app-with-restart',
        command: 'node',
        args: ['app.js'],
        restartOnCrash: true,
        maxRestarts: 3,
      };

      manager.register(config);

      const apps = manager.getRegisteredApps();
      expect(apps[0]?.restartOnCrash).toBe(true);
      expect(apps[0]?.maxRestarts).toBe(3);
    });

    it('should default restartOnCrash to true', () => {
      manager.register({ name: 'app1', command: 'node', args: ['app.js'] });

      const apps = manager.getRegisteredApps();
      expect(apps[0]?.restartOnCrash).toBe(true);
    });

    it('should default maxRestarts to 5', () => {
      manager.register({ name: 'app1', command: 'node', args: ['app.js'] });

      const apps = manager.getRegisteredApps();
      expect(apps[0]?.maxRestarts).toBe(5);
    });
  });

  describe('clear', () => {
    it('should clear all registered apps', () => {
      manager.register({ name: 'app1', command: 'node', args: ['app1.js'] });
      manager.register({ name: 'app2', command: 'node', args: ['app2.js'] });

      manager.clear();

      expect(manager.getRegisteredApps()).toHaveLength(0);
    });
  });

  describe('app lifecycle', () => {
    it('should start an app and track running state', async () => {
      manager.register({
        name: 'long-running-app',
        command: process.platform === 'win32' ? 'cmd' : 'sleep',
        args: process.platform === 'win32' ? ['/c', 'ping', '-n', '10', '127.0.0.1'] : ['10'],
      });

      await manager.start('long-running-app');

      const status = manager.getAppStatus('long-running-app');
      expect(status?.state).toBe('running');
      expect(status?.pid).toBeDefined();
      expect(status?.startedAt).toBeInstanceOf(Date);
    });

    it('should stop a running app', async () => {
      manager.register({
        name: 'stoppable-app',
        command: process.platform === 'win32' ? 'cmd' : 'sleep',
        args: process.platform === 'win32' ? ['/c', 'ping', '-n', '30', '127.0.0.1'] : ['30'],
      });

      await manager.start('stoppable-app');
      expect(manager.isRunning('stoppable-app')).toBe(true);

      await manager.stop('stoppable-app');

      const status = manager.getAppStatus('stoppable-app');
      expect(status?.state).toBe('stopped');
      expect(status?.stoppedAt).toBeInstanceOf(Date);
    });

    it('should emit app:started event when app starts', async () => {
      const handler = vi.fn();
      manager.on('app:started', handler);

      manager.register({
        name: 'started-event-app',
        command: process.platform === 'win32' ? 'cmd' : 'sleep',
        args: process.platform === 'win32' ? ['/c', 'ping', '-n', '10', '127.0.0.1'] : ['10'],
      });

      await manager.start('started-event-app');

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        name: 'started-event-app',
        state: 'running',
      }));
    });

    it('should emit app:stopped event when app stops gracefully', async () => {
      const handler = vi.fn();
      manager.on('app:stopped', handler);

      manager.register({
        name: 'stopped-event-app',
        command: process.platform === 'win32' ? 'cmd' : 'sleep',
        args: process.platform === 'win32' ? ['/c', 'ping', '-n', '30', '127.0.0.1'] : ['30'],
      });

      await manager.start('stopped-event-app');
      await manager.stop('stopped-event-app');

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        name: 'stopped-event-app',
        state: 'stopped',
      }));
    });

    it('should track restart count when app crashes', async () => {
      // Use a command that exits immediately with non-zero code
      manager.register({
        name: 'crashing-app',
        command: process.platform === 'win32' ? 'cmd' : 'false',
        args: process.platform === 'win32' ? ['/c', 'exit', '1'] : [],
        restartOnCrash: true,
        maxRestarts: 2,
      });

      const crashHandler = vi.fn();
      manager.on('app:crashed', crashHandler);

      await manager.start('crashing-app');

      // Wait for crash detection and restart attempts
      await new Promise(r => setTimeout(r, 3500));

      // Should have crashed and attempted restarts
      expect(crashHandler).toHaveBeenCalled();
      const status = manager.getAppStatus('crashing-app');
      expect(status?.restartCount).toBeGreaterThan(0);
    }, 10000);

    it('should mark app as failed after max restarts exceeded', async () => {
      manager.register({
        name: 'failing-app',
        command: process.platform === 'win32' ? 'cmd' : 'false',
        args: process.platform === 'win32' ? ['/c', 'exit', '1'] : [],
        restartOnCrash: true,
        maxRestarts: 1,
      });

      await manager.start('failing-app');

      // Wait for restarts to exhaust
      await new Promise(r => setTimeout(r, 3000));

      const status = manager.getAppStatus('failing-app');
      expect(status?.state).toBe('failed');
      expect(status?.error).toMatch(/max restarts/i);
    }, 10000);
  });

  describe('isRunning', () => {
    it('should return true for running app', async () => {
      manager.register({
        name: 'running-check-app',
        command: process.platform === 'win32' ? 'cmd' : 'sleep',
        args: process.platform === 'win32' ? ['/c', 'ping', '-n', '10', '127.0.0.1'] : ['10'],
      });

      await manager.start('running-check-app');

      expect(manager.isRunning('running-check-app')).toBe(true);
    });

    it('should return false for stopped app', async () => {
      manager.register({
        name: 'stopped-check-app',
        command: process.platform === 'win32' ? 'cmd' : 'sleep',
        args: process.platform === 'win32' ? ['/c', 'ping', '-n', '10', '127.0.0.1'] : ['10'],
      });

      await manager.start('stopped-check-app');
      await manager.stop('stopped-check-app');

      expect(manager.isRunning('stopped-check-app')).toBe(false);
    });

    it('should return false for unknown app', () => {
      expect(manager.isRunning('unknown-app')).toBe(false);
    });
  });

  describe('startAll and stopAll', () => {
    it('should start all pending apps', async () => {
      manager.register({
        name: 'batch-app-1',
        command: process.platform === 'win32' ? 'cmd' : 'sleep',
        args: process.platform === 'win32' ? ['/c', 'ping', '-n', '10', '127.0.0.1'] : ['10'],
      });
      manager.register({
        name: 'batch-app-2',
        command: process.platform === 'win32' ? 'cmd' : 'sleep',
        args: process.platform === 'win32' ? ['/c', 'ping', '-n', '10', '127.0.0.1'] : ['10'],
      });

      await manager.startAll();

      expect(manager.isRunning('batch-app-1')).toBe(true);
      expect(manager.isRunning('batch-app-2')).toBe(true);
    });

    it('should stop all running apps', async () => {
      manager.register({
        name: 'stop-all-app-1',
        command: process.platform === 'win32' ? 'cmd' : 'sleep',
        args: process.platform === 'win32' ? ['/c', 'ping', '-n', '30', '127.0.0.1'] : ['30'],
      });
      manager.register({
        name: 'stop-all-app-2',
        command: process.platform === 'win32' ? 'cmd' : 'sleep',
        args: process.platform === 'win32' ? ['/c', 'ping', '-n', '30', '127.0.0.1'] : ['30'],
      });

      await manager.startAll();
      await manager.stopAll();

      expect(manager.isRunning('stop-all-app-1')).toBe(false);
      expect(manager.isRunning('stop-all-app-2')).toBe(false);
    });
  });

  describe('output capture', () => {
    it('should emit app:output event for stdout', async () => {
      const outputHandler = vi.fn();
      manager.on('app:output', outputHandler);

      manager.register({
        name: 'output-app',
        command: process.platform === 'win32' ? 'cmd' : 'echo',
        args: process.platform === 'win32' ? ['/c', 'echo', 'hello world'] : ['hello world'],
      });

      await manager.start('output-app');

      // Wait for output
      await new Promise(r => setTimeout(r, 500));

      expect(outputHandler).toHaveBeenCalledWith(
        'output-app',
        expect.stringContaining('hello'),
        'stdout'
      );
    });
  });
});
