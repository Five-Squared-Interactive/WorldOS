// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export interface UsageResult {
  usedBytes: number;
  totalBytes: number;
  assetCount: number;
}

export function formatOutput(result: UsageResult): string {
  return [
    `Used:   ${result.usedBytes} bytes`,
    `Total:  ${result.totalBytes} bytes`,
    `Assets: ${result.assetCount}`,
  ].join('\n');
}

export function formatJson(result: UsageResult): string {
  return JSON.stringify(result, null, 2);
}
