// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export interface SyncManagerConfig {
  sync_mqtt_host: string;
  sync_mqtt_tcp_port: number;
  sync_mqtt_ws_port: number;
  mosquitto_path: string;
  heartbeat_interval_ms: number;
  max_entities_per_session: number;
  max_clients_per_session: number;
  persistence_enabled: boolean;
  persistence_backend: 'memory' | 'sqlite';
  persistence_path: string;
  regions_base_path: string;
  world_db_path: string;
  token_cache_ttl_ms: number;
  permission_cache_ttl_ms: number;
}

export const DEFAULT_CONFIG: SyncManagerConfig = {
  sync_mqtt_host: 'localhost',
  sync_mqtt_tcp_port: 1883,
  sync_mqtt_ws_port: 8083,
  mosquitto_path: 'mosquitto',
  heartbeat_interval_ms: 30000,
  max_entities_per_session: 10000,
  max_clients_per_session: 100,
  persistence_enabled: false,
  persistence_backend: 'sqlite',
  persistence_path: './data/sync.db',
  regions_base_path: './data/regions',
  world_db_path: './data/world.db',
  token_cache_ttl_ms: 300000,
  permission_cache_ttl_ms: 30000,
};

export interface RegionCoords {
  x: number;
  y: number;
}

export type SessionRegionMapping = Map<string, RegionCoords>;

export interface SyncManagerHealthDetails {
  mosquittoRunning: boolean;
  worldSyncRunning: boolean;
  activeSessions: number;
  connectedClients: number;
  totalEntities: number;
}

export const DEFAULT_PERMISSIONS = {
  ownerRead: 1,
  ownerWrite: 1,
  otherRead: 1,
  otherWrite: 0,
  ownerUse: 1,
  otherUse: 0,
  ownerTake: 1,
  otherTake: 0,
} as const;

/**
 * Parse region coordinates from a session tag.
 * Tag format: "world.X.Y" where X and Y are integer region coordinates.
 */
export function parseRegionFromTag(tag: string): RegionCoords | null {
  const parts = tag.split('.');
  if (parts.length !== 3 || parts[0] !== 'world') {
    return null;
  }
  const x = parseInt(parts[1], 10);
  const y = parseInt(parts[2], 10);
  if (isNaN(x) || isNaN(y)) {
    return null;
  }
  return { x, y };
}
