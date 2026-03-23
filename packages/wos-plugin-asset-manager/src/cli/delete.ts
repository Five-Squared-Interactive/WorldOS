// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export interface DeleteResult {
  success: boolean;
  freedBytes?: number;
  error?: string;
}

export function formatOutput(result: DeleteResult): string {
  if (!result.success) {
    return `Error: ${result.error ?? 'Unknown error'}`;
  }
  return `Asset deleted. Freed ${result.freedBytes ?? 0} bytes.`;
}

export function formatJson(result: DeleteResult): string {
  return JSON.stringify(result, null, 2);
}
