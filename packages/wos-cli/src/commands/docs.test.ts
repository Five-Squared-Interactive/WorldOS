/**
 * Docs Command Tests
 *
 * Story 8.5: Developer Documentation
 *
 * Tests for generating plugin documentation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import {
  generateDocs,
  DocGeneratorOptions,
  extractApiDocs,
  generateReadme,
  generateApiReference,
} from './docs.js';

describe('Docs Command', () => {
  let tmpDir: string;
  let pluginDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-docs-test-'));
    pluginDir = path.join(tmpDir, 'my-plugin');
    await fs.mkdir(pluginDir, { recursive: true });

    // Create a minimal plugin structure
    await fs.mkdir(path.join(pluginDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(pluginDir, 'wos-plugin.yaml'),
      yaml.stringify({
        name: 'my-plugin',
        version: '1.0.0',
        runtime: 'node',
        entrypoint: 'dist/index.js',
        description: 'A test plugin for demonstration',
        author: 'Test Author',
        cli: {
          commands: [
            {
              name: 'hello',
              description: 'Says hello',
              handler: 'dist/cli/hello.js',
            },
            {
              name: 'goodbye',
              description: 'Says goodbye',
              handler: 'dist/cli/goodbye.js',
            },
          ],
        },
        mqtt: {
          subscriptions: ['my-plugin/+/events'],
          publications: ['my-plugin/status'],
        },
      })
    );
    await fs.writeFile(
      path.join(pluginDir, 'package.json'),
      JSON.stringify({
        name: 'my-plugin',
        version: '1.0.0',
        description: 'A test plugin',
      })
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('generateDocs', () => {
    it('should generate documentation', async () => {
      const result = await generateDocs({
        pluginDir,
        outputDir: path.join(pluginDir, 'docs'),
      });

      expect(result.success).toBe(true);
    });

    it('should create docs directory', async () => {
      const docsDir = path.join(pluginDir, 'docs');

      await generateDocs({
        pluginDir,
        outputDir: docsDir,
      });

      const exists = await fs.access(docsDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should generate README if not exists', async () => {
      await generateDocs({
        pluginDir,
        outputDir: path.join(pluginDir, 'docs'),
        generateReadme: true,
      });

      const readmePath = path.join(pluginDir, 'README.md');
      const exists = await fs.access(readmePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should not overwrite existing README', async () => {
      await fs.writeFile(path.join(pluginDir, 'README.md'), '# Custom README');

      await generateDocs({
        pluginDir,
        outputDir: path.join(pluginDir, 'docs'),
        generateReadme: true,
      });

      const content = await fs.readFile(path.join(pluginDir, 'README.md'), 'utf-8');
      expect(content).toBe('# Custom README');
    });

    it('should overwrite README with force flag', async () => {
      await fs.writeFile(path.join(pluginDir, 'README.md'), '# Custom README');

      await generateDocs({
        pluginDir,
        outputDir: path.join(pluginDir, 'docs'),
        generateReadme: true,
        force: true,
      });

      const content = await fs.readFile(path.join(pluginDir, 'README.md'), 'utf-8');
      expect(content).not.toBe('# Custom README');
    });

    it('should report generated files', async () => {
      const result = await generateDocs({
        pluginDir,
        outputDir: path.join(pluginDir, 'docs'),
      });

      expect(result.files.length).toBeGreaterThan(0);
    });

    it('should fail for non-plugin directory', async () => {
      const emptyDir = path.join(tmpDir, 'empty');
      await fs.mkdir(emptyDir, { recursive: true });

      const result = await generateDocs({
        pluginDir: emptyDir,
        outputDir: path.join(emptyDir, 'docs'),
      });

      expect(result.success).toBe(false);
    });
  });

  describe('generateReadme', () => {
    it('should include plugin name as title', async () => {
      const readme = await generateReadme(pluginDir);

      expect(readme).toContain('# my-plugin');
    });

    it('should include description', async () => {
      const readme = await generateReadme(pluginDir);

      expect(readme).toContain('A test plugin for demonstration');
    });

    it('should include installation section', async () => {
      const readme = await generateReadme(pluginDir);

      expect(readme).toContain('## Installation');
      expect(readme).toContain('wos plugin add');
    });

    it('should include usage section', async () => {
      const readme = await generateReadme(pluginDir);

      expect(readme).toContain('## Usage');
    });

    it('should list CLI commands', async () => {
      const readme = await generateReadme(pluginDir);

      expect(readme).toContain('hello');
      expect(readme).toContain('goodbye');
      expect(readme).toContain('Says hello');
    });

    it('should include author if present', async () => {
      const readme = await generateReadme(pluginDir);

      expect(readme).toContain('Test Author');
    });

    it('should include version', async () => {
      const readme = await generateReadme(pluginDir);

      expect(readme).toContain('1.0.0');
    });
  });

  describe('generateApiReference', () => {
    it('should generate API reference', async () => {
      const api = await generateApiReference(pluginDir);

      expect(api).toBeDefined();
      expect(api.length).toBeGreaterThan(0);
    });

    it('should document MQTT topics', async () => {
      const api = await generateApiReference(pluginDir);

      expect(api).toContain('my-plugin/+/events');
      expect(api).toContain('my-plugin/status');
    });

    it('should document CLI commands', async () => {
      const api = await generateApiReference(pluginDir);

      expect(api).toContain('## CLI Commands');
      expect(api).toContain('hello');
    });

    it('should include subscriptions section', async () => {
      const api = await generateApiReference(pluginDir);

      expect(api).toContain('Subscriptions');
    });

    it('should include publications section', async () => {
      const api = await generateApiReference(pluginDir);

      expect(api).toContain('Publications');
    });
  });

  describe('extractApiDocs', () => {
    it('should extract CLI commands from manifest', async () => {
      const docs = await extractApiDocs(pluginDir);

      expect(docs.commands.length).toBe(2);
      expect(docs.commands[0].name).toBe('hello');
    });

    it('should extract MQTT subscriptions', async () => {
      const docs = await extractApiDocs(pluginDir);

      expect(docs.subscriptions).toContain('my-plugin/+/events');
    });

    it('should extract MQTT publications', async () => {
      const docs = await extractApiDocs(pluginDir);

      expect(docs.publications).toContain('my-plugin/status');
    });

    it('should handle missing CLI section', async () => {
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        yaml.stringify({
          name: 'simple-plugin',
          version: '1.0.0',
          runtime: 'node',
          entrypoint: 'dist/index.js',
        })
      );

      const docs = await extractApiDocs(pluginDir);

      expect(docs.commands).toEqual([]);
    });

    it('should handle missing MQTT section', async () => {
      await fs.writeFile(
        path.join(pluginDir, 'wos-plugin.yaml'),
        yaml.stringify({
          name: 'simple-plugin',
          version: '1.0.0',
          runtime: 'node',
          entrypoint: 'dist/index.js',
        })
      );

      const docs = await extractApiDocs(pluginDir);

      expect(docs.subscriptions).toEqual([]);
      expect(docs.publications).toEqual([]);
    });
  });

  describe('command metadata', () => {
    it('should have correct description', async () => {
      const { default: Docs } = await import('./docs.js');
      expect(Docs.description).toMatch(/document|generate|docs/i);
    });

    it('should have examples', async () => {
      const { default: Docs } = await import('./docs.js');
      expect(Docs.examples).toBeDefined();
      expect(Docs.examples.length).toBeGreaterThan(0);
    });

    it('should have --output flag', async () => {
      const { default: Docs } = await import('./docs.js');
      expect(Docs.flags.output).toBeDefined();
    });
  });
});
