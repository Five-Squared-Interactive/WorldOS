// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import type { AssetType } from './types.js';

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.obj': 'model/obj',
  '.fbx': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

export function getMimeType(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1) return 'application/octet-stream';
  const ext = filename.slice(dotIndex).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

export function getAssetType(mimeType: string): AssetType {
  if (mimeType.startsWith('image/')) return 'texture';
  if (mimeType.startsWith('model/')) return 'model';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/javascript') return 'script';
  return 'other';
}
