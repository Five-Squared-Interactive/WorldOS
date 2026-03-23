/**
 * Presence Kick Command
 *
 * Story 11.2: Presence CLI Commands
 *
 * Kicks a user from the server.
 */

/**
 * Kick command options
 */
export interface KickOptions {
  /** User ID to kick */
  userId: string;
  /** Reason for the kick */
  reason?: string;
  /** Output as JSON */
  json?: boolean;
}

/**
 * Kick command result
 */
export interface KickResult {
  success: boolean;
  userId: string;
  reason?: string;
  error?: string;
}

/**
 * Format kick result for display
 */
export function formatKickOutput(result: KickResult): string {
  if (result.success) {
    const reason = result.reason ? ` (reason: ${result.reason})` : '';
    return `User ${result.userId} has been kicked${reason}`;
  }

  return `Failed to kick user ${result.userId}: ${result.error || 'Unknown error'}`;
}

/**
 * Format kick result as JSON
 */
export function formatKickJson(result: KickResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Create kick request message
 */
export function createKickRequest(options: KickOptions): {
  type: 'kick';
  userId: string;
  reason?: string;
} {
  return {
    type: 'kick',
    userId: options.userId,
    reason: options.reason,
  };
}

/**
 * Format kick output
 */
export function formatKick(result: KickResult, options: KickOptions): string {
  if (options.json) {
    return formatKickJson(result);
  }
  return formatKickOutput(result);
}
