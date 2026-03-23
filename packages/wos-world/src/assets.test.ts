/**
 * Asset Operations Tests
 *
 * Story 9.5: Asset Operations
 *
 * Tests for reading and writing world assets.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AssetManager,
  Asset,
  AssetType,
  AssetListResult,
  CreateAssetOptions,
} from './assets.js';

describe('Asset Operations API', () => {
  let assetManager: AssetManager;
  let mockMqttClient: any;

  beforeEach(() => {
    mockMqttClient = {
      publish: vi.fn(),
      subscribe: vi.fn(),
      on: vi.fn(),
    };
    assetManager = new AssetManager(mockMqttClient);
  });

  describe('Asset types', () => {
    it('should define Asset interface', () => {
      const asset: Asset = {
        id: 'asset-1',
        name: 'texture.png',
        type: 'texture',
        size: 1024,
        url: 'https://cdn.example.com/assets/texture.png',
        createdAt: new Date(),
      };

      expect(asset.id).toBe('asset-1');
      expect(asset.type).toBe('texture');
    });

    it('should support texture asset type', () => {
      const type: AssetType = 'texture';
      expect(type).toBe('texture');
    });

    it('should support model asset type', () => {
      const type: AssetType = 'model';
      expect(type).toBe('model');
    });

    it('should support audio asset type', () => {
      const type: AssetType = 'audio';
      expect(type).toBe('audio');
    });

    it('should support script asset type', () => {
      const type: AssetType = 'script';
      expect(type).toBe('script');
    });

    it('should support other asset type', () => {
      const type: AssetType = 'other';
      expect(type).toBe('other');
    });
  });

  describe('AssetManager', () => {
    it('should create asset manager', () => {
      expect(assetManager).toBeDefined();
    });

    it('should have list method', () => {
      expect(typeof assetManager.list).toBe('function');
    });

    it('should have get method', () => {
      expect(typeof assetManager.get).toBe('function');
    });

    it('should have create method', () => {
      expect(typeof assetManager.create).toBe('function');
    });

    it('should have delete method', () => {
      expect(typeof assetManager.delete).toBe('function');
    });
  });

  describe('list', () => {
    it('should list world assets', async () => {
      assetManager.setMockResponse('list', {
        assets: [
          { id: 'a1', name: 'texture.png', type: 'texture', size: 1024, url: 'https://cdn/a1' },
          { id: 'a2', name: 'model.glb', type: 'model', size: 5120, url: 'https://cdn/a2' },
        ],
        total: 2,
      });

      const result = await assetManager.list('world-1');

      expect(result.assets.length).toBe(2);
      expect(result.total).toBe(2);
    });

    it('should include asset id', async () => {
      assetManager.setMockResponse('list', {
        assets: [{ id: 'asset-123', name: 'test.png', type: 'texture', size: 100, url: 'https://cdn/asset-123' }],
        total: 1,
      });

      const result = await assetManager.list('world-1');

      expect(result.assets[0].id).toBe('asset-123');
    });

    it('should include asset name', async () => {
      assetManager.setMockResponse('list', {
        assets: [{ id: 'a1', name: 'my-texture.png', type: 'texture', size: 100, url: 'https://cdn/a1' }],
        total: 1,
      });

      const result = await assetManager.list('world-1');

      expect(result.assets[0].name).toBe('my-texture.png');
    });

    it('should include asset type', async () => {
      assetManager.setMockResponse('list', {
        assets: [{ id: 'a1', name: 'sound.mp3', type: 'audio', size: 2048, url: 'https://cdn/a1' }],
        total: 1,
      });

      const result = await assetManager.list('world-1');

      expect(result.assets[0].type).toBe('audio');
    });

    it('should include asset size', async () => {
      assetManager.setMockResponse('list', {
        assets: [{ id: 'a1', name: 'large.glb', type: 'model', size: 10485760, url: 'https://cdn/a1' }],
        total: 1,
      });

      const result = await assetManager.list('world-1');

      expect(result.assets[0].size).toBe(10485760);
    });

    it('should include asset url', async () => {
      assetManager.setMockResponse('list', {
        assets: [{ id: 'a1', name: 'file.png', type: 'texture', size: 100, url: 'https://cdn.example.com/assets/a1/file.png' }],
        total: 1,
      });

      const result = await assetManager.list('world-1');

      expect(result.assets[0].url).toContain('cdn.example.com');
    });

    it('should support pagination', async () => {
      assetManager.setMockResponse('list', {
        assets: [],
        total: 100,
        limit: 10,
        offset: 90,
      });

      const result = await assetManager.list('world-1', { limit: 10, offset: 90 });

      expect(result.limit).toBe(10);
      expect(result.offset).toBe(90);
      expect(result.total).toBe(100);
    });

    it('should filter by type', async () => {
      assetManager.setMockResponse('list', {
        assets: [
          { id: 'a1', name: 'tex1.png', type: 'texture', size: 100, url: 'https://cdn/a1' },
        ],
        total: 1,
      });

      const result = await assetManager.list('world-1', { type: 'texture' });

      expect(result.assets.every(a => a.type === 'texture')).toBe(true);
    });
  });

  describe('get', () => {
    it('should get asset by id', async () => {
      assetManager.setMockResponse('get', {
        id: 'asset-123',
        name: 'texture.png',
        type: 'texture',
        size: 2048,
        url: 'https://cdn.example.com/assets/texture.png',
        mimeType: 'image/png',
        createdAt: new Date('2026-01-15'),
      });

      const asset = await assetManager.get('world-1', 'asset-123');

      expect(asset.id).toBe('asset-123');
      expect(asset.name).toBe('texture.png');
    });

    it('should include content url', async () => {
      assetManager.setMockResponse('get', {
        id: 'asset-123',
        name: 'model.glb',
        type: 'model',
        size: 5120,
        url: 'https://cdn.example.com/assets/model.glb',
      });

      const asset = await assetManager.get('world-1', 'asset-123');

      expect(asset.url).toBeDefined();
      expect(typeof asset.url).toBe('string');
    });

    it('should throw for non-existent asset', async () => {
      assetManager.setMockError('get', {
        code: 'ASSET_NOT_FOUND',
        message: 'Asset not found',
      });

      try {
        await assetManager.get('world-1', 'invalid-asset');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.code).toBe('ASSET_NOT_FOUND');
      }
    });
  });

  describe('create', () => {
    it('should create asset from data', async () => {
      assetManager.setMockResponse('create', {
        id: 'new-asset-1',
        url: 'https://cdn.example.com/assets/new-asset-1',
      });

      const result = await assetManager.create('world-1', {
        name: 'new-texture.png',
        type: 'texture',
        data: Buffer.from('fake image data'),
      });

      expect(result.id).toBe('new-asset-1');
    });

    it('should return asset id', async () => {
      assetManager.setMockResponse('create', {
        id: 'generated-uuid',
        url: 'https://cdn/generated-uuid',
      });

      const result = await assetManager.create('world-1', {
        name: 'file.bin',
        type: 'other',
        data: Buffer.from('data'),
      });

      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe('string');
    });

    it('should return asset url', async () => {
      assetManager.setMockResponse('create', {
        id: 'new-asset',
        url: 'https://cdn.example.com/new-asset',
      });

      const result = await assetManager.create('world-1', {
        name: 'file.png',
        type: 'texture',
        data: Buffer.from('data'),
      });

      expect(result.url).toBeDefined();
    });

    it('should support metadata', async () => {
      assetManager.setMockResponse('create', {
        id: 'new-asset',
        url: 'https://cdn/new-asset',
      });

      const result = await assetManager.create('world-1', {
        name: 'file.png',
        type: 'texture',
        data: Buffer.from('data'),
        metadata: { author: 'test', license: 'MIT' },
      });

      expect(result.id).toBeDefined();
    });
  });

  describe('delete', () => {
    it('should delete asset', async () => {
      assetManager.setMockResponse('delete', { success: true });

      const result = await assetManager.delete('world-1', 'asset-123');

      expect(result.success).toBe(true);
    });

    it('should throw for non-existent asset', async () => {
      assetManager.setMockError('delete', {
        code: 'ASSET_NOT_FOUND',
        message: 'Asset not found',
      });

      try {
        await assetManager.delete('world-1', 'invalid-asset');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.code).toBe('ASSET_NOT_FOUND');
      }
    });

    it('should free storage on delete', async () => {
      assetManager.setMockResponse('delete', { success: true, freedBytes: 5120 });

      const result = await assetManager.delete('world-1', 'asset-123');

      expect(result.freedBytes).toBe(5120);
    });
  });

  describe('getUsage', () => {
    it('should get storage usage', async () => {
      assetManager.setMockResponse('getUsage', {
        usedBytes: 104857600,
        totalBytes: 1073741824,
        assetCount: 50,
      });

      const usage = await assetManager.getUsage('world-1');

      expect(usage.usedBytes).toBe(104857600);
      expect(usage.totalBytes).toBe(1073741824);
      expect(usage.assetCount).toBe(50);
    });
  });
});
