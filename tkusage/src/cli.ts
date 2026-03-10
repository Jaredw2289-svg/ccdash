import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    renderReport,
    renderStatusline
} from './format';
import { loadUsageData } from './load';
import {
    buildReport,
    buildStatusline
} from './report';
import type {
    ParsedUsageData,
    ReportType,
    SourceSelection
} from './types';

type CommandType = ReportType | 'statusline';
type StatuslineFormat = 'json' | 'plain';

export interface CliOptions {
    breakdown: boolean;
    claudeHome?: string;
    codexHome?: string;
    command: CommandType;
    compact: boolean;
    json: boolean;
    locale?: string;
    order: 'asc' | 'desc';
    period?: string;
    sessionFilter?: string;
    since?: string;
    source: SourceSelection;
    statuslineFormat: StatuslineFormat;
    timezone: string;
    until?: string;
}

interface CliDependencies {
    loadUsageData: (options: {
        claudeHome?: string;
        codexHome?: string;
        source: SourceSelection;
    }) => ParsedUsageData;
    version: string;
}

function getPackageVersion(): string {
    try {
        const currentFilePath = fileURLToPath(import.meta.url);
        const packageJsonPath = path.resolve(path.dirname(currentFilePath), '..', 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: string };
        return typeof packageJson.version === 'string' && packageJson.version.trim() !== ''
            ? packageJson.version
            : 'dev';
    } catch {
        return 'dev';
    }
}

const DEFAULT_DEPENDENCIES: CliDependencies = {
    loadUsageData,
    version: getPackageVersion()
};

function printHelp(version: string): string {
    return `tkusage v${version}

Usage:
  tkusage [daily] [YYYY-MM-DD] [options]
  tkusage monthly [YYYY-MM] [options]
  tkusage session [session-id] [options]
  tkusage statusline [options]

Options:
  --source <all|claude|codex>  Select log source (default: all)
  --since <YYYY-MM-DD>         Filter by start day (inclusive)
  --until <YYYY-MM-DD>         Filter by end day (inclusive)
  --timezone <IANA name>       Group usage in the given timezone
  --locale <locale>            Locale used for human-readable timestamps
  --json                       Emit JSON instead of a table
  --compact                    Use compact number formatting
  --breakdown                  Include per-model breakdowns
  --order <asc|desc>           Sort report rows (default: desc)
  --claude-home <path>         Override Claude home for transcript discovery
  --codex-home <path>          Override Codex home for session discovery
  --format <plain|json>        Statusline output format (default: plain)
  --help                       Show this message
  --version                    Show the CLI version`;
}

function requireValue(args: string[], index: number, flag: string): string {
    const value = args[index + 1];
    if (!value || value.startsWith('-')) {
        throw new Error(`${flag} requires a value`);
    }

    return value;
}

function isSourceSelection(value: string): value is SourceSelection {
    return value === 'all' || value === 'claude' || value === 'codex';
}

export function parseArgs(argv: string[], version = '0.1.0'): CliOptions {
    const args = [...argv];
    let command: CommandType = 'daily';
    let period: string | undefined;
    let sessionFilter: string | undefined;
    let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    let locale: string | undefined;
    let json = false;
    let compact = false;
    let breakdown = false;
    let order: 'asc' | 'desc' = 'desc';
    let since: string | undefined;
    let until: string | undefined;
    let source: SourceSelection = 'all';
    let claudeHome: string | undefined;
    let codexHome: string | undefined;
    let statuslineFormat: StatuslineFormat = 'plain';

    const first = args[0];
    if (first === '--help' || first === '-h') {
        console.log(printHelp(version));
        process.exit(0);
    }

    if (first === '--version' || first === '-v') {
        console.log(version);
        process.exit(0);
    }

    if (first === 'daily' || first === 'monthly' || first === 'session' || first === 'statusline') {
        command = first;
        args.shift();
    }

    if (command !== 'statusline' && args[0] && !args[0].startsWith('-')) {
        if (command === 'session') {
            sessionFilter = args[0];
        } else {
            period = args[0];
        }
        args.shift();
    }

    for (let index = 0; index < args.length; index++) {
        const arg = args[index];

        switch (arg) {
            case '--help':
            case '-h':
                console.log(printHelp(version));
                process.exit(0);
                break;
            case '--version':
            case '-v':
                console.log(version);
                process.exit(0);
                break;
            case '--source': {
                const value = requireValue(args, index, '--source');
                if (!isSourceSelection(value)) {
                    throw new Error(`--source must be all, claude, or codex. Received: ${value}`);
                }
                source = value;
                index++;
                break;
            }
            case '--since':
                since = requireValue(args, index, '--since');
                index++;
                break;
            case '--until':
                until = requireValue(args, index, '--until');
                index++;
                break;
            case '--timezone':
                timezone = requireValue(args, index, '--timezone');
                index++;
                break;
            case '--locale':
                locale = requireValue(args, index, '--locale');
                index++;
                break;
            case '--json':
                json = true;
                break;
            case '--compact':
                compact = true;
                break;
            case '--breakdown':
                breakdown = true;
                break;
            case '--order': {
                const value = requireValue(args, index, '--order');
                if (value !== 'asc' && value !== 'desc') {
                    throw new Error(`--order must be asc or desc, received: ${value}`);
                }
                order = value;
                index++;
                break;
            }
            case '--claude-home':
                claudeHome = requireValue(args, index, '--claude-home');
                index++;
                break;
            case '--codex-home':
                codexHome = requireValue(args, index, '--codex-home');
                index++;
                break;
            case '--format': {
                const value = requireValue(args, index, '--format');
                if (value !== 'plain' && value !== 'json') {
                    throw new Error(`--format must be plain or json, received: ${value}`);
                }
                statuslineFormat = value;
                index++;
                break;
            }
            case '--id':
                sessionFilter = requireValue(args, index, '--id');
                index++;
                break;
            case '--mode':
                index++;
                break;
            case '--offline':
            case '-O':
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return {
        breakdown,
        claudeHome,
        codexHome,
        command,
        compact,
        json,
        locale,
        order,
        period,
        sessionFilter,
        since,
        source,
        statuslineFormat,
        timezone,
        until
    };
}

export function createCliOutput(
    options: CliOptions,
    dependencies: CliDependencies = DEFAULT_DEPENDENCIES
): string {
    const data = dependencies.loadUsageData({
        claudeHome: options.claudeHome,
        codexHome: options.codexHome,
        source: options.source
    });

    if (options.command === 'statusline') {
        const statusline = buildStatusline(data, {
            selectedSource: options.source,
            timezone: options.timezone
        });
        return options.statuslineFormat === 'json'
            ? JSON.stringify(statusline, null, 2)
            : renderStatusline(statusline, options.locale);
    }

    const report = buildReport(data, {
        reportType: options.command,
        selectedSource: options.source,
        period: options.period,
        sessionFilter: options.sessionFilter,
        since: options.since,
        until: options.until,
        timezone: options.timezone,
        locale: options.locale,
        compact: options.compact,
        breakdown: options.breakdown,
        order: options.order
    });

    return options.json ? JSON.stringify(report, null, 2) : renderReport(report);
}

export function runCli(
    argv: string[],
    dependencies: CliDependencies = DEFAULT_DEPENDENCIES
): string {
    const options = parseArgs(argv, dependencies.version);
    return createCliOutput(options, dependencies);
}

export function main(argv: string[] = process.argv.slice(2)): void {
    try {
        const output = runCli(argv);
        console.log(output);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`tkusage: ${message}`);
        process.exit(1);
    }
}