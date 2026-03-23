// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export type AssetType = 'texture' | 'model' | 'audio' | 'script' | 'other';

export interface AssetRecord {
  assetId: string;
  fileName: string;
  worldId: string;
  size: number;
  mimeType: string;
  assetType: AssetType;
  url: string;
  createdAt: string; // ISO 8601
  createdBy: string;
  metadata: string;  // JSON string
}

export interface AssetListResult {
  assets: AssetRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface StorageUsageResult {
  usedBytes: number;
  totalBytes: number;
  assetCount: number;
}
