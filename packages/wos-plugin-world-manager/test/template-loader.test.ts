// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { TemplateLoader } from '../src/template-loader.js';
import type { WorldTemplatesConfig, WorldTemplateData } from '../src/types.js';

describe('TemplateLoader', () => {
  let testDir: string;
  let templatesDir: string;
  let configDir: string;
  let loader: TemplateLoader;

  const sampleConfig: WorldTemplatesConfig = {
    templates: [
      {
        name: 'default-space',
        description: 'Empty space world',
        allowedTypes: ['space'],
        file: 'default-space.json',
      },
      {
        name: 'earth-planet',
        description: 'Earth-like planet',
        allowedTypes: ['planet'],
        file: 'earth-planet.json',
      },
      {
        name: 'sandbox',
        description: 'Open sandbox world',
        allowedTypes: ['space', 'planet', 'mini-world', 'custom'],
        file: 'sandbox.json',
      },
    ],
  };

  const spaceTemplate: WorldTemplateData = {
    metadata: {
      name: 'My Space World',
      description: 'A default space environment',
      type: 'space',
      settings: {
        skyConfig: { type: 'starfield', density: 0.8 },
        gravity: false,
        spawnConfig: { position: { x: 0, y: 0, z: 0 } },
      },
    },
    entityTemplates: [
      { name: 'light-source', type: 'light', properties: { intensity: 1.0 } },
    ],
    entities: [
      { type: 'light', templateName: 'light-source', position: { x: 0, y: 10, z: 0 } },
    ],
  };

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'template-loader-'));
    templatesDir = path.join(testDir, 'templates');
    configDir = path.join(testDir, 'config');
    await fs.mkdir(templatesDir, { recursive: true });
    await fs.mkdir(configDir, { recursive: true });

    // Write config
    await fs.writeFile(
      path.join(configDir, 'templates.json'),
      JSON.stringify(sampleConfig),
    );

    // Write space template data
    await fs.writeFile(
      path.join(templatesDir, 'default-space.json'),
      JSON.stringify(spaceTemplate),
    );

    loader = new TemplateLoader(testDir, './templates');
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('loadConfig', () => {
    it('should load templates config from JSON file', async () => {
      await loader.loadConfig();

      const templates = loader.listTemplates();
      expect(templates).toHaveLength(3);
    });

    it('should handle missing config file gracefully', async () => {
      const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'empty-'));
      const emptyLoader = new TemplateLoader(emptyDir, './templates');

      await emptyLoader.loadConfig();
      expect(emptyLoader.listTemplates()).toHaveLength(0);

      await fs.rm(emptyDir, { recursive: true, force: true }).catch(() => {});
    });
  });

  describe('listTemplates', () => {
    it('should list all templates', async () => {
      await loader.loadConfig();

      const templates = loader.listTemplates();
      expect(templates).toHaveLength(3);
      expect(templates.map(t => t.name)).toEqual(['default-space', 'earth-planet', 'sandbox']);
    });

    it('should filter by world type', async () => {
      await loader.loadConfig();

      const spaceTemplates = loader.listTemplates('space');
      expect(spaceTemplates).toHaveLength(2); // default-space + sandbox
      expect(spaceTemplates.every(t => t.allowedTypes.includes('space'))).toBe(true);
    });

    it('should filter by planet type', async () => {
      await loader.loadConfig();

      const planetTemplates = loader.listTemplates('planet');
      expect(planetTemplates).toHaveLength(2); // earth-planet + sandbox
    });
  });

  describe('getTemplate', () => {
    it('should return template by name', async () => {
      await loader.loadConfig();

      const template = loader.getTemplate('default-space');
      expect(template).not.toBeNull();
      expect(template!.name).toBe('default-space');
      expect(template!.description).toBe('Empty space world');
    });

    it('should return null for non-existent template', async () => {
      await loader.loadConfig();
      expect(loader.getTemplate('nonexistent')).toBeNull();
    });
  });

  describe('validateTemplate', () => {
    it('should validate template for allowed world type', async () => {
      await loader.loadConfig();

      const result = loader.validateTemplate('default-space', 'space');
      expect(result.valid).toBe(true);
    });

    it('should reject template for disallowed world type', async () => {
      await loader.loadConfig();

      const result = loader.validateTemplate('default-space', 'planet');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject non-existent template', async () => {
      await loader.loadConfig();

      const result = loader.validateTemplate('nonexistent', 'space');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('loadTemplateData', () => {
    it('should load template data from file', async () => {
      await loader.loadConfig();

      const data = await loader.loadTemplateData('default-space');
      expect(data).not.toBeNull();
      expect(data!.metadata.name).toBe('My Space World');
      expect(data!.metadata.type).toBe('space');
      expect(data!.entityTemplates).toHaveLength(1);
      expect(data!.entities).toHaveLength(1);
    });

    it('should return null for non-existent template', async () => {
      await loader.loadConfig();
      expect(await loader.loadTemplateData('nonexistent')).toBeNull();
    });
  });
});
