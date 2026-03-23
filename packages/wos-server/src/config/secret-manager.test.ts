/**
 * Secret Manager Tests
 *
 * Story 5-5: Secret Management
 *
 * Securely handles sensitive configuration values.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SecretManager, SecretReference } from './secret-manager.js';

describe('SecretManager', () => {
  let tempDir: string;
  let secretManager: SecretManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'secret-manager-test-'));
    secretManager = new SecretManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    // Clean up env vars
    delete process.env.TEST_SECRET;
    delete process.env.WOS_SECRET_DB_PASSWORD;
  });

  describe('isSecretReference', () => {
    it('should detect env: prefix', () => {
      expect(SecretManager.isSecretReference('env:MY_SECRET')).toBe(true);
    });

    it('should detect file: prefix', () => {
      expect(SecretManager.isSecretReference('file:/path/to/secret')).toBe(true);
    });

    it('should detect vault: prefix', () => {
      expect(SecretManager.isSecretReference('vault:secret/path')).toBe(true);
    });

    it('should not detect plain values', () => {
      expect(SecretManager.isSecretReference('plain-value')).toBe(false);
      expect(SecretManager.isSecretReference('123')).toBe(false);
      expect(SecretManager.isSecretReference('')).toBe(false);
    });
  });

  describe('parseReference', () => {
    it('should parse env reference', () => {
      const ref = SecretManager.parseReference('env:DB_PASSWORD');
      expect(ref).toEqual({
        type: 'env',
        source: 'DB_PASSWORD',
      });
    });

    it('should parse file reference', () => {
      const ref = SecretManager.parseReference('file:/etc/secrets/password');
      expect(ref).toEqual({
        type: 'file',
        source: '/etc/secrets/password',
      });
    });

    it('should parse vault reference', () => {
      const ref = SecretManager.parseReference('vault:secret/data/myapp#password');
      expect(ref).toEqual({
        type: 'vault',
        source: 'secret/data/myapp#password',
      });
    });

    it('should return null for non-reference values', () => {
      expect(SecretManager.parseReference('plain-value')).toBeNull();
    });
  });

  describe('resolveSecret', () => {
    it('should resolve env secret', async () => {
      process.env.TEST_SECRET = 'my-secret-value';

      const value = await secretManager.resolveSecret('env:TEST_SECRET');
      expect(value).toBe('my-secret-value');
    });

    it('should return undefined for missing env var', async () => {
      const value = await secretManager.resolveSecret('env:NONEXISTENT_SECRET');
      expect(value).toBeUndefined();
    });

    it('should resolve file secret', async () => {
      const secretFile = path.join(tempDir, 'secret.txt');
      await fs.writeFile(secretFile, 'file-secret-value');

      const value = await secretManager.resolveSecret(`file:${secretFile}`);
      expect(value).toBe('file-secret-value');
    });

    it('should trim whitespace from file secrets', async () => {
      const secretFile = path.join(tempDir, 'secret.txt');
      await fs.writeFile(secretFile, '  secret-with-whitespace  \n');

      const value = await secretManager.resolveSecret(`file:${secretFile}`);
      expect(value).toBe('secret-with-whitespace');
    });

    it('should return undefined for missing file', async () => {
      const value = await secretManager.resolveSecret('file:/nonexistent/path');
      expect(value).toBeUndefined();
    });

    it('should return undefined for unsupported reference type', async () => {
      const value = await secretManager.resolveSecret('vault:secret/path');
      expect(value).toBeUndefined();
    });

    it('should return plain value if not a reference', async () => {
      const value = await secretManager.resolveSecret('plain-value');
      expect(value).toBe('plain-value');
    });
  });

  describe('resolveConfigSecrets', () => {
    it('should resolve secrets in flat config', async () => {
      process.env.TEST_SECRET = 'resolved-secret';

      const config = {
        apiKey: 'env:TEST_SECRET',
        plainValue: 'not-a-secret',
      };

      const resolved = await secretManager.resolveConfigSecrets(config);

      expect(resolved.apiKey).toBe('resolved-secret');
      expect(resolved.plainValue).toBe('not-a-secret');
    });

    it('should resolve secrets in nested config', async () => {
      process.env.TEST_SECRET = 'nested-secret';

      const config = {
        database: {
          password: 'env:TEST_SECRET',
          host: 'localhost',
        },
      };

      const resolved = await secretManager.resolveConfigSecrets(config);

      expect((resolved.database as any).password).toBe('nested-secret');
      expect((resolved.database as any).host).toBe('localhost');
    });

    it('should resolve secrets in arrays', async () => {
      process.env.TEST_SECRET = 'array-secret';

      const config = {
        secrets: ['env:TEST_SECRET', 'plain-value'],
      };

      const resolved = await secretManager.resolveConfigSecrets(config);

      expect(resolved.secrets).toEqual(['array-secret', 'plain-value']);
    });

    it('should not modify original config', async () => {
      process.env.TEST_SECRET = 'resolved';

      const config = {
        apiKey: 'env:TEST_SECRET',
      };

      await secretManager.resolveConfigSecrets(config);

      expect(config.apiKey).toBe('env:TEST_SECRET');
    });
  });

  describe('maskSecrets', () => {
    it('should mask secret references in config', () => {
      const config = {
        apiKey: 'env:API_KEY',
        password: 'file:/etc/secrets/password',
        plainValue: 'visible',
      };

      const masked = SecretManager.maskSecrets(config);

      expect(masked.apiKey).toBe('***[env:API_KEY]***');
      expect(masked.password).toBe('***[file:/etc/secrets/password]***');
      expect(masked.plainValue).toBe('visible');
    });

    it('should mask nested secrets', () => {
      const config = {
        database: {
          password: 'env:DB_PASSWORD',
          host: 'localhost',
        },
      };

      const masked = SecretManager.maskSecrets(config);

      expect((masked.database as any).password).toBe('***[env:DB_PASSWORD]***');
      expect((masked.database as any).host).toBe('localhost');
    });
  });

  describe('WOS_SECRET_ prefix', () => {
    it('should allow access to WOS_SECRET_ prefixed env vars', async () => {
      process.env.WOS_SECRET_DB_PASSWORD = 'secure-password';

      const value = await secretManager.resolveSecret('env:WOS_SECRET_DB_PASSWORD');
      expect(value).toBe('secure-password');
    });

    it('should support shorthand without prefix', async () => {
      process.env.WOS_SECRET_DB_PASSWORD = 'secure-password';

      const value = await secretManager.resolveSecret('env:DB_PASSWORD');
      // Should also try with WOS_SECRET_ prefix
      expect(value).toBe('secure-password');
    });
  });

  describe('file path validation', () => {
    it('should resolve relative paths from secrets directory', async () => {
      const secretsDir = path.join(tempDir, '.secrets');
      await fs.mkdir(secretsDir);
      await fs.writeFile(path.join(secretsDir, 'api-key'), 'my-api-key');

      const manager = new SecretManager(tempDir);
      const value = await manager.resolveSecret('file:.secrets/api-key');

      expect(value).toBe('my-api-key');
    });
  });

  describe('validateSecretReferences', () => {
    it('should validate all secret references in config', async () => {
      process.env.TEST_SECRET = 'exists';
      const secretFile = path.join(tempDir, 'exists.txt');
      await fs.writeFile(secretFile, 'exists');

      const config = {
        validEnv: 'env:TEST_SECRET',
        validFile: `file:${secretFile}`,
        invalidEnv: 'env:DOES_NOT_EXIST',
        invalidFile: 'file:/does/not/exist',
        plain: 'not-a-secret',
      };

      const result = await secretManager.validateSecretReferences(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'invalidEnv',
          message: expect.stringMatching(/not found|missing/i),
        })
      );
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'invalidFile',
          message: expect.stringMatching(/not found|missing/i),
        })
      );
    });

    it('should return valid for config with no secret references', async () => {
      const config = {
        plainValue: 'not-a-secret',
        number: 123,
      };

      const result = await secretManager.validateSecretReferences(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
