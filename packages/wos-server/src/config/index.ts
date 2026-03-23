/**
 * Config Module
 *
 * Story 5.3: Environment Variable Support
 * Story 5.4: Config Hot-Reload
 * Story 5.5: Configuration Schema Validation
 */

export {
  ConfigManager,
  ConfigSchema,
  SchemaProperty,
  ConfigValidationError,
  ConfigValidationResult,
} from './config-manager.js';

export {
  ConfigNotifier,
  ConfigChangeEvent,
  ConfigResetEvent,
} from './config-notifier.js';

export {
  SecretManager,
  SecretReference,
  SecretValidationError,
  SecretValidationResult,
} from './secret-manager.js';
