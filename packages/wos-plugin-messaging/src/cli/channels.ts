// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export interface ChannelsResult {
  channels: Array<{
    id: string;
    name: string;
    worldId: string;
    createdBy: string;
    createdAt: string;
  }>;
}

export function formatOutput(result: ChannelsResult): string {
  if (result.channels.length === 0) {
    return 'No channels found.';
  }

  const header = `${'Name'.padEnd(24)}${'ID'.padEnd(38)}${'Created By'.padEnd(16)}Created`;
  const separator = '-'.repeat(header.length);
  const rows = result.channels.map(c =>
    `${c.name.slice(0, 22).padEnd(24)}${c.id.slice(0, 36).padEnd(38)}${c.createdBy.slice(0, 14).padEnd(16)}${c.createdAt}`,
  );

  return [header, separator, ...rows].join('\n');
}

export function formatJson(result: ChannelsResult): string {
  return JSON.stringify(result, null, 2);
}
