/**
 * SDK Logging Integration
 *
 * Story 2.7: SDK Logging Integration
 *
 * Provides structured logging with configurable levels for plugins.
 */

/**
 * Log levels in order of severity
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Logger interface
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(name: string): Logger;
  setLevel(level: LogLevel): void;
}

/**
 * Options for creating a logger
 */
export interface LoggerOptions {
  /** Log level for this logger (overrides global) */
  level?: LogLevel;
}

/**
 * Log level priority (higher = more severe)
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

/**
 * Global log level (can be overridden per-logger)
 */
let globalLogLevel: LogLevel = 'info';

/**
 * Set the global log level
 */
export function setGlobalLogLevel(level: LogLevel): void {
  globalLogLevel = level;
}

/**
 * Get the current global log level
 */
export function getGlobalLogLevel(): LogLevel {
  return globalLogLevel;
}

/**
 * Format metadata for log output
 */
function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) {
    return '';
  }

  try {
    // Handle Error objects specially
    const processed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(meta)) {
      if (value instanceof Error) {
        processed[key] = {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      } else {
        processed[key] = value;
      }
    }
    return ' ' + JSON.stringify(processed);
  } catch {
    return ' [meta serialization failed]';
  }
}

/**
 * Create a logger for a plugin
 *
 * @param pluginName - Name of the plugin (used as prefix)
 * @param options - Logger options
 * @returns Logger instance
 */
export function createLogger(
  pluginName: string,
  options: LoggerOptions = {},
): Logger {
  let logLevel = options.level;

  const shouldLog = (level: LogLevel): boolean => {
    const effectiveLevel = logLevel ?? globalLogLevel;
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[effectiveLevel];
  };

  const formatMessage = (
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): string => {
    const timestamp = new Date().toISOString();
    const metaStr = formatMeta(meta);
    return `${timestamp} ${level.toUpperCase()} [${pluginName}] ${message}${metaStr}`;
  };

  const logger: Logger = {
    debug(message: string, meta?: Record<string, unknown>): void {
      if (shouldLog('debug')) {
        console.debug(formatMessage('debug', message, meta));
      }
    },

    info(message: string, meta?: Record<string, unknown>): void {
      if (shouldLog('info')) {
        console.info(formatMessage('info', message, meta));
      }
    },

    warn(message: string, meta?: Record<string, unknown>): void {
      if (shouldLog('warn')) {
        console.warn(formatMessage('warn', message, meta));
      }
    },

    error(message: string, meta?: Record<string, unknown>): void {
      if (shouldLog('error')) {
        console.error(formatMessage('error', message, meta));
      }
    },

    child(name: string): Logger {
      return createLogger(`${pluginName}:${name}`, { level: logLevel });
    },

    setLevel(level: LogLevel): void {
      logLevel = level;
    },
  };

  return logger;
}
