// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export interface ListResult {
  services: Array<{
    id: string;
    name: string;
    image: string;
    instanceCount: number;
    runningCount: number;
  }>;
}

export function formatOutput(result: ListResult): string {
  if (result.services.length === 0) {
    return 'No services configured.';
  }

  const lines = ['Services:', ''];
  for (const svc of result.services) {
    const status = svc.runningCount === svc.instanceCount
      ? `${svc.runningCount}/${svc.instanceCount} running`
      : `${svc.runningCount}/${svc.instanceCount} running (${svc.instanceCount - svc.runningCount} stopped)`;
    lines.push(`  ${svc.id} (${svc.name})`);
    lines.push(`    Image: ${svc.image}`);
    lines.push(`    Instances: ${status}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function formatJson(result: ListResult): string {
  return JSON.stringify(result, null, 2);
}
