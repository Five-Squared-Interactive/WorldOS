// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

export interface InfoResult {
  name: string;
  type: string;
  owner: string;
  entityCount: number;
  templateCount: number;
  initialized: boolean;
}

export function formatOutput(result: InfoResult): string {
  if (!result.initialized) {
    return 'World Status: not initialized\n\nRun `wos world init` to initialize a world.';
  }

  return [
    `World: ${result.name}`,
    `Type: ${result.type}`,
    `Owner: ${result.owner}`,
    `Entities: ${result.entityCount}`,
    `Templates: ${result.templateCount}`,
  ].join('\n');
}

export function formatJson(result: InfoResult): string {
  return JSON.stringify(result, null, 2);
}
