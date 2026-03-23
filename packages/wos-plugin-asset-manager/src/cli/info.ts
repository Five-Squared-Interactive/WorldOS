// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export interface AssetInfo {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
  mimeType: string;
  createdAt: string;
  createdBy: string;
}

export interface InfoResult {
  asset: AssetInfo | null;
}

export function formatOutput(result: InfoResult): string {
  if (!result.asset) {
    return 'Asset not found.';
  }

  const a = result.asset;
  return [
    `ID:         ${a.id}`,
    `Name:       ${a.name}`,
    `Type:       ${a.type}`,
    `MIME:       ${a.mimeType}`,
    `Size:       ${a.size}`,
    `URL:        ${a.url}`,
    `Created:    ${a.createdAt}`,
    `Created By: ${a.createdBy}`,
  ].join('\n');
}

export function formatJson(result: InfoResult): string {
  return JSON.stringify(result, null, 2);
}
