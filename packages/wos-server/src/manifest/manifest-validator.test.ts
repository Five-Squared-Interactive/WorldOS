/**
 * Manifest Validator Tests
 *
 * Story 4.7: Manifest Validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ManifestValidator, ValidationResult, ValidationError } from './manifest-validator.js';

describe('ManifestValidator', () => {
  let tempDir: string;
  let validator: ManifestValidator;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manifest-test-'));
    validator = new ManifestValidator();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('required fields', () => {
    it('should pass with all required fields', async () => {
      const manifest = {
        name: 'test-plugin',
        version: '1.0.0',
        runtime: 'node',
        entrypoint: './dist/index.js',
      };

      const result = validator.validate(manifest);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when name is missing', () => {
      const manifest = {
        version: '1.0.0',
        runtime: 'node',
        entrypoint: './dist/index.js',
      };

      const result = validator.validate(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'name',
          message: expect.stringMatching(/required/i),
        })
      );
    });

    it('should fail when version is missing', () => {
      const manifest = {
        name: 'test-plugin',
        runtime: 'node',
        entrypoint: './dist/index.js',
      };

      const result = validator.validate(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'version',
          message: expect.stringMatching(/required/i),
        })
      );
    });

    it('should fail when runtime is missing', () => {
      const manifest = {
        name: 'test-plugin',
        version: '1.0.0',
        entrypoint: './dist/index.js',
      };

      const result = validator.validate(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'runtime',
          message: expect.stringMatching(/required/i),
        })
      );
    });

    it('should fail when entrypoint is missing', () => {
      const manifest = {
        name: 'test-plugin',
        version: '1.0.0',
        runtime: 'node',
      };

      const result = validator.validate(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'entrypoint',
          message: expect.stringMatching(/required/i),
        })
      );
    });

    it('should collect all missing field errors', () => {
      const manifest = {};

      const result = validator.validate(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('type validation', () => {
    it('should fail when name is not a string', () => {
      const manifest = {
        name: 123,
        version: '1.0.0',
        runtime: 'node',
        entrypoint: './dist/index.js',
      };

      const result = validator.validate(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'name',
          message: expect.stringMatching(/string/i),
        })
      );
    });

    it('should fail when version is not a string', () => {
      const manifest = {
        name: 'test-plugin',
        version: 1.0,
        runtime: 'node',
        entrypoint: './dist/index.js',
      };

      const result = validator.validate(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'version',
          message: expect.stringMatching(/string/i),
        })
      );
    });

    it('should fail when runtime is not a valid type', () => {
      const manifest = {
        name: 'test-plugin',
        version: '1.0.0',
        runtime: 'invalid-runtime',
        entrypoint: './dist/index.js',
      };

      const result = validator.validate(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'runtime',
          message: expect.stringMatching(/node|python|binary|docker/i),
        })
      );
    });

    it('should accept valid runtime types', () => {
      const runtimes = ['node', 'python', 'binary', 'docker'];

      for (const runtime of runtimes) {
        const manifest = {
          name: 'test-plugin',
          version: '1.0.0',
          runtime,
          entrypoint: './dist/index.js',
        };

        const result = validator.validate(manifest);
        expect(result.valid).toBe(true);
      }
    });

    it('should fail when dependencies is not an array', () => {
      const manifest = {
        name: 'test-plugin',
        version: '1.0.0',
        runtime: 'node',
        entrypoint: './dist/index.js',
        dependencies: 'other-plugin',
      };

      const result = validator.validate(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'dependencies',
          message: expect.stringMatching(/array/i),
        })
      );
    });
  });

  describe('file existence checks', () => {
    it('should pass when entrypoint exists', async () => {
      // Create entrypoint file
      await fs.writeFile(path.join(tempDir, 'index.js'), 'module.exports = {}');

      const manifest = {
        name: 'test-plugin',
        version: '1.0.0',
        runtime: 'node',
        entrypoint: './index.js',
      };

      const result = await validator.validateWithFiles(manifest, tempDir);

      expect(result.valid).toBe(true);
    });

    it('should fail when entrypoint does not exist', async () => {
      const manifest = {
        name: 'test-plugin',
        version: '1.0.0',
        runtime: 'node',
        entrypoint: './nonexistent.js',
      };

      const result = await validator.validateWithFiles(manifest, tempDir);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'entrypoint',
          message: expect.stringMatching(/not found|does not exist/i),
        })
      );
    });

    it('should check CLI handler files exist', async () => {
      // Create entrypoint but not handler
      await fs.writeFile(path.join(tempDir, 'index.js'), 'module.exports = {}');

      const manifest = {
        name: 'test-plugin',
        version: '1.0.0',
        runtime: 'node',
        entrypoint: './index.js',
        cli: {
          commands: [
            { name: 'greet', handler: './commands/greet.js' },
          ],
        },
      };

      const result = await validator.validateWithFiles(manifest, tempDir);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'cli.commands[0].handler',
          message: expect.stringMatching(/not found|does not exist/i),
        })
      );
    });

    it('should pass when CLI handler files exist', async () => {
      // Create all required files
      await fs.writeFile(path.join(tempDir, 'index.js'), 'module.exports = {}');
      await fs.mkdir(path.join(tempDir, 'commands'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'commands', 'greet.js'), 'module.exports = {}');

      const manifest = {
        name: 'test-plugin',
        version: '1.0.0',
        runtime: 'node',
        entrypoint: './index.js',
        cli: {
          commands: [
            { name: 'greet', handler: './commands/greet.js' },
          ],
        },
      };

      const result = await validator.validateWithFiles(manifest, tempDir);

      expect(result.valid).toBe(true);
    });
  });

  describe('CLI command schema', () => {
    it('should validate CLI command structure', () => {
      const manifest = {
        name: 'test-plugin',
        version: '1.0.0',
        runtime: 'node',
        entrypoint: './dist/index.js',
        cli: {
          commands: [
            { name: 'greet', handler: './commands/greet.js', description: 'Say hello' },
          ],
        },
      };

      const result = validator.validate(manifest);

      expect(result.valid).toBe(true);
    });

    it('should fail when CLI command is missing name', () => {
      const manifest = {
        name: 'test-plugin',
        version: '1.0.0',
        runtime: 'node',
        entrypoint: './dist/index.js',
        cli: {
          commands: [
            { handler: './commands/greet.js' },
          ],
        },
      };

      const result = validator.validate(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'cli.commands[0].name',
          message: expect.stringMatching(/required/i),
        })
      );
    });

    it('should fail when CLI command is missing handler', () => {
      const manifest = {
        name: 'test-plugin',
        version: '1.0.0',
        runtime: 'node',
        entrypoint: './dist/index.js',
        cli: {
          commands: [
            { name: 'greet' },
          ],
        },
      };

      const result = validator.validate(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'cli.commands[0].handler',
          message: expect.stringMatching(/required/i),
        })
      );
    });
  });

  describe('MQTT topic validation', () => {
    it('should accept valid MQTT topic patterns', () => {
      const manifest = {
        name: 'test-plugin',
        version: '1.0.0',
        runtime: 'node',
        entrypoint: './dist/index.js',
        mqtt: {
          subscriptions: [
            'wos/presence/+/status',
            'wos/world/#',
          ],
          publications: [
            'wos/presence/user/status',
          ],
        },
      };

      const result = validator.validate(manifest);

      expect(result.valid).toBe(true);
    });

    it('should fail when MQTT topics is not an array', () => {
      const manifest = {
        name: 'test-plugin',
        version: '1.0.0',
        runtime: 'node',
        entrypoint: './dist/index.js',
        mqtt: {
          subscriptions: 'wos/presence/+/status',
        },
      };

      const result = validator.validate(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'mqtt.subscriptions',
          message: expect.stringMatching(/array/i),
        })
      );
    });
  });

  describe('error suggestions', () => {
    it('should suggest fix for common typos', () => {
      const manifest = {
        name: 'test-plugin',
        version: '1.0.0',
        runtime: 'nodejs', // typo - should be 'node'
        entrypoint: './dist/index.js',
      };

      const result = validator.validate(manifest);

      expect(result.valid).toBe(false);
      const runtimeError = result.errors.find(e => e.field === 'runtime');
      expect(runtimeError?.suggestion).toBeDefined();
      expect(runtimeError?.suggestion).toContain('node');
    });
  });

  describe('version format', () => {
    it('should accept valid semver versions', () => {
      const versions = ['1.0.0', '0.1.0', '10.20.30', '1.0.0-alpha', '1.0.0+build'];

      for (const version of versions) {
        const manifest = {
          name: 'test-plugin',
          version,
          runtime: 'node',
          entrypoint: './dist/index.js',
        };

        const result = validator.validate(manifest);
        expect(result.valid).toBe(true);
      }
    });

    it('should warn for non-semver versions', () => {
      const manifest = {
        name: 'test-plugin',
        version: 'latest',
        runtime: 'node',
        entrypoint: './dist/index.js',
      };

      const result = validator.validate(manifest);

      // Should pass but have a warning
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          field: 'version',
          message: expect.stringMatching(/semver/i),
        })
      );
    });
  });

  describe('name format', () => {
    it('should accept valid plugin names', () => {
      const names = ['my-plugin', 'plugin123', 'my_plugin', '@scope/plugin'];

      for (const name of names) {
        const manifest = {
          name,
          version: '1.0.0',
          runtime: 'node',
          entrypoint: './dist/index.js',
        };

        const result = validator.validate(manifest);
        expect(result.valid).toBe(true);
      }
    });

    it('should fail for invalid plugin names', () => {
      const manifest = {
        name: 'My Plugin!', // spaces and special chars
        version: '1.0.0',
        runtime: 'node',
        entrypoint: './dist/index.js',
      };

      const result = validator.validate(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'name',
          message: expect.stringMatching(/invalid|format/i),
        })
      );
    });
  });
});
