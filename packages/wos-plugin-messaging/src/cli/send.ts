// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export function formatOutput(result: SendResult): string {
  if (result.success) {
    return `Message sent successfully (${result.messageId})`;
  }
  return `Error: ${result.error ?? 'unknown error'}`;
}

export function formatJson(result: SendResult): string {
  return JSON.stringify(result, null, 2);
}
