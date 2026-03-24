/**
 * WorldOS World State API
 *
 * Epic 9: World State API
 *
 * API for interacting with world state including entities, assets, and metadata.
 */

// entities.js is the canonical source for MqttClient and WorldStateError
export * from './entities.js';

// Re-export everything else, excluding duplicates of MqttClient/WorldStateError
export { type WorldType, type WorldPermissions, type WorldMetadata, type WorldSummary, type WorldListResult, type WorldListOptions, type WorldLifecycleEventType, type WorldLifecycleEvent, type WorldLifecycleHandler, WorldManager } from './world-state.js';
export { type AssetType, type Asset, type AssetListOptions, type AssetListResult, type CreateAssetOptions, type CreateAssetResult, type DeleteAssetResult, type StorageUsage, AssetError, AssetManager } from './assets.js';
export { type EntityTemplate, type TemplateListOptions, type TemplateListResult, type InstantiateOptions, type InstantiateResult, TemplateError, TemplateManager } from './templates.js';
export { type GeoCoordinates, type TerrainHeight, type TerrainHeights, type TerrainNormal, type BiomeResult, type RegionQuery, type RegionEntity, type RegionQueryResult, type GeoToWorldResult, type WorldToGeoResult, TerrainError, TerrainManager } from './terrain.js';
