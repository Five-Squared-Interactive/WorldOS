// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import * as fs from 'fs/promises';
import * as path from 'path';

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
const BASE64_RE = /^[A-Za-z0-9+/\s]*={0,2}\s*$/;

function validateSegment(value: string, label: string): void {
  if (!SAFE_ID.test(value)) {
    throw new Error(`Invalid ${label}: must match [a-zA-Z0-9_-]+`);
  }
}

function validateBase64(data: string): void {
  if (!data) {
    throw new Error('Invalid base64 data: contains invalid characters or is malformed');
  }
  const stripped = data.replace(/\s/g, '');
  if (!stripped || stripped.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(stripped)) {
    throw new Error('Invalid base64 data: contains invalid characters or is malformed');
  }
}

export class FileStorage {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private resolvePath(worldId: string, assetId: string, extension: string): string {
    validateSegment(worldId, 'worldId');
    validateSegment(assetId, 'assetId');
    validateSegment(extension, 'extension');
    return path.join(this.baseDir, 'assets', worldId, `${assetId}.${extension}`);
  }

  private async ensureDir(worldId: string): Promise<void> {
    validateSegment(worldId, 'worldId');
    const dir = path.join(this.baseDir, 'assets', worldId);
    await fs.mkdir(dir, { recursive: true });
  }

  async writeFile(worldId: string, assetId: string, extension: string, base64Data: string): Promise<string> {
    validateBase64(base64Data);
    await this.ensureDir(worldId);
    const filePath = this.resolvePath(worldId, assetId, extension);
    const buffer = Buffer.from(base64Data, 'base64');
    await fs.writeFile(filePath, buffer);
    return `assets/${worldId}/${assetId}.${extension}`;
  }

  async readFile(worldId: string, assetId: string, extension: string): Promise<string> {
    const filePath = this.resolvePath(worldId, assetId, extension);
    try {
      const buffer = await fs.readFile(filePath);
      return buffer.toString('base64');
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error(`Asset file not found: ${worldId}/${assetId}.${extension}`);
      }
      throw err;
    }
  }

  async deleteFile(worldId: string, assetId: string, extension: string): Promise<boolean> {
    const filePath = this.resolvePath(worldId, assetId, extension);
    try {
      await fs.unlink(filePath);
      return true;
    } catch (err: any) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }

  async deleteWorldDirectory(worldId: string): Promise<void> {
    validateSegment(worldId, 'worldId');
    const dir = path.join(this.baseDir, 'assets', worldId);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err: any) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
  }

  async getFileSize(worldId: string, assetId: string, extension: string): Promise<number> {
    const filePath = this.resolvePath(worldId, assetId, extension);
    const stat = await fs.stat(filePath);
    return stat.size;
  }
}
