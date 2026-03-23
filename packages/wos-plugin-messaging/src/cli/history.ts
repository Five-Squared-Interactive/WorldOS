// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export interface HistoryResult {
  conversationId: string;
  messages: Array<{
    id: string;
    senderId: string;
    content: string;
    createdAt: string;
  }>;
}

export function formatOutput(result: HistoryResult): string {
  if (result.messages.length === 0) {
    return 'No messages found.';
  }

  return result.messages.map(m =>
    `[${m.createdAt}] ${m.senderId}: ${m.content}`,
  ).join('\n');
}

export function formatJson(result: HistoryResult): string {
  return JSON.stringify(result, null, 2);
}
