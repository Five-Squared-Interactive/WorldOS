// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export interface InitResult {
  success: boolean;
  name?: string;
  type?: string;
  template?: string;
  error?: string;
}

export function formatOutput(result: InitResult): string {
  if (!result.success) {
    return `Error: ${result.error}`;
  }

  const lines = [`World initialized: ${result.name}`, `Type: ${result.type}`];
  if (result.template) {
    lines.push(`Template: ${result.template}`);
  }
  return lines.join('\n');
}

export function formatJson(result: InitResult): string {
  return JSON.stringify(result, null, 2);
}
