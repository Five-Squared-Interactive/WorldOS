/**
 * SDK Error Handling
 *
 * Story 2.6: SDK Error Handling
 *
 * Provides error types and utilities for plugin error handling.
 */

/**
 * Validation error item
 */
export interface ValidationErrorItem {
  field: string;
  message: string;
}

/**
 * Base error class for all plugin errors
 */
export class PluginError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly cause?: Error;

  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
    cause?: Error,
  ) {
    super(message);
    this.name = 'PluginError';
    this.code = code;
    this.details = details;
    this.cause = cause;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Serialize error to JSON-safe object
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

/**
 * Error for configuration issues
 */
export class ConfigurationError extends PluginError {
  readonly field?: string;

  constructor(message: string, field?: string, cause?: Error) {
    super('ERR_CONFIG', message, field ? { field } : undefined, cause);
    this.name = 'ConfigurationError';
    this.field = field;
  }
}

/**
 * Error for connection failures
 */
export class ConnectionError extends PluginError {
  readonly url?: string;

  constructor(message: string, url?: string, cause?: Error) {
    super('ERR_CONNECTION', message, url ? { url } : undefined, cause);
    this.name = 'ConnectionError';
    this.url = url;
  }
}

/**
 * Error for timeout situations
 */
export class TimeoutError extends PluginError {
  readonly timeout?: number;

  constructor(message: string, timeout?: number, cause?: Error) {
    super(
      'ERR_TIMEOUT',
      message,
      timeout !== undefined ? { timeout } : undefined,
      cause,
    );
    this.name = 'TimeoutError';
    this.timeout = timeout;
  }
}

/**
 * Error for validation failures
 */
export class ValidationError extends PluginError {
  readonly errors?: ValidationErrorItem[];

  constructor(
    message: string,
    errors?: ValidationErrorItem[],
    cause?: Error,
  ) {
    super(
      'ERR_VALIDATION',
      message,
      errors ? { errors } : undefined,
      cause,
    );
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/**
 * Check if a value is a PluginError
 */
export function isPluginError(value: unknown): value is PluginError {
  return value instanceof PluginError;
}

/**
 * Wrap any error as a PluginError
 *
 * @param error - The error to wrap
 * @param code - Error code to use (default: ERR_UNKNOWN)
 * @returns PluginError wrapping the original error
 */
export function wrapError(error: unknown, code = 'ERR_UNKNOWN'): PluginError {
  // Already a PluginError, return as-is
  if (isPluginError(error)) {
    return error;
  }

  // Error instance
  if (error instanceof Error) {
    return new PluginError(code, error.message, undefined, error);
  }

  // String
  if (typeof error === 'string') {
    return new PluginError(code, error);
  }

  // Unknown
  return new PluginError(code, 'An unknown error occurred', {
    originalError: String(error),
  });
}
