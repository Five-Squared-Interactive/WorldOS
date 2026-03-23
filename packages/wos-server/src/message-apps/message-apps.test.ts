/**
 * Message-Triggered Apps Tests
 *
 * Story 3.8: Message-Triggered Apps
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { MessageAppManager, MessageAppConfig, MessageApp } from './message-apps.js';

/**
 * Mock MQTT client for testing
 */
class MockMqttClient extends EventEmitter {
  subscribed: string[] = [];

  subscribe(topic: string): void {
    this.subscribed.push(topic);
  }

  unsubscribe(topic: string): void {
    this.subscribed = this.subscribed.filter(t => t !== topic);
  }

  // Simulate a message arriving
  simulateMessage(topic: string, payload: string | object): void {
    const data = typeof payload === 'object' ? JSON.stringify(payload) : payload;
    this.emit('message', topic, Buffer.from(data));
  }
}

describe('MessageAppManager', () => {
  let manager: MessageAppManager;
  let mockMqtt: MockMqttClient;

  beforeEach(() => {
    mockMqtt = new MockMqttClient();
    manager = new MessageAppManager({ mqttClient: mockMqtt as unknown as never });
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  describe('configuration parsing', () => {
    it('should accept valid message app config', () => {
      const config: MessageAppConfig = {
        name: 'backup-runner',
        trigger: 'wos/admin/backup/start',
        command: 'node',
        args: ['./apps/backup/dist/run.js'],
      };

      expect(() => manager.register(config)).not.toThrow();
    });

    it('should require name field', () => {
      const config = {
        trigger: 'wos/admin/backup/start',
        command: 'node',
      } as MessageAppConfig;

      expect(() => manager.register(config)).toThrow(/name/i);
    });

    it('should require trigger field', () => {
      const config = {
        name: 'backup-runner',
        command: 'node',
      } as MessageAppConfig;

      expect(() => manager.register(config)).toThrow(/trigger/i);
    });

    it('should require command field', () => {
      const config = {
        name: 'backup-runner',
        trigger: 'wos/admin/backup/start',
      } as MessageAppConfig;

      expect(() => manager.register(config)).toThrow(/command/i);
    });

    it('should allow optional args', () => {
      const config: MessageAppConfig = {
        name: 'simple-trigger',
        trigger: 'wos/admin/simple',
        command: '/usr/bin/myapp',
      };

      expect(() => manager.register(config)).not.toThrow();
    });

    it('should allow optional workingDirectory', () => {
      const config: MessageAppConfig = {
        name: 'app-with-cwd',
        trigger: 'wos/admin/app',
        command: 'node',
        args: ['app.js'],
        workingDirectory: '/var/app',
      };

      expect(() => manager.register(config)).not.toThrow();
    });

    it('should allow optional environment variables', () => {
      const config: MessageAppConfig = {
        name: 'app-with-env',
        trigger: 'wos/admin/app',
        command: 'node',
        args: ['app.js'],
        environment: {
          NODE_ENV: 'production',
        },
      };

      expect(() => manager.register(config)).not.toThrow();
    });

    it('should allow concurrency mode configuration', () => {
      const config: MessageAppConfig = {
        name: 'concurrent-app',
        trigger: 'wos/admin/concurrent',
        command: 'node',
        args: ['app.js'],
        concurrency: 'spawn', // spawn new instance for each message
      };

      expect(() => manager.register(config)).not.toThrow();
    });
  });

  describe('trigger subscription', () => {
    it('should subscribe to trigger topic on register', () => {
      manager.register({
        name: 'test-app',
        trigger: 'wos/admin/test',
        command: 'node',
        args: ['app.js'],
      });

      expect(mockMqtt.subscribed).toContain('wos/admin/test');
    });

    it('should subscribe to multiple trigger topics', () => {
      manager.register({
        name: 'app1',
        trigger: 'wos/admin/app1',
        command: 'node',
        args: ['app1.js'],
      });
      manager.register({
        name: 'app2',
        trigger: 'wos/admin/app2',
        command: 'node',
        args: ['app2.js'],
      });

      expect(mockMqtt.subscribed).toContain('wos/admin/app1');
      expect(mockMqtt.subscribed).toContain('wos/admin/app2');
    });
  });

  describe('app registration', () => {
    it('should register multiple apps', () => {
      manager.register({
        name: 'app1',
        trigger: 'wos/admin/app1',
        command: 'node',
        args: ['app1.js'],
      });
      manager.register({
        name: 'app2',
        trigger: 'wos/admin/app2',
        command: 'node',
        args: ['app2.js'],
      });

      expect(manager.getRegisteredApps()).toHaveLength(2);
    });

    it('should prevent duplicate app names', () => {
      manager.register({
        name: 'app1',
        trigger: 'wos/admin/app1',
        command: 'node',
        args: ['app1.js'],
      });

      expect(() => {
        manager.register({
          name: 'app1',
          trigger: 'wos/admin/different',
          command: 'python',
          args: ['app1.py'],
        });
      }).toThrow(/already registered/i);
    });
  });

  describe('app status', () => {
    it('should track app as idle before trigger', () => {
      manager.register({
        name: 'app1',
        trigger: 'wos/admin/app1',
        command: 'node',
        args: ['app.js'],
      });

      const status = manager.getAppStatus('app1');
      expect(status?.state).toBe('idle');
    });

    it('should return undefined for unknown app', () => {
      const status = manager.getAppStatus('nonexistent');
      expect(status).toBeUndefined();
    });

    it('should list all app statuses', () => {
      manager.register({
        name: 'app1',
        trigger: 'wos/admin/app1',
        command: 'node',
        args: ['app1.js'],
      });
      manager.register({
        name: 'app2',
        trigger: 'wos/admin/app2',
        command: 'node',
        args: ['app2.js'],
      });

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

      manager.register({
        name: 'app1',
        trigger: 'wos/admin/app1',
        command: 'node',
        args: ['app.js'],
      });

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ name: 'app1' }));
    });
  });

  describe('message triggering', () => {
    it('should spawn app when trigger message arrives', async () => {
      const triggerHandler = vi.fn();
      manager.on('app:triggered', triggerHandler);

      manager.register({
        name: 'triggered-app',
        trigger: 'wos/admin/run',
        command: process.platform === 'win32' ? 'cmd' : 'echo',
        args: process.platform === 'win32' ? ['/c', 'echo', 'triggered'] : ['triggered'],
      });

      // Simulate message
      mockMqtt.simulateMessage('wos/admin/run', { action: 'backup' });

      // Wait for trigger
      await new Promise(r => setTimeout(r, 100));

      expect(triggerHandler).toHaveBeenCalledWith(
        'triggered-app',
        expect.objectContaining({ action: 'backup' })
      );
    });

    it('should pass message payload as environment variable', async () => {
      const outputHandler = vi.fn();
      manager.on('app:output', outputHandler);

      manager.register({
        name: 'payload-app',
        trigger: 'wos/admin/payload',
        command: process.platform === 'win32' ? 'cmd' : 'sh',
        args: process.platform === 'win32'
          ? ['/c', 'echo', '%WOS_MESSAGE_PAYLOAD%']
          : ['-c', 'echo $WOS_MESSAGE_PAYLOAD'],
      });

      // Simulate message with payload
      mockMqtt.simulateMessage('wos/admin/payload', { key: 'value' });

      // Wait for output
      await new Promise(r => setTimeout(r, 500));

      // The payload should be in the environment
      const status = manager.getAppStatus('payload-app');
      expect(status?.lastTriggerPayload).toBeDefined();
    });

    it('should track trigger count', async () => {
      manager.register({
        name: 'count-app',
        trigger: 'wos/admin/count',
        command: process.platform === 'win32' ? 'cmd' : 'echo',
        args: process.platform === 'win32' ? ['/c', 'echo', 'done'] : ['done'],
      });

      // Trigger multiple times
      mockMqtt.simulateMessage('wos/admin/count', {});
      await new Promise(r => setTimeout(r, 100));
      mockMqtt.simulateMessage('wos/admin/count', {});
      await new Promise(r => setTimeout(r, 100));

      const status = manager.getAppStatus('count-app');
      expect(status?.triggerCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('concurrency modes', () => {
    it('should queue messages when concurrency is queue (default)', async () => {
      manager.register({
        name: 'queue-app',
        trigger: 'wos/admin/queue',
        command: process.platform === 'win32' ? 'cmd' : 'sleep',
        args: process.platform === 'win32' ? ['/c', 'ping', '-n', '2', '127.0.0.1'] : ['1'],
        concurrency: 'queue',
      });

      // Trigger while already running
      mockMqtt.simulateMessage('wos/admin/queue', { id: 1 });
      await new Promise(r => setTimeout(r, 50));
      mockMqtt.simulateMessage('wos/admin/queue', { id: 2 });

      const status = manager.getAppStatus('queue-app');
      expect(status?.queuedMessages).toBeGreaterThanOrEqual(1);
    });

    it('should ignore messages when concurrency is ignore', async () => {
      const triggerHandler = vi.fn();
      manager.on('app:triggered', triggerHandler);

      manager.register({
        name: 'ignore-app',
        trigger: 'wos/admin/ignore',
        command: process.platform === 'win32' ? 'cmd' : 'sleep',
        args: process.platform === 'win32' ? ['/c', 'ping', '-n', '3', '127.0.0.1'] : ['2'],
        concurrency: 'ignore',
      });

      // Trigger while already running
      mockMqtt.simulateMessage('wos/admin/ignore', { id: 1 });
      await new Promise(r => setTimeout(r, 100));
      mockMqtt.simulateMessage('wos/admin/ignore', { id: 2 });
      await new Promise(r => setTimeout(r, 100));

      // Should only have been triggered once
      expect(triggerHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('app completion', () => {
    it('should emit app:completed event on successful exit', async () => {
      const completedHandler = vi.fn();
      manager.on('app:completed', completedHandler);

      manager.register({
        name: 'complete-app',
        trigger: 'wos/admin/complete',
        command: process.platform === 'win32' ? 'cmd' : 'echo',
        args: process.platform === 'win32' ? ['/c', 'echo', 'done'] : ['done'],
      });

      mockMqtt.simulateMessage('wos/admin/complete', {});

      // Wait for completion
      await new Promise(r => setTimeout(r, 500));

      expect(completedHandler).toHaveBeenCalledWith(expect.objectContaining({
        name: 'complete-app',
        exitCode: 0,
      }));
    });

    it('should track state as idle after completion', async () => {
      manager.register({
        name: 'idle-after-app',
        trigger: 'wos/admin/idle',
        command: process.platform === 'win32' ? 'cmd' : 'echo',
        args: process.platform === 'win32' ? ['/c', 'echo', 'done'] : ['done'],
      });

      mockMqtt.simulateMessage('wos/admin/idle', {});

      // Wait for completion
      await new Promise(r => setTimeout(r, 500));

      const status = manager.getAppStatus('idle-after-app');
      expect(status?.state).toBe('idle');
    });
  });

  describe('clear', () => {
    it('should clear all registered apps and unsubscribe', () => {
      manager.register({
        name: 'app1',
        trigger: 'wos/admin/app1',
        command: 'node',
        args: ['app1.js'],
      });
      manager.register({
        name: 'app2',
        trigger: 'wos/admin/app2',
        command: 'node',
        args: ['app2.js'],
      });

      manager.clear();

      expect(manager.getRegisteredApps()).toHaveLength(0);
      expect(mockMqtt.subscribed).toHaveLength(0);
    });
  });
});
