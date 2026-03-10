import { formatTimestamp } from './dates';
import type {
    AggregateRow,
    ReportData,
    SourceSelection,
    StatuslineData
} from './types';

interface ColumnDefinition<T> {
    align?: 'left' | 'right';
    getValue: (row: T) => string;
    header: string;
}

function formatInteger(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
}

function formatCompactNumber(value: number): string {
    return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 1
    }).format(value);
}

function formatTokenValue(value: number, compact: boolean): string {
    return compact ? formatCompactNumber(value) : formatInteger(value);
}

function formatUsd(value: number, hasUnpricedUsage: boolean): string {
    if (value <= 0 && hasUnpricedUsage) {
        return 'n/a';
    }

    const formatted = `$${value.toFixed(2)}`;
    return hasUnpricedUsage ? `${formatted}+` : formatted;
}

function padCell(value: string, width: number, align: 'left' | 'right' = 'left'): string {
    return align === 'right' ? value.padStart(width) : value.padEnd(width);
}

function renderTable<T>(rows: T[], columns: ColumnDefinition<T>[]): string {
    const widths = columns.map(column => Math.max(
        column.header.length,
        ...rows.map(row => column.getValue(row).length)
    ));
    const header = columns.map((column, index) => padCell(
        column.header,
        widths[index] ?? column.header.length,
        column.align
    )).join('  ');
    const divider = widths.map(width => '-'.repeat(width)).join('  ');
    const body = rows.map(row => columns.map((column, index) => padCell(
        column.getValue(row),
        widths[index] ?? column.header.length,
        column.align
    )).join('  ')).join('\n');

    return [header, divider, body].filter(Boolean).join('\n');
}

function shouldShowSource(selectedSource: SourceSelection): boolean {
    return selectedSource === 'all';
}

function buildSummary(report: ReportData): string[] {
    const sourceParts = Object.values(report.sources)
        .map(source => `${source.source}=${source.rootPath} (${source.sessionFiles} files)`);
    const lines = [
        `tkusage ${report.reportType} report`,
        `Selection: ${report.selectedSource}`,
        `Pricing: ${report.pricingNote}`,
        `Sources: ${sourceParts.length > 0 ? sourceParts.join(' | ') : 'none'}`
    ];

    if (report.since || report.until) {
        lines.push(`Range: ${report.since ?? 'min'} -> ${report.until ?? 'max'} (${report.timezone})`);
    } else {
        lines.push(`Timezone: ${report.timezone}`);
    }

    const codexLimits = report.sources.codex?.latestRateLimits;
    if (codexLimits) {
        const parts = [
            codexLimits.planType ? `plan=${codexLimits.planType}` : null,
            codexLimits.primaryUsedPercent !== null ? `5h=${codexLimits.primaryUsedPercent.toFixed(1)}%` : null,
            codexLimits.secondaryUsedPercent !== null ? `7d=${codexLimits.secondaryUsedPercent.toFixed(1)}%` : null
        ].filter(Boolean);

        if (parts.length > 0) {
            lines.push(`Latest Codex limits: ${parts.join(' | ')}`);
        }
    }

    return lines;
}

function buildTimeColumns(report: ReportData): ColumnDefinition<AggregateRow>[] {
    const columns: ColumnDefinition<AggregateRow>[] = [
        {
            header: report.reportType === 'monthly' ? 'Month' : 'Date',
            getValue: row => row.label
        }
    ];

    if (shouldShowSource(report.selectedSource)) {
        columns.push({
            header: 'Source',
            getValue: row => row.source
        });
    }

    if (report.compact) {
        columns.push(
            {
                header: 'Sessions',
                getValue: row => String(row.sessionCount),
                align: 'right'
            },
            {
                header: 'Input',
                getValue: row => formatTokenValue(row.usage.inputTokens, true),
                align: 'right'
            },
            {
                header: 'Output',
                getValue: row => formatTokenValue(row.usage.outputTokens + row.usage.reasoningOutputTokens, true),
                align: 'right'
            },
            {
                header: 'Cost',
                getValue: row => formatUsd(row.costUsd, row.hasUnpricedUsage),
                align: 'right'
            }
        );
        return columns;
    }

    columns.push(
        {
            header: 'Sessions',
            getValue: row => String(row.sessionCount),
            align: 'right'
        },
        {
            header: 'Models',
            getValue: row => row.models.join(', ') || 'unknown'
        },
        {
            header: 'Input',
            getValue: row => formatTokenValue(row.usage.inputTokens, false),
            align: 'right'
        },
        {
            header: 'Cached',
            getValue: row => formatTokenValue(row.usage.cachedInputTokens, false),
            align: 'right'
        },
        {
            header: 'Output',
            getValue: row => formatTokenValue(row.usage.outputTokens, false),
            align: 'right'
        },
        {
            header: 'Reason',
            getValue: row => formatTokenValue(row.usage.reasoningOutputTokens, false),
            align: 'right'
        },
        {
            header: 'Total',
            getValue: row => formatTokenValue(row.usage.totalTokens, false),
            align: 'right'
        },
        {
            header: 'Cost',
            getValue: row => formatUsd(row.costUsd, row.hasUnpricedUsage),
            align: 'right'
        }
    );
    return columns;
}

function buildSessionColumns(report: ReportData): ColumnDefinition<AggregateRow>[] {
    const columns: ColumnDefinition<AggregateRow>[] = [
        {
            header: 'Session',
            getValue: row => row.sessionShortId ?? row.label
        }
    ];

    if (shouldShowSource(report.selectedSource)) {
        columns.push({
            header: 'Source',
            getValue: row => row.source
        });
    }

    columns.push({
        header: 'Dir',
        getValue: row => row.sessionRelativeDir ?? '.'
    });

    if (report.compact) {
        columns.push(
            {
                header: 'Input',
                getValue: row => formatTokenValue(row.usage.inputTokens, true),
                align: 'right'
            },
            {
                header: 'Output',
                getValue: row => formatTokenValue(row.usage.outputTokens + row.usage.reasoningOutputTokens, true),
                align: 'right'
            },
            {
                header: 'Cost',
                getValue: row => formatUsd(row.costUsd, row.hasUnpricedUsage),
                align: 'right'
            }
        );
        return columns;
    }

    columns.push(
        {
            header: 'Models',
            getValue: row => row.models.join(', ') || 'unknown'
        },
        {
            header: 'Input',
            getValue: row => formatTokenValue(row.usage.inputTokens, false),
            align: 'right'
        },
        {
            header: 'Cached',
            getValue: row => formatTokenValue(row.usage.cachedInputTokens, false),
            align: 'right'
        },
        {
            header: 'Output',
            getValue: row => formatTokenValue(row.usage.outputTokens, false),
            align: 'right'
        },
        {
            header: 'Reason',
            getValue: row => formatTokenValue(row.usage.reasoningOutputTokens, false),
            align: 'right'
        },
        {
            header: 'Total',
            getValue: row => formatTokenValue(row.usage.totalTokens, false),
            align: 'right'
        },
        {
            header: 'Cost',
            getValue: row => formatUsd(row.costUsd, row.hasUnpricedUsage),
            align: 'right'
        },
        {
            header: 'Last Activity',
            getValue: row => formatTimestamp(row.lastTimestamp, report.timezone, report.locale)
        }
    );
    return columns;
}

function buildBreakdownLines(report: ReportData, row: AggregateRow): string[] {
    if (!report.breakdown || row.breakdown.length === 0) {
        return [];
    }

    return row.breakdown.map((item) => {
        const cost = formatUsd(item.costUsd, !item.hasPricing);
        const output = item.usage.outputTokens + item.usage.reasoningOutputTokens;
        return `  - ${item.model}: input=${formatTokenValue(item.usage.inputTokens, report.compact)}`
            + ` cached=${formatTokenValue(item.usage.cachedInputTokens, report.compact)}`
            + ` output=${formatTokenValue(output, report.compact)}`
            + ` cost=${cost}`;
    });
}

export function renderReport(report: ReportData): string {
    const lines = buildSummary(report);

    if (report.rows.length === 0) {
        lines.push('', 'No usage records matched the selected filters.');
        return lines.join('\n');
    }

    const columns = report.reportType === 'session' ? buildSessionColumns(report) : buildTimeColumns(report);
    lines.push('', renderTable(report.rows, columns), '');
    lines.push(`TOTAL  input=${formatTokenValue(report.totals.usage.inputTokens, report.compact)}`
        + ` cached=${formatTokenValue(report.totals.usage.cachedInputTokens, report.compact)}`
        + ` output=${formatTokenValue(report.totals.usage.outputTokens + report.totals.usage.reasoningOutputTokens, report.compact)}`
        + ` cost=${formatUsd(report.totals.costUsd, report.totals.hasUnpricedUsage)}`);

    if (report.breakdown) {
        for (const row of report.rows) {
            const breakdownLines = buildBreakdownLines(report, row);
            if (breakdownLines.length === 0) {
                continue;
            }

            lines.push('', `${row.label} ${row.source} breakdown`, ...breakdownLines);
        }
    }

    return lines.join('\n');
}

export function renderStatusline(data: StatuslineData, locale?: string): string {
    const parts = [`${data.day} est ${formatUsd(data.totalCostUsd, data.hasUnpricedUsage)}`];

    if (data.selectedSource === 'all') {
        for (const sourceTotal of data.sourceTotals) {
            parts.push(`${sourceTotal.source} ${formatUsd(sourceTotal.costUsd, sourceTotal.hasUnpricedUsage)}`);
        }
    }

    if (data.lastActivity) {
        const modelSuffix = data.lastActivity.model ? ` ${data.lastActivity.model}` : '';
        parts.push(`last ${data.lastActivity.source}:${data.lastActivity.sessionShortId}${modelSuffix}`);
        parts.push(formatTimestamp(data.lastActivity.timestamp, data.timezone, locale));
    } else {
        parts.push('no local activity');
    }

    return parts.join(' | ');
}