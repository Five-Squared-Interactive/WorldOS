// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  WorldType,
  WorldTemplateInfo,
  WorldTemplatesConfig,
  WorldTemplateData,
  ValidationResult,
} from './types.js';

export class TemplateLoader {
  private serverDir: string;
  private templatesPath: string;
  private templates: WorldTemplateInfo[] = [];

  constructor(serverDir: string, templatesPath: string) {
    this.serverDir = serverDir;
    this.templatesPath = templatesPath;
  }

  async loadConfig(): Promise<void> {
    const configPath = path.join(this.serverDir, 'config', 'templates.json');
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const config: WorldTemplatesConfig = JSON.parse(content);
      this.templates = config.templates ?? [];
    } catch {
      this.templates = [];
    }
  }

  listTemplates(worldType?: WorldType): WorldTemplateInfo[] {
    if (!worldType) return [...this.templates];
    return this.templates.filter(t => t.allowedTypes.includes(worldType));
  }

  getTemplate(name: string): WorldTemplateInfo | null {
    return this.templates.find(t => t.name === name) ?? null;
  }

  validateTemplate(name: string, worldType: WorldType): ValidationResult {
    const template = this.getTemplate(name);
    if (!template) {
      return { valid: false, error: `Template '${name}' not found` };
    }
    if (!template.allowedTypes.includes(worldType)) {
      return {
        valid: false,
        error: `Template '${name}' does not support world type '${worldType}'. Allowed: ${template.allowedTypes.join(', ')}`,
      };
    }
    return { valid: true };
  }

  async loadTemplateData(name: string): Promise<WorldTemplateData | null> {
    const template = this.getTemplate(name);
    if (!template) return null;

    const templatePath = path.join(this.serverDir, this.templatesPath, template.file);
    try {
      const content = await fs.readFile(templatePath, 'utf-8');
      return JSON.parse(content) as WorldTemplateData;
    } catch {
      return null;
    }
  }
}
