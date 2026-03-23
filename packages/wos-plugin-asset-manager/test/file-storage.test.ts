// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileStorage } from '../src/file-storage.js';

describe('FileStorage', () => {
  let tmpDir: string;
  let storage: FileStorage;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-test-'));
    storage = new FileStorage(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const sampleBase64 = Buffer.from('hello world').toString('base64'); // aGVsbG8gd29ybGQ=

  describe('writeFile', () => {
    it('creates directory and writes file, returns relative URL', async () => {
      const url = await storage.writeFile('world-1', 'asset-001', 'png', sampleBase64);
      expect(url).toBe('assets/world-1/asset-001.png');

      const filePath = path.join(tmpDir, 'assets', 'world-1', 'asset-001.png');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('written file contents match decoded base64', async () => {
      await storage.writeFile('world-1', 'asset-001', 'png', sampleBase64);
      const filePath = path.join(tmpDir, 'assets', 'world-1', 'asset-001.png');
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toBe('hello world');
    });

    it('creates correct directory structure', async () => {
      await storage.writeFile('my-world', 'my-asset', 'glb', sampleBase64);
      const dirPath = path.join(tmpDir, 'assets', 'my-world');
      expect(fs.existsSync(dirPath)).toBe(true);
    });
  });

  describe('readFile', () => {
    it('returns base64-encoded string', async () => {
      await storage.writeFile('world-1', 'asset-001', 'png', sampleBase64);
      const result = await storage.readFile('world-1', 'asset-001', 'png');
      expect(result).toBe(sampleBase64);
    });

    it('throws descriptive error for non-existent file', async () => {
      await expect(storage.readFile('world-1', 'nonexistent', 'png'))
        .rejects.toThrow(/not found|ENOENT/i);
    });
  });

  describe('deleteFile', () => {
    it('removes file and returns true', async () => {
      await storage.writeFile('world-1', 'asset-001', 'png', sampleBase64);
      const result = await storage.deleteFile('world-1', 'asset-001', 'png');
      expect(result).toBe(true);

      const filePath = path.join(tmpDir, 'assets', 'world-1', 'asset-001.png');
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('returns false for non-existent file', async () => {
      const result = await storage.deleteFile('world-1', 'nonexistent', 'png');
      expect(result).toBe(false);
    });
  });

  describe('deleteWorldDirectory', () => {
    it('removes entire world asset directory', async () => {
      await storage.writeFile('world-1', 'a1', 'png', sampleBase64);
      await storage.writeFile('world-1', 'a2', 'jpg', sampleBase64);
      await storage.deleteWorldDirectory('world-1');

      const dirPath = path.join(tmpDir, 'assets', 'world-1');
      expect(fs.existsSync(dirPath)).toBe(false);
    });
  });

  describe('getFileSize', () => {
    it('returns file size in bytes', async () => {
      await storage.writeFile('world-1', 'asset-001', 'png', sampleBase64);
      const size = await storage.getFileSize('world-1', 'asset-001', 'png');
      expect(size).toBe(Buffer.from(sampleBase64, 'base64').length);
    });
  });

  describe('path traversal prevention', () => {
    it('rejects worldId with ..', async () => {
      await expect(storage.writeFile('../etc', 'asset', 'png', sampleBase64))
        .rejects.toThrow(/invalid/i);
    });

    it('rejects assetId with /', async () => {
      await expect(storage.writeFile('world-1', 'a/b', 'png', sampleBase64))
        .rejects.toThrow(/invalid/i);
    });

    it('rejects extension with ..', async () => {
      await expect(storage.writeFile('world-1', 'asset', '../../../etc/passwd', sampleBase64))
        .rejects.toThrow(/invalid/i);
    });

    it('rejects worldId with backslash', async () => {
      await expect(storage.writeFile('world\\1', 'asset', 'png', sampleBase64))
        .rejects.toThrow(/invalid/i);
    });

    it('rejects worldId with spaces', async () => {
      await expect(storage.writeFile('world 1', 'asset', 'png', sampleBase64))
        .rejects.toThrow(/invalid/i);
    });
  });

  describe('malformed base64', () => {
    it('rejects truncated base64', async () => {
      await expect(storage.writeFile('world-1', 'asset', 'png', '!!!not-base64!!!'))
        .rejects.toThrow(/base64/i);
    });

    it('rejects base64 with invalid characters', async () => {
      await expect(storage.writeFile('world-1', 'asset', 'png', 'abc def ghi'))
        .rejects.toThrow(/base64/i);
    });
  });
});
