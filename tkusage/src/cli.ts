import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hasUsageCache } from './cache';
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
    mainThreadOnly: boolean;
    order: 'asc' | 'desc';
    openclawHome?: string;
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
        openclawHome?: string;
        mainThreadOnly?: boolean;
        source: SourceSelection;
    }) => ParsedUsageData;
    githubUrl?: string;
    version: string;
}

function getGithubUrlFromPackageJson(packageJson: Record<string, unknown>): string | undefined {
    const homepage = packageJson.homepage;
    if (typeof homepage === 'string' && homepage.includes('github.com')) {
        return homepage;
    }

    const repository = packageJson.repository;
    if (typeof repository === 'string' && repository.includes('github.com')) {
        return repository.replace(/^git\+/, '').replace(/\.git$/, '');
    }

    if (repository && typeof repository === 'object') {
        const repoUrl = (repository as { url?: unknown }).url;
        if (typeof repoUrl === 'string' && repoUrl.includes('github.com')) {
            return repoUrl.replace(/^git\+/, '').replace(/\.git$/, '');
        }
    }

    return undefined;
}

function getPackageMetadata(): { githubUrl?: string; version: string } {
    try {
        const currentFilePath = fileURLToPath(import.meta.url);
        const packageJsonPath = path.resolve(path.dirname(currentFilePath), '..', 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
        const version = typeof packageJson.version === 'string' && packageJson.version.trim() !== ''
            ? packageJson.version
            : 'dev';
        return {
            version,
            githubUrl: getGithubUrlFromPackageJson(packageJson)
        };
    } catch {
        return { version: 'dev' };
    }
}

const PACKAGE_METADATA = getPackageMetadata();

const DEFAULT_DEPENDENCIES: CliDependencies = {
    loadUsageData,
    githubUrl: PACKAGE_METADATA.githubUrl,
    version: PACKAGE_METADATA.version
};

function printHelp(version: string): string {
    return `tkusage v${version}

Usage:
  tkusage [daily] [YYYY-MM-DD] [options]
  tkusage monthly [YYYY-MM] [options]
  tkusage session [session-id] [options]
  tkusage statusline [options]

Options:
  --source <all|claude|codex|openclaw>  Select log source (default: all)
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
  --openclaw-home <path>       Override OpenClaw state dir for session discovery
  --main-thread-only           Claude only: exclude sidechains and subagents
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
    return value === 'all' || value === 'claude' || value === 'codex' || value === 'openclaw';
}

function getEstimatedDurationRange(options: CliOptions): string {
    const hasCache = hasUsageCache();

    if (options.command === 'statusline') {
        return hasCache ? '~2-5s' : '~20-40s';
    }

    if (options.command === 'session') {
        return hasCache ? '~4-8s' : '~25-45s';
    }

    if (options.source === 'codex') {
        return hasCache ? '~3-6s' : '~20-35s';
    }

    return hasCache ? '~4-10s' : '~30-50s';
}

function printStartupEstimate(options: CliOptions): void {
    if (!process.stderr.isTTY) {
        return;
    }

    const cacheState = hasUsageCache() ? 'warm cache' : 'first run';
    const estimate = getEstimatedDurationRange(options);
    process.stderr.write(
        `tkusage: loading ${options.source} ${options.command} data `
        + `(${cacheState}, estimated ${estimate})...\n`
    );
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
    let mainThreadOnly = false;
    let order: 'asc' | 'desc' = 'asc';
    let openclawHome: string | undefined;
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

    if (command === 'session') {
        order = 'desc';
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
                    throw new Error(`--source must be all, claude, codex, or openclaw. Received: ${value}`);
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
            case '--main-thread-only':
                mainThreadOnly = true;
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
            case '--openclaw-home':
                openclawHome = requireValue(args, index, '--openclaw-home');
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
        mainThreadOnly,
        order,
        openclawHome,
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
        mainThreadOnly: options.mainThreadOnly,
        openclawHome: options.openclawHome,
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

    return options.json
        ? JSON.stringify(report, null, 2)
        : renderReport(report, {
            footer: {
                commands: [
                    'tkusage daily --source all',
                    'tkusage daily --source all --since 2026-03-01 --until 2026-03-09'
                ],
                githubUrl: dependencies.githubUrl
            }
        });
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
        const options = parseArgs(argv);
        printStartupEstimate(options);
        const output = createCliOutput(options);
        console.log(output);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`tkusage: ${message}`);
        process.exit(1);
    }
}
