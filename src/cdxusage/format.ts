import { formatTimestamp } from './dates';
import type {
    AggregateRow,
    ReportData
} from './types';

interface ColumnDefinition<T> {
    header: string;
    getValue: (row: T) => string;
    align?: 'left' | 'right';
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

function renderTable<T>(rows: T[], columns: ColumnDefinition<T>[]): string {
    const widths = columns.map((column) => {
        const valueWidths = rows.map(row => column.getValue(row).length);
        return Math.max(column.header.length, ...valueWidths);
    });

    const header = columns.map((column, index) => padCell(column.header, widths[index] ?? column.header.length, column.align)).join('  ');
    const divider = columns.map((_, index) => '-'.repeat(widths[index] ?? 0)).join('  ');
    const body = rows.map(row => columns.map((column, index) => padCell(
        column.getValue(row),
        widths[index] ?? column.header.length,
        column.align
    )).join('  ')).join('\n');

    return [header, divider, body].filter(Boolean).join('\n');
}

function padCell(value: string, width: number, align: 'left' | 'right' = 'left'): string {
    return align === 'right' ? value.padStart(width) : value.padEnd(width);
}

function buildSummary(report: ReportData): string[] {
    const lines = [
        `cdxusage ${report.reportType} report`,
        `Source: ${report.codexHome}`,
        `Pricing: API equivalent USD (embedded GPT-5 Codex rates)`,
        `Rows: ${report.rows.length} | Session files: ${report.sessionFiles}`
    ];

    if (report.since || report.until) {
        lines.push(`Range: ${report.since ?? 'min'} -> ${report.until ?? 'max'} (${report.timezone})`);
    } else {
        lines.push(`Timezone: ${report.timezone}`);
    }

    if (report.latestRateLimits) {
        const primary = report.latestRateLimits.primaryUsedPercent;
        const secondary = report.latestRateLimits.secondaryUsedPercent;
        const parts = [
            report.latestRateLimits.planType ? `plan=${report.latestRateLimits.planType}` : null,
            primary !== null ? `5h=${primary.toFixed(1)}%` : null,
            secondary !== null ? `7d=${secondary.toFixed(1)}%` : null
        ].filter(Boolean);

        if (parts.length > 0) {
            lines.push(`Latest limits: ${parts.join(' | ')}`);
        }
    }

    return lines;
}

function buildDailyOrMonthlyColumns(report: ReportData): ColumnDefinition<AggregateRow>[] {
    const compact = report.compact;

    if (compact) {
        return [
            { header: report.reportType === 'monthly' ? 'Month' : 'Date', getValue: row => row.label },
            { header: 'Sessions', getValue: row => String(row.sessionCount), align: 'right' },
            { header: 'Input', getValue: row => formatTokenValue(row.usage.inputTokens, true), align: 'right' },
            { header: 'Output', getValue: row => formatTokenValue(row.usage.outputTokens + row.usage.reasoningOutputTokens, true), align: 'right' },
            { header: 'Cost', getValue: row => formatUsd(row.costUsd, row.hasUnpricedUsage), align: 'right' }
        ];
    }

    return [
        { header: report.reportType === 'monthly' ? 'Month' : 'Date', getValue: row => row.label },
        { header: 'Sessions', getValue: row => String(row.sessionCount), align: 'right' },
        { header: 'Models', getValue: row => row.models.join(', ') || 'unknown' },
        { header: 'Input', getValue: row => formatTokenValue(row.usage.inputTokens, false), align: 'right' },
        { header: 'Cached', getValue: row => formatTokenValue(row.usage.cachedInputTokens, false), align: 'right' },
        { header: 'Output', getValue: row => formatTokenValue(row.usage.outputTokens, false), align: 'right' },
        { header: 'Reason', getValue: row => formatTokenValue(row.usage.reasoningOutputTokens, false), align: 'right' },
        { header: 'Total', getValue: row => formatTokenValue(row.usage.totalTokens, false), align: 'right' },
        { header: 'Cost', getValue: row => formatUsd(row.costUsd, row.hasUnpricedUsage), align: 'right' }
    ];
}

function buildSessionColumns(report: ReportData): ColumnDefinition<AggregateRow>[] {
    const compact = report.compact;

    if (compact) {
        return [
            { header: 'Session', getValue: row => row.sessionShortId ?? row.label },
            { header: 'Dir', getValue: row => row.sessionRelativeDir ?? '.' },
            { header: 'Input', getValue: row => formatTokenValue(row.usage.inputTokens, true), align: 'right' },
            { header: 'Output', getValue: row => formatTokenValue(row.usage.outputTokens + row.usage.reasoningOutputTokens, true), align: 'right' },
            { header: 'Cost', getValue: row => formatUsd(row.costUsd, row.hasUnpricedUsage), align: 'right' }
        ];
    }

    return [
        { header: 'Session', getValue: row => row.sessionShortId ?? row.label },
        { header: 'Dir', getValue: row => row.sessionRelativeDir ?? '.' },
        { header: 'Models', getValue: row => row.models.join(', ') || 'unknown' },
        { header: 'Input', getValue: row => formatTokenValue(row.usage.inputTokens, false), align: 'right' },
        { header: 'Cached', getValue: row => formatTokenValue(row.usage.cachedInputTokens, false), align: 'right' },
        { header: 'Output', getValue: row => formatTokenValue(row.usage.outputTokens, false), align: 'right' },
        { header: 'Reason', getValue: row => formatTokenValue(row.usage.reasoningOutputTokens, false), align: 'right' },
        { header: 'Total', getValue: row => formatTokenValue(row.usage.totalTokens, false), align: 'right' },
        { header: 'Cost', getValue: row => formatUsd(row.costUsd, row.hasUnpricedUsage), align: 'right' },
        { header: 'Last Activity', getValue: row => formatTimestamp(row.lastTimestamp, report.timezone, report.locale) }
    ];
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
    const columns = report.reportType === 'session'
        ? buildSessionColumns(report)
        : buildDailyOrMonthlyColumns(report);

    if (report.rows.length === 0) {
        lines.push('');
        lines.push('No usage records matched the selected filters.');
        return lines.join('\n');
    }

    lines.push('');
    lines.push(renderTable(report.rows, columns));
    lines.push('');
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

            lines.push('');
            lines.push(`${row.label} breakdown`);
            lines.push(...breakdownLines);
        }
    }

    return lines.join('\n');
}