/**
 * Presence Count Command
 *
 * Story 11.2: Presence CLI Commands
 *
 * Gets online user count.
 */

/**
 * Count command options
 */
export interface CountOptions {
  /** Filter by world ID */
  worldId?: string;
  /** Output as JSON */
  json?: boolean;
}

/**
 * Count command result
 */
export interface CountResult {
  count: number;
  worldId?: string;
  worldCounts?: Record<string, number>;
}

/**
 * Format count result for display
 */
export function formatCountOutput(result: CountResult): string {
  const lines: string[] = [];

  if (result.worldId) {
    lines.push(`Users in world ${result.worldId}: ${result.count}`);
  } else {
    lines.push(`Total online users: ${result.count}`);

    if (result.worldCounts && Object.keys(result.worldCounts).length > 0) {
      lines.push('');
      lines.push('By world:');
      for (const [worldId, count] of Object.entries(result.worldCounts)) {
        lines.push(`  ${worldId}: ${count}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Format count result as JSON
 */
export function formatCountJson(result: CountResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Format count output
 */
export function formatCount(result: CountResult, options: CountOptions): string {
  if (options.json) {
    return formatCountJson(result);
  }
  return formatCountOutput(result);
}

/**
 * Execute count command
 */
export function executeCount(
  totalCount: number,
  worldCounts: Record<string, number>,
  options: CountOptions
): string {
  let result: CountResult;

  if (options.worldId) {
    result = {
      count: worldCounts[options.worldId] || 0,
      worldId: options.worldId,
    };
  } else {
    result = {
      count: totalCount,
      worldCounts,
    };
  }

  return formatCount(result, options);
}
