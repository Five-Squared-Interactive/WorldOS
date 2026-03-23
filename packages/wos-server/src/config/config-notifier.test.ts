/**
 * Config Notifier Tests
 *
 * Story 5-4: Config Hot-Reload
 *
 * Notifies running plugins when their configuration changes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigNotifier, ConfigChangeEvent } from './config-notifier.js';

describe('ConfigNotifier', () => {
  let mockMqttClient: {
    publish: ReturnType<typeof vi.fn>;
    connected: boolean;
  };
  let notifier: ConfigNotifier;

  beforeEach(() => {
    mockMqttClient = {
      publish: vi.fn().mockResolvedValue(undefined),
      connected: true,
    };
    notifier = new ConfigNotifier(mockMqttClient as any);
  });

  describe('notifyConfigChange', () => {
    it('should publish config change event to plugin topic', async () => {
      await notifier.notifyConfigChange('my-plugin', { port: 3000 }, { port: 4000 });

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        'wos/plugin/my-plugin/config/changed',
        expect.any(String)
      );
    });

    it('should include old and new values in event', async () => {
      await notifier.notifyConfigChange('my-plugin', { port: 3000 }, { port: 4000 });

      const payload = JSON.parse(mockMqttClient.publish.mock.calls[0][1]);
      expect(payload.oldConfig).toEqual({ port: 3000 });
      expect(payload.newConfig).toEqual({ port: 4000 });
    });

    it('should include changed keys in event', async () => {
      await notifier.notifyConfigChange(
        'my-plugin',
        { port: 3000, debug: false },
        { port: 4000, debug: false }
      );

      const payload = JSON.parse(mockMqttClient.publish.mock.calls[0][1]);
      expect(payload.changedKeys).toContain('port');
      expect(payload.changedKeys).not.toContain('debug');
    });

    it('should include timestamp in event', async () => {
      const before = Date.now();
      await notifier.notifyConfigChange('my-plugin', {}, { port: 3000 });
      const after = Date.now();

      const payload = JSON.parse(mockMqttClient.publish.mock.calls[0][1]);
      expect(payload.timestamp).toBeGreaterThanOrEqual(before);
      expect(payload.timestamp).toBeLessThanOrEqual(after);
    });

    it('should include plugin name in event', async () => {
      await notifier.notifyConfigChange('my-plugin', {}, { port: 3000 });

      const payload = JSON.parse(mockMqttClient.publish.mock.calls[0][1]);
      expect(payload.pluginName).toBe('my-plugin');
    });
  });

  describe('notifyKeyChange', () => {
    it('should publish single key change event', async () => {
      await notifier.notifyKeyChange('my-plugin', 'port', 3000, 4000);

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        'wos/plugin/my-plugin/config/changed',
        expect.any(String)
      );

      const payload = JSON.parse(mockMqttClient.publish.mock.calls[0][1]);
      expect(payload.changedKeys).toEqual(['port']);
    });

    it('should handle nested key changes', async () => {
      await notifier.notifyKeyChange('my-plugin', 'storage.backend', 'memory', 'redis');

      const payload = JSON.parse(mockMqttClient.publish.mock.calls[0][1]);
      expect(payload.changedKeys).toEqual(['storage.backend']);
      expect(payload.newConfig).toEqual({ 'storage.backend': 'redis' });
      expect(payload.oldConfig).toEqual({ 'storage.backend': 'memory' });
    });
  });

  describe('notifyReset', () => {
    it('should publish reset event', async () => {
      await notifier.notifyReset('my-plugin');

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        'wos/plugin/my-plugin/config/reset',
        expect.any(String)
      );
    });

    it('should include reset scope in event', async () => {
      await notifier.notifyReset('my-plugin', 'storage.backend');

      const payload = JSON.parse(mockMqttClient.publish.mock.calls[0][1]);
      expect(payload.key).toBe('storage.backend');
      expect(payload.scope).toBe('key');
    });

    it('should indicate full reset when no key specified', async () => {
      await notifier.notifyReset('my-plugin');

      const payload = JSON.parse(mockMqttClient.publish.mock.calls[0][1]);
      expect(payload.key).toBeNull();
      expect(payload.scope).toBe('all');
    });
  });

  describe('connection handling', () => {
    it('should not throw when MQTT client is disconnected', async () => {
      mockMqttClient.connected = false;
      mockMqttClient.publish.mockRejectedValue(new Error('Not connected'));

      // Should not throw
      await expect(
        notifier.notifyConfigChange('my-plugin', {}, { port: 3000 })
      ).resolves.not.toThrow();
    });

    it('should log warning when notification fails', async () => {
      mockMqttClient.publish.mockRejectedValue(new Error('Connection lost'));

      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await notifier.notifyConfigChange('my-plugin', {}, { port: 3000 });

      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to notify'),
        expect.any(Error)
      );

      consoleWarn.mockRestore();
    });
  });

  describe('diff calculation', () => {
    it('should detect added keys', async () => {
      await notifier.notifyConfigChange(
        'my-plugin',
        { existing: 1 },
        { existing: 1, newKey: 2 }
      );

      const payload = JSON.parse(mockMqttClient.publish.mock.calls[0][1]);
      expect(payload.changedKeys).toContain('newKey');
    });

    it('should detect removed keys', async () => {
      await notifier.notifyConfigChange(
        'my-plugin',
        { existing: 1, removed: 2 },
        { existing: 1 }
      );

      const payload = JSON.parse(mockMqttClient.publish.mock.calls[0][1]);
      expect(payload.changedKeys).toContain('removed');
    });

    it('should detect modified values', async () => {
      await notifier.notifyConfigChange(
        'my-plugin',
        { value: 'old' },
        { value: 'new' }
      );

      const payload = JSON.parse(mockMqttClient.publish.mock.calls[0][1]);
      expect(payload.changedKeys).toContain('value');
    });

    it('should not include unchanged keys', async () => {
      await notifier.notifyConfigChange(
        'my-plugin',
        { unchanged: 'same', changed: 1 },
        { unchanged: 'same', changed: 2 }
      );

      const payload = JSON.parse(mockMqttClient.publish.mock.calls[0][1]);
      expect(payload.changedKeys).not.toContain('unchanged');
      expect(payload.changedKeys).toContain('changed');
    });

    it('should handle nested object changes', async () => {
      await notifier.notifyConfigChange(
        'my-plugin',
        { storage: { backend: 'memory' } },
        { storage: { backend: 'redis' } }
      );

      const payload = JSON.parse(mockMqttClient.publish.mock.calls[0][1]);
      expect(payload.changedKeys).toContain('storage.backend');
    });
  });

  describe('event types', () => {
    it('should create proper ConfigChangeEvent structure', async () => {
      await notifier.notifyConfigChange(
        'my-plugin',
        { port: 3000 },
        { port: 4000 }
      );

      const payload: ConfigChangeEvent = JSON.parse(mockMqttClient.publish.mock.calls[0][1]);

      expect(payload).toMatchObject({
        pluginName: 'my-plugin',
        oldConfig: { port: 3000 },
        newConfig: { port: 4000 },
        changedKeys: ['port'],
        timestamp: expect.any(Number),
      });
    });
  });
});
