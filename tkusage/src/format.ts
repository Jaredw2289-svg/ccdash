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
    maxWidth?: number;
    trimFrom?: 'end' | 'start';
}

interface RenderBoxTableOptions<T> {
    dividerAfter?: (row: T, nextRow: T | undefined) => 'full' | 'partial' | false;
    highlightRow?: (row: T) => boolean;
    partialDividerStartColumn?: number;
}

interface RenderReportFooter {
    commands: string[];
    githubUrl?: string;
}

interface RenderReportOptions {
    footer?: RenderReportFooter;
}

interface TimeTableRow {
    cached: string;
    cost: string;
    dateKey: string;
    input: string;
    key: string;
    label: string;
    models: string;
    output: string;
    sessionCount: string;
    source: string;
    total: string;
}

const ANSI = {
    bold: '\u001B[1m',
    cyan: '\u001B[36m',
    dim: '\u001B[2m',
    green: '\u001B[32m',
    reset: '\u001B[0m',
    yellow: '\u001B[33m'
};

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

    return `$${value.toFixed(2)}`;
}

function padCell(value: string, width: number, align: 'left' | 'right' = 'left'): string {
    return align === 'right' ? value.padStart(width) : value.padEnd(width);
}

function useAnsi(): boolean {
    return Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
}

function stylize(value: string, ...codes: string[]): string {
    return useAnsi() ? `${codes.join('')}${value}${ANSI.reset}` : value;
}

function colorize(value: string, code: string): string {
    return stylize(value, code);
}

function splitLines(value: string): string[] {
    return value.split('\n');
}

function formatSource(source: AggregateRow['source']): string {
    if (source === 'all') {
        return '';
    }

    if (source === 'claude') {
        return 'Claude';
    }

    if (source === 'codex') {
        return 'Codex';
    }

    if (source === 'openclaw') {
        return 'OpenClaw';
    }

    return source;
}

function simplifyModelName(model: string): string {
    const normalized = model.trim().toLowerCase();
    if (normalized.startsWith('claude-')) {
        return normalized.replace(/^claude-/, '');
    }

    return normalized;
}

function formatModelList(row: AggregateRow): string {
    if (row.key === 'TOTAL') {
        return '';
    }

    const rawLabels = row.breakdown.length > 0
        ? row.breakdown.map(item => simplifyModelName(item.canonicalModel ?? item.model))
        : row.models.map(model => simplifyModelName(model));
    const labels = [...new Set(rawLabels)];
    const realLabels = labels.filter(label => label !== 'unknown' && label !== '<synthetic>');
    const visibleLabels = realLabels.length > 0 ? realLabels : labels;

    if (visibleLabels.length === 0) {
        return 'unknown';
    }

    return visibleLabels.map(label => `• ${label}`).join('\n');
}

function buildBorder(widths: number[], left: string, mid: string, right: string): string {
    return left + widths.map(width => '─'.repeat(width + 2)).join(mid) + right;
}

function buildPartialBorder(widths: number[], startColumn: number): string {
    const leading = widths
        .slice(0, startColumn)
        .map(width => ` ${' '.repeat(width)} `)
        .join('│');
    const trailing = buildBorder(widths.slice(startColumn), '├', '┼', '┤');

    return `│${leading}${trailing}`;
}

function truncateText(value: string, maxWidth: number, trimFrom: 'end' | 'start' = 'end'): string {
    if (value.length <= maxWidth) {
        return value;
    }

    if (maxWidth <= 3) {
        return '.'.repeat(maxWidth);
    }

    return trimFrom === 'start'
        ? `...${value.slice(-(maxWidth - 3))}`
        : `${value.slice(0, maxWidth - 3)}...`;
}

function getCellLines<T>(column: ColumnDefinition<T>, row: T): string[] {
    const lines = splitLines(column.getValue(row));
    if (!column.maxWidth) {
        return lines;
    }

    return lines.map(line => truncateText(line, column.maxWidth ?? line.length, column.trimFrom));
}

function renderBoxTable<T>(
    rows: T[],
    columns: ColumnDefinition<T>[],
    options: RenderBoxTableOptions<T> = {}
): string {
    const widths = columns.map((column) => {
        const valueWidths = rows.flatMap(row => getCellLines(column, row).map(line => line.length));
        const longest = Math.max(column.header.length, ...valueWidths);
        return column.maxWidth ? Math.min(longest, column.maxWidth) : longest;
    });

    const top = buildBorder(widths, '┌', '┬', '┐');
    const header = '│ ' + columns.map((column, index) => padCell(
        column.header,
        widths[index] ?? column.header.length,
        column.align
    )).join(' │ ') + ' │';
    const divider = buildBorder(widths, '├', '┼', '┤');
    const bottom = buildBorder(widths, '└', '┴', '┘');
    const body: string[] = [];

    rows.forEach((row, rowIndex) => {
        const cellLines = columns.map(column => getCellLines(column, row));
        const height = Math.max(...cellLines.map(lines => lines.length));

        for (let lineIndex = 0; lineIndex < height; lineIndex++) {
            const rawLine = '│ ' + columns.map((column, index) => padCell(
                cellLines[index]?.[lineIndex] ?? '',
                widths[index] ?? column.header.length,
                column.align
            )).join(' │ ') + ' │';
            body.push(options.highlightRow?.(row) ? colorize(rawLine, ANSI.yellow) : rawLine);
        }
        const nextRow = rows[rowIndex + 1];
        const dividerKind = options.dividerAfter
            ? options.dividerAfter(row, nextRow)
            : (rowIndex < rows.length - 1 ? 'full' : false);
        if (dividerKind === 'full') {
            body.push(colorize(divider, ANSI.dim));
        } else if (dividerKind === 'partial') {
            body.push(colorize(
                buildPartialBorder(widths, options.partialDividerStartColumn ?? 1),
                ANSI.dim
            ));
        }
    });

    return [
        colorize(top, ANSI.dim),
        stylize(header, ANSI.bold, ANSI.cyan),
        colorize(divider, ANSI.dim),
        ...body,
        colorize(bottom, ANSI.dim)
    ]
        .join('\n');
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
        `Tokens: ${report.tokenSemanticsNote}`,
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

function buildTimeTableRow(report: ReportData, row: AggregateRow, displayLabel: string): TimeTableRow {
    return {
        key: row.key,
        dateKey: row.label,
        label: displayLabel,
        source: formatSource(row.source),
        sessionCount: row.key === 'TOTAL' ? '' : String(row.sessionCount),
        models: formatModelList(row),
        input: formatTokenValue(row.usage.inputTokens, report.compact),
        cached: formatTokenValue(row.usage.cachedInputTokens, report.compact),
        output: formatTokenValue(row.usage.outputTokens + row.usage.reasoningOutputTokens, report.compact),
        total: formatTokenValue(row.usage.totalTokens, report.compact),
        cost: formatUsd(row.costUsd, row.hasUnpricedUsage)
    };
}

function buildTimeTableRows(report: ReportData): TimeTableRow[] {
    const baseRows = [...report.rows, buildTotalRow(report)];

    return baseRows.map((row, index) => {
        const previousRow = baseRows[index - 1];
        const shouldBlankDate = report.selectedSource === 'all'
            && row.key !== 'TOTAL'
            && previousRow?.label === row.label;

        return buildTimeTableRow(report, row, shouldBlankDate ? '' : row.label);
    });
}

function buildTimeColumns(report: ReportData): ColumnDefinition<TimeTableRow>[] {
    const columns: ColumnDefinition<TimeTableRow>[] = [
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
                header: 'Sess',
                getValue: row => row.sessionCount,
                align: 'right'
            },
            {
                header: 'Input',
                getValue: row => row.input,
                align: 'right'
            },
            {
                header: 'Output',
                getValue: row => row.output,
                align: 'right'
            },
            {
                header: 'Cost',
                getValue: row => row.cost,
                align: 'right'
            }
        );
        return columns;
    }

    columns.push(
        {
            header: 'Sess',
            getValue: row => row.sessionCount,
            align: 'right'
        },
        {
            header: 'Models',
            getValue: row => row.models,
            maxWidth: 18
        },
        {
            header: 'Input',
            getValue: row => row.input,
            align: 'right'
        },
        {
            header: 'Cached',
            getValue: row => row.cached,
            align: 'right'
        },
        {
            header: 'Output',
            getValue: row => row.output,
            align: 'right'
        },
        {
            header: 'Total',
            getValue: row => row.total,
            align: 'right'
        },
        {
            header: 'Cost',
            getValue: row => row.cost,
            align: 'right'
        }
    );
    return columns;
}

function buildTotalRow(report: ReportData): AggregateRow {
    return {
        ...report.totals,
        key: 'TOTAL',
        label: 'Total',
        source: 'all',
        models: [],
        breakdown: [],
        sessionCount: 0,
        sessionId: undefined,
        sessionRelativeDir: undefined,
        sessionShortId: undefined
    };
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
            getValue: row => formatSource(row.source)
        });
    }

    columns.push({
        header: 'Dir',
        getValue: row => row.key === 'TOTAL' ? '' : (row.sessionRelativeDir ?? '.'),
        maxWidth: report.compact ? 36 : 42,
        trimFrom: 'start'
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
            getValue: row => formatModelList(row),
            maxWidth: 18
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
            getValue: row => formatTokenValue(row.usage.outputTokens + row.usage.reasoningOutputTokens, false),
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
            getValue: row => row.key === 'TOTAL'
                ? ''
                : formatTimestamp(row.lastTimestamp, report.timezone, report.locale),
            maxWidth: 22
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

function buildFooterLines(footer: RenderReportFooter): string[] {
    const lines = [
        stylize('Common commands', ANSI.bold, ANSI.green)
    ];

    for (const command of footer.commands) {
        lines.push(`  ${command}`);
    }

    if (footer.githubUrl) {
        lines.push('', stylize(`Star on GitHub: ${footer.githubUrl}`, ANSI.green));
    }

    return lines;
}

export function renderReport(report: ReportData, options: RenderReportOptions = {}): string {
    const lines = buildSummary(report);

    if (report.rows.length === 0) {
        lines.push('', 'No usage records matched the selected filters.');
        return lines.join('\n');
    }

    if (report.reportType === 'session') {
        const columns = buildSessionColumns(report);
        const tableRows = [...report.rows, buildTotalRow(report)];
        lines.push('', renderBoxTable(tableRows, columns, {
            highlightRow: row => row.key === 'TOTAL'
        }));
    } else {
        const columns = buildTimeColumns(report);
        const tableRows = buildTimeTableRows(report);
        lines.push('', renderBoxTable(tableRows, columns, {
            dividerAfter: (row, nextRow) => {
                if (!nextRow) {
                    return false;
                }

                return row.dateKey === nextRow.dateKey ? 'partial' : 'full';
            },
            highlightRow: row => row.key === 'TOTAL',
            partialDividerStartColumn: 1
        }));
    }

    if (report.breakdown) {
        for (const row of report.rows) {
            const breakdownLines = buildBreakdownLines(report, row);
            if (breakdownLines.length === 0) {
                continue;
            }

            lines.push('', `${row.label} ${row.source} breakdown`, ...breakdownLines);
        }
    }

    if (options.footer) {
        lines.push('', ...buildFooterLines(options.footer));
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
