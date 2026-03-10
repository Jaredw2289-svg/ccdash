#!/usr/bin/env node
import { renderReport } from './cdxusage/format';
import { parseCodexUsage } from './cdxusage/parser';
import { buildReport } from './cdxusage/report';
import { getPackageVersion } from './utils/terminal';

type ReportType = 'daily' | 'monthly' | 'session';

interface CliOptions {
    reportType: ReportType;
    period?: string;
    sessionFilter?: string;
    since?: string;
    until?: string;
    timezone: string;
    locale?: string;
    json: boolean;
    compact: boolean;
    breakdown: boolean;
    order: 'asc' | 'desc';
    codexHome?: string;
}

function printHelp(): void {
    console.log(`cdxusage v${getPackageVersion() || 'dev'}

Usage:
  cdxusage [daily] [YYYY-MM-DD] [options]
  cdxusage monthly [YYYY-MM] [options]
  cdxusage session [session-id] [options]

Options:
  --since <YYYY-MM-DD>     Filter by start day (inclusive)
  --until <YYYY-MM-DD>     Filter by end day (inclusive)
  --timezone <IANA name>   Group usage in the given timezone
  --locale <locale>        Locale used for human-readable timestamps
  --json                   Emit JSON instead of a table
  --compact                Use compact number formatting
  --breakdown              Include per-model breakdowns
  --order <asc|desc>       Sort report rows (default: desc)
  --codex-home <path>      Override CODEX_HOME for log discovery
  --help                   Show this message
  --version                Show the CLI version
`);
}

function requireValue(args: string[], index: number, flag: string): string {
    const value = args[index + 1];
    if (!value || value.startsWith('-')) {
        throw new Error(`${flag} requires a value`);
    }

    return value;
}

function parseArgs(argv: string[]): CliOptions {
    const args = [...argv];
    let reportType: ReportType = 'daily';
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
    let codexHome: string | undefined;

    const first = args[0];
    if (first === '--help' || first === '-h') {
        printHelp();
        process.exit(0);
    }

    if (first === '--version' || first === '-v') {
        console.log(getPackageVersion() || 'dev');
        process.exit(0);
    }

    if (first === 'daily' || first === 'monthly' || first === 'session') {
        reportType = first;
        args.shift();
    }

    if (args[0] && !args[0].startsWith('-')) {
        if (reportType === 'session') {
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
                printHelp();
                process.exit(0);
                break;
            case '--version':
            case '-v':
                console.log(getPackageVersion() || 'dev');
                process.exit(0);
                break;
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
            case '--codex-home':
                codexHome = requireValue(args, index, '--codex-home');
                index++;
                break;
            case '--id':
                sessionFilter = requireValue(args, index, '--id');
                index++;
                break;
            case '--mode':
            case '--offline':
            case '-O':
                if (arg === '--mode') {
                    index++;
                }
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return {
        reportType,
        period,
        sessionFilter,
        since,
        until,
        timezone,
        locale,
        json,
        compact,
        breakdown,
        order,
        codexHome
    };
}

function main(): void {
    try {
        const args = parseArgs(process.argv.slice(2));
        const parsedUsage = parseCodexUsage(args.codexHome);
        const report = buildReport(parsedUsage, {
            reportType: args.reportType,
            period: args.period,
            sessionFilter: args.sessionFilter,
            since: args.since,
            until: args.until,
            timezone: args.timezone,
            locale: args.locale,
            compact: args.compact,
            breakdown: args.breakdown,
            order: args.order
        });

        if (args.json) {
            console.log(JSON.stringify(report, null, 2));
            return;
        }

        console.log(renderReport(report));
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`cdxusage: ${message}`);
        process.exit(1);
    }
}

main();