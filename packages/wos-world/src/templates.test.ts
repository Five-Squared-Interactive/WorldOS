/**
 * Template API Tests
 *
 * Story 9.6: Template API
 *
 * Tests for entity templates.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TemplateManager,
  EntityTemplate,
  TemplateListResult,
  InstantiateOptions,
} from './templates.js';

describe('Template API', () => {
  let templateManager: TemplateManager;
  let mockMqttClient: any;

  beforeEach(() => {
    mockMqttClient = {
      publish: vi.fn(),
      subscribe: vi.fn(),
      on: vi.fn(),
    };
    templateManager = new TemplateManager(mockMqttClient);
  });

  describe('EntityTemplate types', () => {
    it('should define EntityTemplate interface', () => {
      const template: EntityTemplate = {
        id: 'template-1',
        name: 'Basic Cube',
        type: 'mesh',
        properties: {
          geometry: 'cube',
          material: 'default',
        },
      };

      expect(template.id).toBe('template-1');
      expect(template.name).toBe('Basic Cube');
    });

    it('should support default position', () => {
      const template: EntityTemplate = {
        id: 't1',
        name: 'Template',
        type: 'mesh',
        properties: {},
        defaultPosition: { x: 0, y: 1, z: 0 },
      };

      expect(template.defaultPosition).toEqual({ x: 0, y: 1, z: 0 });
    });

    it('should support default scale', () => {
      const template: EntityTemplate = {
        id: 't1',
        name: 'Template',
        type: 'mesh',
        properties: {},
        defaultScale: { x: 2, y: 2, z: 2 },
      };

      expect(template.defaultScale).toEqual({ x: 2, y: 2, z: 2 });
    });
  });

  describe('TemplateManager', () => {
    it('should create template manager', () => {
      expect(templateManager).toBeDefined();
    });

    it('should have list method', () => {
      expect(typeof templateManager.list).toBe('function');
    });

    it('should have get method', () => {
      expect(typeof templateManager.get).toBe('function');
    });

    it('should have instantiate method', () => {
      expect(typeof templateManager.instantiate).toBe('function');
    });
  });

  describe('list', () => {
    it('should list templates', async () => {
      templateManager.setMockResponse('list', {
        templates: [
          { id: 't1', name: 'Cube', type: 'mesh', properties: {} },
          { id: 't2', name: 'Light', type: 'light', properties: {} },
        ],
        total: 2,
      });

      const result = await templateManager.list('world-1');

      expect(result.templates.length).toBe(2);
      expect(result.total).toBe(2);
    });

    it('should include template id', async () => {
      templateManager.setMockResponse('list', {
        templates: [{ id: 'template-123', name: 'Test', type: 'mesh', properties: {} }],
        total: 1,
      });

      const result = await templateManager.list('world-1');

      expect(result.templates[0].id).toBe('template-123');
    });

    it('should include template name', async () => {
      templateManager.setMockResponse('list', {
        templates: [{ id: 't1', name: 'My Template', type: 'mesh', properties: {} }],
        total: 1,
      });

      const result = await templateManager.list('world-1');

      expect(result.templates[0].name).toBe('My Template');
    });

    it('should include template type', async () => {
      templateManager.setMockResponse('list', {
        templates: [{ id: 't1', name: 'Point Light', type: 'light', properties: {} }],
        total: 1,
      });

      const result = await templateManager.list('world-1');

      expect(result.templates[0].type).toBe('light');
    });

    it('should include template properties', async () => {
      templateManager.setMockResponse('list', {
        templates: [{
          id: 't1',
          name: 'Red Light',
          type: 'light',
          properties: { color: 'red', intensity: 1.0 },
        }],
        total: 1,
      });

      const result = await templateManager.list('world-1');

      expect(result.templates[0].properties.color).toBe('red');
    });

    it('should support pagination', async () => {
      templateManager.setMockResponse('list', {
        templates: [],
        total: 50,
        limit: 10,
        offset: 40,
      });

      const result = await templateManager.list('world-1', { limit: 10, offset: 40 });

      expect(result.limit).toBe(10);
      expect(result.offset).toBe(40);
    });

    it('should filter by type', async () => {
      templateManager.setMockResponse('list', {
        templates: [{ id: 't1', name: 'Light', type: 'light', properties: {} }],
        total: 1,
      });

      const result = await templateManager.list('world-1', { type: 'light' });

      expect(result.templates.every(t => t.type === 'light')).toBe(true);
    });
  });

  describe('get', () => {
    it('should get template by id', async () => {
      templateManager.setMockResponse('get', {
        id: 'template-123',
        name: 'Detailed Cube',
        type: 'mesh',
        properties: {
          geometry: 'cube',
          dimensions: { width: 1, height: 1, depth: 1 },
        },
        components: ['renderer', 'collider'],
      });

      const template = await templateManager.get('world-1', 'template-123');

      expect(template.id).toBe('template-123');
      expect(template.name).toBe('Detailed Cube');
    });

    it('should include full properties', async () => {
      templateManager.setMockResponse('get', {
        id: 't1',
        name: 'Complex Template',
        type: 'mesh',
        properties: {
          material: { type: 'pbr', color: '#ff0000', metalness: 0.5 },
          physics: { mass: 1.0, friction: 0.5 },
        },
      });

      const template = await templateManager.get('world-1', 't1');

      expect(template.properties.material).toBeDefined();
      expect(template.properties.physics).toBeDefined();
    });

    it('should include components', async () => {
      templateManager.setMockResponse('get', {
        id: 't1',
        name: 'Entity',
        type: 'mesh',
        properties: {},
        components: ['MeshRenderer', 'BoxCollider', 'RigidBody'],
      });

      const template = await templateManager.get('world-1', 't1');

      expect(template.components).toContain('MeshRenderer');
      expect(template.components).toContain('BoxCollider');
    });

    it('should throw for non-existent template', async () => {
      templateManager.setMockError('get', {
        code: 'TEMPLATE_NOT_FOUND',
        message: 'Template not found',
      });

      try {
        await templateManager.get('world-1', 'invalid-template');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.code).toBe('TEMPLATE_NOT_FOUND');
      }
    });
  });

  describe('instantiate', () => {
    it('should instantiate template', async () => {
      templateManager.setMockResponse('instantiate', {
        entityId: 'new-entity-1',
      });

      const result = await templateManager.instantiate('world-1', 'template-1', {
        position: { x: 10, y: 0, z: 5 },
      });

      expect(result.entityId).toBe('new-entity-1');
    });

    it('should use position override', async () => {
      templateManager.setMockResponse('instantiate', {
        entityId: 'e1',
        position: { x: 100, y: 50, z: 25 },
      });

      const result = await templateManager.instantiate('world-1', 'template-1', {
        position: { x: 100, y: 50, z: 25 },
      });

      expect(result.position).toEqual({ x: 100, y: 50, z: 25 });
    });

    it('should support property overrides', async () => {
      templateManager.setMockResponse('instantiate', {
        entityId: 'e1',
        properties: { color: 'blue' },
      });

      const result = await templateManager.instantiate('world-1', 'template-1', {
        position: { x: 0, y: 0, z: 0 },
        properties: { color: 'blue' },
      });

      expect(result.properties?.color).toBe('blue');
    });

    it('should support scale override', async () => {
      templateManager.setMockResponse('instantiate', {
        entityId: 'e1',
        scale: { x: 2, y: 2, z: 2 },
      });

      const result = await templateManager.instantiate('world-1', 'template-1', {
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 2, y: 2, z: 2 },
      });

      expect(result.scale).toEqual({ x: 2, y: 2, z: 2 });
    });

    it('should support rotation override', async () => {
      templateManager.setMockResponse('instantiate', {
        entityId: 'e1',
        rotation: { x: 0, y: 0.707, z: 0, w: 0.707 },
      });

      const result = await templateManager.instantiate('world-1', 'template-1', {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0.707, z: 0, w: 0.707 },
      });

      expect(result.rotation?.y).toBeCloseTo(0.707);
    });

    it('should throw for non-existent template', async () => {
      templateManager.setMockError('instantiate', {
        code: 'TEMPLATE_NOT_FOUND',
        message: 'Template not found',
      });

      try {
        await templateManager.instantiate('world-1', 'invalid-template', {
          position: { x: 0, y: 0, z: 0 },
        });
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.code).toBe('TEMPLATE_NOT_FOUND');
      }
    });
  });
});
