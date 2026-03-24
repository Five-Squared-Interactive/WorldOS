/**
 * Error handling module exports
 */
export {
  PluginError,
  ConfigurationError,
  ConnectionError,
  TimeoutError,
  ValidationError,
  isPluginError,
  wrapError,
  type ValidationErrorItem,
} from './errors.js';
