/**
 * Completion Command
 *
 * Story 3.10: Shell Completion
 *
 * Generates shell completion scripts for bash, zsh, and PowerShell.
 */

import { Command, Args } from '@oclif/core';

/**
 * Bash completion script template
 */
const bashCompletion = `
_wos_completions() {
    local cur="\${COMP_WORDS[COMP_CWORD]}"
    local commands="init start stop restart status completion version"

    if [[ \${COMP_CWORD} == 1 ]]; then
        COMPREPLY=($(compgen -W "\${commands}" -- "\${cur}"))
    else
        local cmd="\${COMP_WORDS[1]}"
        case "\${cmd}" in
            start|stop|restart|status|init)
                local opts="-d --directory -h --help"
                case "\${cmd}" in
                    start) opts="\${opts} -f --foreground -p --port --dry-run" ;;
                    stop) opts="\${opts} -f --force -t --timeout --dry-run --json" ;;
                    restart) opts="\${opts} --plugin --dry-run --json" ;;
                    status) opts="\${opts} --json" ;;
                    init) opts="\${opts} --template -f --force" ;;
                esac
                COMPREPLY=($(compgen -W "\${opts}" -- "\${cur}"))
                ;;
        esac
    fi
}

complete -F _wos_completions wos
`.trim();

/**
 * Zsh completion script template
 */
const zshCompletion = `
#compdef wos

_wos() {
    local line state

    _arguments -C \\
        "1: :->cmds" \\
        "*::arg:->args"

    case "\$state" in
        cmds)
            _values "wos command" \\
                "init[Initialize a new WorldOS server]" \\
                "start[Start the WorldOS server]" \\
                "stop[Stop the WorldOS server]" \\
                "restart[Restart the WorldOS server or a plugin]" \\
                "status[Show WorldOS server and plugin status]" \\
                "completion[Generate shell completion scripts]" \\
                "version[Show CLI version]"
            ;;
        args)
            case \$line[1] in
                start)
                    _arguments \\
                        "(-d --directory)"{-d,--directory}"[Server directory]:directory:_files -/" \\
                        "(-f --foreground)"{-f,--foreground}"[Run in foreground]" \\
                        "(-p --port)"{-p,--port}"[Server port]:port" \\
                        "--dry-run[Show what would happen without starting]"
                    ;;
                stop)
                    _arguments \\
                        "(-d --directory)"{-d,--directory}"[Server directory]:directory:_files -/" \\
                        "(-f --force)"{-f,--force}"[Force immediate shutdown]" \\
                        "(-t --timeout)"{-t,--timeout}"[Graceful shutdown timeout]:seconds" \\
                        "--dry-run[Show what would happen without stopping]" \\
                        "--json[Output in JSON format]"
                    ;;
                restart)
                    _arguments \\
                        "(-d --directory)"{-d,--directory}"[Server directory]:directory:_files -/" \\
                        "--plugin[Plugin name to restart]:plugin" \\
                        "--dry-run[Show what would happen without restarting]" \\
                        "--json[Output in JSON format]"
                    ;;
                status)
                    _arguments \\
                        "(-d --directory)"{-d,--directory}"[Server directory]:directory:_files -/" \\
                        "--json[Output in JSON format]"
                    ;;
                init)
                    _arguments \\
                        "(-d --directory)"{-d,--directory}"[Server directory]:directory:_files -/" \\
                        "--template[Template to use]:template:(default minimal)" \\
                        "(-f --force)"{-f,--force}"[Overwrite existing files]"
                    ;;
                completion)
                    _arguments \\
                        "1:shell:(bash zsh powershell fish)"
                    ;;
            esac
            ;;
    esac
}

_wos "\$@"
`.trim();

/**
 * PowerShell completion script template
 */
const powershellCompletion = `
# WorldOS CLI completion for PowerShell

$scriptBlock = {
    param($wordToComplete, $commandAst, $cursorPosition)

    $commands = @{
        'init' = @{
            description = 'Initialize a new WorldOS server'
            flags = @('-d', '--directory', '--template', '-f', '--force', '-h', '--help')
        }
        'start' = @{
            description = 'Start the WorldOS server'
            flags = @('-d', '--directory', '-f', '--foreground', '-p', '--port', '--dry-run', '-h', '--help')
        }
        'stop' = @{
            description = 'Stop the WorldOS server'
            flags = @('-d', '--directory', '-f', '--force', '-t', '--timeout', '--dry-run', '--json', '-h', '--help')
        }
        'restart' = @{
            description = 'Restart the WorldOS server or a plugin'
            flags = @('-d', '--directory', '--plugin', '--dry-run', '--json', '-h', '--help')
        }
        'status' = @{
            description = 'Show WorldOS server and plugin status'
            flags = @('-d', '--directory', '--json', '-h', '--help')
        }
        'completion' = @{
            description = 'Generate shell completion scripts'
            flags = @('-h', '--help')
        }
        'version' = @{
            description = 'Show CLI version'
            flags = @('-h', '--help')
        }
    }

    $tokens = $commandAst.CommandElements

    if ($tokens.Count -eq 1) {
        # Complete command names
        $commands.Keys | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $commands[$_].description)
        }
    } elseif ($tokens.Count -ge 2) {
        # Complete flags for the command
        $cmd = $tokens[1].Value
        if ($commands.ContainsKey($cmd)) {
            $commands[$cmd].flags | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
            }
        }
    }
}

Register-ArgumentCompleter -Native -CommandName wos -ScriptBlock $scriptBlock
`.trim();

/**
 * Fish completion script template
 */
const fishCompletion = `
# WorldOS CLI completion for Fish

# Disable file completions for wos
complete -c wos -f

# Commands
complete -c wos -n '__fish_use_subcommand' -a init -d 'Initialize a new WorldOS server'
complete -c wos -n '__fish_use_subcommand' -a start -d 'Start the WorldOS server'
complete -c wos -n '__fish_use_subcommand' -a stop -d 'Stop the WorldOS server'
complete -c wos -n '__fish_use_subcommand' -a restart -d 'Restart the WorldOS server or a plugin'
complete -c wos -n '__fish_use_subcommand' -a status -d 'Show WorldOS server and plugin status'
complete -c wos -n '__fish_use_subcommand' -a completion -d 'Generate shell completion scripts'
complete -c wos -n '__fish_use_subcommand' -a version -d 'Show CLI version'

# init flags
complete -c wos -n '__fish_seen_subcommand_from init' -s d -l directory -d 'Server directory'
complete -c wos -n '__fish_seen_subcommand_from init' -l template -d 'Template to use'
complete -c wos -n '__fish_seen_subcommand_from init' -s f -l force -d 'Overwrite existing files'

# start flags
complete -c wos -n '__fish_seen_subcommand_from start' -s d -l directory -d 'Server directory'
complete -c wos -n '__fish_seen_subcommand_from start' -s f -l foreground -d 'Run in foreground'
complete -c wos -n '__fish_seen_subcommand_from start' -s p -l port -d 'Server port'
complete -c wos -n '__fish_seen_subcommand_from start' -l dry-run -d 'Show what would happen'

# stop flags
complete -c wos -n '__fish_seen_subcommand_from stop' -s d -l directory -d 'Server directory'
complete -c wos -n '__fish_seen_subcommand_from stop' -s f -l force -d 'Force immediate shutdown'
complete -c wos -n '__fish_seen_subcommand_from stop' -s t -l timeout -d 'Graceful shutdown timeout'
complete -c wos -n '__fish_seen_subcommand_from stop' -l dry-run -d 'Show what would happen'
complete -c wos -n '__fish_seen_subcommand_from stop' -l json -d 'Output in JSON format'

# restart flags
complete -c wos -n '__fish_seen_subcommand_from restart' -s d -l directory -d 'Server directory'
complete -c wos -n '__fish_seen_subcommand_from restart' -l plugin -d 'Plugin name to restart'
complete -c wos -n '__fish_seen_subcommand_from restart' -l dry-run -d 'Show what would happen'
complete -c wos -n '__fish_seen_subcommand_from restart' -l json -d 'Output in JSON format'

# status flags
complete -c wos -n '__fish_seen_subcommand_from status' -s d -l directory -d 'Server directory'
complete -c wos -n '__fish_seen_subcommand_from status' -l json -d 'Output in JSON format'

# completion argument
complete -c wos -n '__fish_seen_subcommand_from completion' -a 'bash zsh powershell fish'
`.trim();

export default class Completion extends Command {
  static override description = 'Generate shell completion scripts';

  static override examples = [
    '<%= config.bin %> completion bash',
    '<%= config.bin %> completion zsh',
    '<%= config.bin %> completion powershell',
    '<%= config.bin %> completion fish',
    '# Bash: Add to ~/.bashrc',
    'eval "$(wos completion bash)"',
    '# Zsh: Add to ~/.zshrc',
    'eval "$(wos completion zsh)"',
    '# PowerShell: Add to $PROFILE',
    'wos completion powershell | Out-String | Invoke-Expression',
    '# Fish: Save to ~/.config/fish/completions/wos.fish',
    'wos completion fish > ~/.config/fish/completions/wos.fish',
  ];

  static override args = {
    shell: Args.string({
      description: 'Shell type (bash, zsh, powershell, fish)',
      required: true,
      options: ['bash', 'zsh', 'powershell', 'fish'],
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(Completion);

    switch (args.shell) {
      case 'bash':
        this.log(bashCompletion);
        break;
      case 'zsh':
        this.log(zshCompletion);
        break;
      case 'powershell':
        this.log(powershellCompletion);
        break;
      case 'fish':
        this.log(fishCompletion);
        break;
      default:
        this.error(`Unknown shell: ${args.shell}. Supported: bash, zsh, powershell, fish`);
    }
  }
}
