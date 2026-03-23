// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export interface ResetResult {
  success: boolean;
  name?: string;
  type?: string;
  error?: string;
}

export function formatOutput(result: ResetResult): string {
  if (!result.success) {
    return `Error: ${result.error}`;
  }

  return `World reset: ${result.name} (${result.type})`;
}

export function formatJson(result: ResetResult): string {
  return JSON.stringify(result, null, 2);
}
