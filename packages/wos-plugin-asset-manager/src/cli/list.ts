// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export interface ListAssetSummary {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
}

export interface ListResult {
  assets: ListAssetSummary[];
}

export function formatOutput(result: ListResult): string {
  if (result.assets.length === 0) {
    return 'No assets found.';
  }

  const header = `${'ID'.padEnd(38)}${'Name'.padEnd(24)}${'Type'.padEnd(10)}${'Size'.padEnd(10)}Created`;
  const separator = '-'.repeat(header.length);
  const rows = result.assets.map(a =>
    `${a.id.padEnd(38)}${a.name.padEnd(24)}${a.type.padEnd(10)}${String(a.size).padEnd(10)}${a.createdAt}`,
  );

  return [header, separator, ...rows].join('\n');
}

export function formatJson(result: ListResult): string {
  return JSON.stringify(result, null, 2);
}
