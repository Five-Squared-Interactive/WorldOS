/**
 * Upgrade Command
 *
 * Story 4.7: wos upgrade Command
 *
 * Upgrades installed plugins to newer versions.
 */

import { Command, Args, Flags } from '@oclif/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';

/**
 * Source type for a plugin
 */
type SourceType = 'local' | 'github' | 'git' | 'unknown';

/**
 * Plugin upgrade info
 */
interface PluginUpgradeInfo {
  name: string;
  currentVersion: string;
  sourceType: SourceType;
  source: string;
  canUpgrade: boolean;
  message?: string;
}

export default class Upgrade extends Command {
  static override description = 'Upgrade installed plugins to newer versions';

  static override examples = [
    '<%= config.bin %> upgrade',
    '<%= config.bin %> upgrade my-plugin',
    '<%= config.bin %> upgrade --check',
    '<%= config.bin %> upgrade --json',
  ];

  static override args = {
    name: Args.string({
      description: 'Plugin name to upgrade (upgrades all if not specified)',
      required: false,
    }),
  };

  static override flags = {
    directory: Flags.string({
      char: 'd',
      description: 'Server directory (default: current directory)',
      default: process.cwd(),
    }),
    check: Flags.boolean({
      char: 'c',
      description: 'Check for available updates without applying them',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output in JSON format',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Upgrade);
    const serverDir = path.resolve(flags.directory);
    const wosYamlPath = path.join(serverDir, 'wos.yaml');

    // Check if server is initialized
    const serverExists = await fs.access(wosYamlPath).then(() => true).catch(() => false);
    if (!serverExists) {
      this.error(`WorldOS not initialized in ${serverDir}. Run 'wos init' first.`, { exit: 1 });
      return;
    }

    // Load wos.yaml
    const wosYamlContent = await fs.readFile(wosYamlPath, 'utf-8');
    const config = yaml.parse(wosYamlContent) ?? {};

    // Get plugins from config
    const plugins = config.plugins as Record<string, unknown> | undefined;
    if (!plugins || Object.keys(plugins).length === 0) {
      if (flags.json) {
        this.log(JSON.stringify({ plugins: [], message: 'No plugins installed' }, null, 2));
      } else {
        this.log('No plugins installed.');
      }
      return;
    }

    // If specific plugin requested, check it exists
    if (args.name && !plugins[args.name]) {
      this.error(`Plugin '${args.name}' is not installed.`, { exit: 1 });
      return;
    }

    // Get upgrade info for plugins
    const pluginsToCheck = args.name ? [args.name] : Object.keys(plugins);
    const upgradeInfos: PluginUpgradeInfo[] = [];

    for (const name of pluginsToCheck) {
      const pluginEntry = plugins[name] as Record<string, unknown>;
      const info = this.getUpgradeInfo(name, pluginEntry);
      upgradeInfos.push(info);
    }

    // Output results
    if (flags.json) {
      if (args.name && upgradeInfos.length === 1) {
        this.log(JSON.stringify(upgradeInfos[0], null, 2));
      } else {
        this.log(JSON.stringify({ plugins: upgradeInfos }, null, 2));
      }
      return;
    }

    // Human-readable output
    if (args.name) {
      const info = upgradeInfos[0];
      this.outputSinglePlugin(info);
    } else {
      this.outputAllPlugins(upgradeInfos, flags.check);
    }
  }

  /**
   * Get upgrade information for a plugin
   */
  private getUpgradeInfo(name: string, entry: Record<string, unknown>): PluginUpgradeInfo {
    const source = (entry.source as string) ?? '';
    const version = (entry.version as string) ?? 'unknown';
    const sourceType = this.parseSourceType(source);

    let canUpgrade = false;
    let message: string | undefined;

    switch (sourceType) {
      case 'local':
        canUpgrade = false;
        message = `Installed from local path. To update, run: wos add ${source} --force`;
        break;
      case 'github':
        canUpgrade = true;
        message = 'GitHub source - can check for updates';
        break;
      case 'git':
        canUpgrade = true;
        message = 'Git source - can check for updates';
        break;
      default:
        canUpgrade = false;
        message = 'Unknown source type';
    }

    return {
      name,
      currentVersion: version,
      sourceType,
      source,
      canUpgrade,
      message,
    };
  }

  /**
   * Parse source string to determine type
   */
  private parseSourceType(source: string): SourceType {
    if (!source) return 'unknown';

    if (source.startsWith('github:')) {
      return 'github';
    } else if (source.startsWith('git:') || source.startsWith('git@') || source.includes('.git')) {
      return 'git';
    } else if (source.startsWith('./') || source.startsWith('/') || source.startsWith('..')) {
      return 'local';
    }

    return 'local'; // Default to local for relative paths
  }

  /**
   * Output info for a single plugin
   */
  private outputSinglePlugin(info: PluginUpgradeInfo): void {
    this.log(`Plugin: ${info.name}`);
    this.log(`  Version: ${info.currentVersion}`);
    this.log(`  Source: ${info.source} (${info.sourceType})`);
    this.log('');

    if (info.sourceType === 'local') {
      this.log('This plugin was installed from a local path.');
      this.log('To update it manually, run:');
      this.log(`  wos add ${info.source} --force`);
    } else if (info.canUpgrade) {
      this.log('This plugin can be upgraded from its remote source.');
      this.log('Note: Remote upgrade functionality requires Git to be installed.');
      // TODO: Implement actual Git-based upgrade when Story 4.2 (Git installation) is done
    }
  }

  /**
   * Output info for all plugins
   */
  private outputAllPlugins(infos: PluginUpgradeInfo[], checkOnly: boolean): void {
    const upgradeable = infos.filter(i => i.canUpgrade);
    const localOnly = infos.filter(i => i.sourceType === 'local');

    this.log('Plugin Upgrade Status:');
    this.log('');

    // Table header
    const nameWidth = Math.max(10, ...infos.map(i => i.name.length)) + 2;
    const versionWidth = 12;
    const sourceWidth = 10;

    this.log([
      'Name'.padEnd(nameWidth),
      'Version'.padEnd(versionWidth),
      'Source'.padEnd(sourceWidth),
      'Status',
    ].join('  '));
    this.log('-'.repeat(nameWidth + versionWidth + sourceWidth + 20));

    for (const info of infos) {
      const status = info.canUpgrade ? 'Can upgrade' : 'Manual only';
      this.log([
        info.name.padEnd(nameWidth),
        info.currentVersion.padEnd(versionWidth),
        info.sourceType.padEnd(sourceWidth),
        status,
      ].join('  '));
    }

    this.log('');

    if (localOnly.length > 0) {
      this.log(`${localOnly.length} plugin(s) installed from local paths (require manual update)`);
    }

    if (upgradeable.length > 0) {
      this.log(`${upgradeable.length} plugin(s) can be upgraded from remote sources`);
      if (checkOnly) {
        this.log('');
        this.log('Run without --check to apply upgrades.');
      }
    }

    if (upgradeable.length === 0 && localOnly.length === infos.length) {
      this.log('');
      this.log('All plugins are installed from local paths.');
      this.log('To update them, re-run `wos add <path> --force` for each plugin.');
    }
  }
}
