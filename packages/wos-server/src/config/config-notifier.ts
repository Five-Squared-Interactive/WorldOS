/**
 * Config Notifier
 *
 * Story 5-4: Config Hot-Reload
 *
 * Notifies running plugins when their configuration changes via MQTT.
 * Plugins can subscribe to config change events and reload their settings.
 */

/**
 * Config change event published to MQTT
 */
export interface ConfigChangeEvent {
  pluginName: string;
  oldConfig: Record<string, unknown>;
  newConfig: Record<string, unknown>;
  changedKeys: string[];
  timestamp: number;
}

/**
 * Config reset event published to MQTT
 */
export interface ConfigResetEvent {
  pluginName: string;
  key: string | null;
  scope: 'key' | 'all';
  timestamp: number;
}

/**
 * MQTT client interface (subset of what we need)
 */
interface MqttClient {
  publish(topic: string, message: string): Promise<void>;
  connected: boolean;
}

/**
 * Notifies plugins of configuration changes via MQTT
 */
export class ConfigNotifier {
  private mqttClient: MqttClient;

  constructor(mqttClient: MqttClient) {
    this.mqttClient = mqttClient;
  }

  /**
   * Notify a plugin that its configuration has changed
   */
  async notifyConfigChange(
    pluginName: string,
    oldConfig: Record<string, unknown>,
    newConfig: Record<string, unknown>
  ): Promise<void> {
    const changedKeys = this.calculateChangedKeys(oldConfig, newConfig);

    const event: ConfigChangeEvent = {
      pluginName,
      oldConfig,
      newConfig,
      changedKeys,
      timestamp: Date.now(),
    };

    await this.publish(`wos/plugin/${pluginName}/config/changed`, event);
  }

  /**
   * Notify a plugin that a specific key has changed
   */
  async notifyKeyChange(
    pluginName: string,
    key: string,
    oldValue: unknown,
    newValue: unknown
  ): Promise<void> {
    const event: ConfigChangeEvent = {
      pluginName,
      oldConfig: { [key]: oldValue },
      newConfig: { [key]: newValue },
      changedKeys: [key],
      timestamp: Date.now(),
    };

    await this.publish(`wos/plugin/${pluginName}/config/changed`, event);
  }

  /**
   * Notify a plugin that its configuration has been reset
   */
  async notifyReset(pluginName: string, key?: string): Promise<void> {
    const event: ConfigResetEvent = {
      pluginName,
      key: key ?? null,
      scope: key ? 'key' : 'all',
      timestamp: Date.now(),
    };

    await this.publish(`wos/plugin/${pluginName}/config/reset`, event);
  }

  /**
   * Publish an event to MQTT
   */
  private async publish(topic: string, event: ConfigChangeEvent | ConfigResetEvent): Promise<void> {
    try {
      await this.mqttClient.publish(topic, JSON.stringify(event));
    } catch (error) {
      console.warn(`Failed to notify config change on ${topic}:`, error);
    }
  }

  /**
   * Calculate which keys have changed between two config objects
   */
  private calculateChangedKeys(
    oldConfig: Record<string, unknown>,
    newConfig: Record<string, unknown>,
    prefix = ''
  ): string[] {
    const changedKeys: string[] = [];
    const allKeys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)]);

    for (const key of allKeys) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      const oldValue = oldConfig[key];
      const newValue = newConfig[key];

      // Key was added or removed
      if (!(key in oldConfig) || !(key in newConfig)) {
        changedKeys.push(fullKey);
        continue;
      }

      // Both are objects - recurse
      if (
        oldValue !== null &&
        newValue !== null &&
        typeof oldValue === 'object' &&
        typeof newValue === 'object' &&
        !Array.isArray(oldValue) &&
        !Array.isArray(newValue)
      ) {
        changedKeys.push(
          ...this.calculateChangedKeys(
            oldValue as Record<string, unknown>,
            newValue as Record<string, unknown>,
            fullKey
          )
        );
        continue;
      }

      // Direct comparison
      if (!this.deepEqual(oldValue, newValue)) {
        changedKeys.push(fullKey);
      }
    }

    return changedKeys;
  }

  /**
   * Deep equality check
   */
  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;

    if (typeof a === 'object' && typeof b === 'object') {
      if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((item, i) => this.deepEqual(item, b[i]));
      }

      if (Array.isArray(a) || Array.isArray(b)) return false;

      const aObj = a as Record<string, unknown>;
      const bObj = b as Record<string, unknown>;
      const aKeys = Object.keys(aObj);
      const bKeys = Object.keys(bObj);

      if (aKeys.length !== bKeys.length) return false;
      return aKeys.every(key => this.deepEqual(aObj[key], bObj[key]));
    }

    return false;
  }
}
