import {
    getDateKey,
    getMonthBounds,
    getMonthKey,
    normalizeDayInput,
    normalizeMonthInput
} from './dates';
import { getPricingNote } from './pricing';
import type {
    AggregateRow,
    ModelBreakdown,
    ParsedUsageData,
    ReportData,
    ReportType,
    SourceSelection,
    StatuslineData,
    TokenTotals,
    UsageRecord
} from './types';

const TOKEN_SEMANTICS_NOTE = 'Input = total prompt input, Cached = cached subset of input, Output includes reasoning, Total = Input + Output.';

interface BuildReportOptions {
    breakdown?: boolean;
    compact?: boolean;
    locale?: string;
    order?: 'asc' | 'desc';
    period?: string;
    reportType: ReportType;
    selectedSource: SourceSelection;
    sessionFilter?: string;
    since?: string;
    timezone: string;
    until?: string;
}

interface BuildStatuslineOptions {
    selectedSource: SourceSelection;
    timezone: string;
}

interface AggregateAccumulator {
    breakdown: Map<string, ModelBreakdown>;
    costUsd: number;
    firstTimestamp: string;
    hasUnpricedUsage: boolean;
    key: string;
    label: string;
    lastTimestamp: string;
    models: Set<string>;
    sessionId?: string;
    sessionIds: Set<string>;
    sessionRelativeDir?: string;
    sessionShortId?: string;
    source: AggregateRow['source'];
    usage: TokenTotals;
}

function createEmptyTotals(): TokenTotals {
    return {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0
    };
}

function addTotals(target: TokenTotals, source: TokenTotals): void {
    target.inputTokens += source.inputTokens;
    target.cachedInputTokens += source.cachedInputTokens;
    target.outputTokens += source.outputTokens;
    target.reasoningOutputTokens += source.reasoningOutputTokens;
    target.totalTokens += source.totalTokens;
}

function createAccumulator(key: string, label: string, source: AggregateRow['source']): AggregateAccumulator {
    return {
        breakdown: new Map<string, ModelBreakdown>(),
        costUsd: 0,
        firstTimestamp: '',
        hasUnpricedUsage: false,
        key,
        label,
        lastTimestamp: '',
        models: new Set<string>(),
        sessionIds: new Set<string>(),
        source,
        usage: createEmptyTotals()
    };
}

function finalizeAccumulator(accumulator: AggregateAccumulator): AggregateRow {
    const breakdown = [...accumulator.breakdown.values()].sort((left, right) => {
        if (right.costUsd !== left.costUsd) {
            return right.costUsd - left.costUsd;
        }

        return left.model.localeCompare(right.model);
    });

    return {
        key: accumulator.key,
        label: accumulator.label,
        source: accumulator.source,
        firstTimestamp: accumulator.firstTimestamp,
        lastTimestamp: accumulator.lastTimestamp,
        sessionCount: accumulator.sessionIds.size,
        models: [...accumulator.models].sort(),
        usage: accumulator.usage,
        costUsd: accumulator.costUsd,
        hasUnpricedUsage: accumulator.hasUnpricedUsage || breakdown.some(item => !item.hasPricing),
        breakdown,
        sessionId: accumulator.sessionId,
        sessionShortId: accumulator.sessionShortId,
        sessionRelativeDir: accumulator.sessionRelativeDir
    };
}

function getDayKey(record: UsageRecord, timezone: string): string {
    return getDateKey(record.timestamp, timezone);
}

function getGroupKey(
    record: UsageRecord,
    reportType: ReportType,
    selectedSource: SourceSelection,
    timezone: string
): { groupKey: string; label: string; source: AggregateRow['source'] } {
    if (reportType === 'session') {
        const rowSource = selectedSource === 'all' ? record.source : record.source;
        return {
            groupKey: `${record.source}:${record.sessionId}`,
            label: record.sessionShortId,
            source: rowSource
        };
    }

    const label = reportType === 'monthly'
        ? getMonthKey(record.timestamp, timezone)
        : getDayKey(record, timezone);
    const rowSource = selectedSource === 'all' ? record.source : record.source;
    const groupKey = selectedSource === 'all' ? `${label}:${record.source}` : label;

    return {
        groupKey,
        label,
        source: rowSource
    };
}

function applyRecord(accumulator: AggregateAccumulator, record: UsageRecord): void {
    accumulator.sessionIds.add(record.sessionId);
    accumulator.models.add(record.model ?? 'unknown');

    if (accumulator.firstTimestamp === '' || record.timestamp < accumulator.firstTimestamp) {
        accumulator.firstTimestamp = record.timestamp;
    }

    if (accumulator.lastTimestamp === '' || record.timestamp > accumulator.lastTimestamp) {
        accumulator.lastTimestamp = record.timestamp;
    }

    addTotals(accumulator.usage, record.totals);

    if (record.estimatedCostUsd === null) {
        accumulator.hasUnpricedUsage = true;
    } else {
        accumulator.costUsd += record.estimatedCostUsd;
    }

    const modelLabel = record.model ?? 'unknown';
    const existingBreakdown = accumulator.breakdown.get(modelLabel);
    if (existingBreakdown) {
        addTotals(existingBreakdown.usage, record.totals);
        if (record.estimatedCostUsd === null) {
            existingBreakdown.hasPricing = false;
        } else {
            existingBreakdown.costUsd += record.estimatedCostUsd;
        }
        return;
    }

    accumulator.breakdown.set(modelLabel, {
        model: modelLabel,
        canonicalModel: record.pricingModel,
        usage: { ...record.totals },
        costUsd: record.estimatedCostUsd ?? 0,
        hasPricing: record.estimatedCostUsd !== null
    });
}

function sortRows(rows: AggregateRow[], order: 'asc' | 'desc'): AggregateRow[] {
    return rows.sort((left, right) => {
        const keyComparison = left.label.localeCompare(right.label);
        if (keyComparison !== 0) {
            return order === 'asc' ? keyComparison : -keyComparison;
        }

        const sourceComparison = left.source.localeCompare(right.source);
        return order === 'asc' ? sourceComparison : -sourceComparison;
    });
}

function isSubagentSessionRelativeDir(sessionRelativeDir: string): boolean {
    return sessionRelativeDir.split(/[\\/]/).includes('subagents');
}

function pickPreferredSessionRelativeDir(current: string | undefined, next: string | undefined): string | undefined {
    if (!next) {
        return current;
    }

    if (!current) {
        return next;
    }

    const currentIsSubagent = isSubagentSessionRelativeDir(current);
    const nextIsSubagent = isSubagentSessionRelativeDir(next);
    if (currentIsSubagent !== nextIsSubagent) {
        return nextIsSubagent ? current : next;
    }

    if (current.length !== next.length) {
        return next.length < current.length ? next : current;
    }

    return next.localeCompare(current) < 0 ? next : current;
}

function filterRecords(
    records: UsageRecord[],
    timezone: string,
    since?: string,
    until?: string,
    sessionFilter?: string
): UsageRecord[] {
    return records.filter((record) => {
        if (sessionFilter
            && !record.sessionId.includes(sessionFilter)
            && !record.sessionShortId.includes(sessionFilter)) {
            return false;
        }

        const dayKey = getDayKey(record, timezone);
        if (since && dayKey < since) {
            return false;
        }

        if (until && dayKey > until) {
            return false;
        }

        return true;
    });
}

function normalizeFilters(options: BuildReportOptions): {
    period?: string;
    since?: string;
    until?: string;
} {
    let since = options.since ? normalizeDayInput(options.since) ?? undefined : undefined;
    let until = options.until ? normalizeDayInput(options.until) ?? undefined : undefined;
    let period = options.period;

    if (options.reportType === 'daily' && options.period) {
        const normalizedDay = normalizeDayInput(options.period);
        if (!normalizedDay) {
            throw new Error(`Invalid day period: ${options.period}`);
        }
        since = normalizedDay;
        until = normalizedDay;
        period = normalizedDay;
    }

    if (options.reportType === 'monthly' && options.period) {
        const normalizedMonth = normalizeMonthInput(options.period);
        if (!normalizedMonth) {
            throw new Error(`Invalid month period: ${options.period}`);
        }
        const bounds = getMonthBounds(normalizedMonth);
        since = bounds.since;
        until = bounds.until;
        period = normalizedMonth;
    }

    return {
        period,
        since,
        until
    };
}

export function buildReport(data: ParsedUsageData, options: BuildReportOptions): ReportData {
    const filters = normalizeFilters(options);
    const records = filterRecords(
        data.records,
        options.timezone,
        filters.since,
        filters.until,
        options.sessionFilter
    );
    const accumulators = new Map<string, AggregateAccumulator>();
    const uniqueSessionIds = new Set(records.map(record => `${record.source}:${record.sessionId}`));

    for (const record of records) {
        const groupInfo = getGroupKey(record, options.reportType, options.selectedSource, options.timezone);
        const accumulator = accumulators.get(groupInfo.groupKey)
            ?? createAccumulator(groupInfo.groupKey, groupInfo.label, groupInfo.source);

        if (options.reportType === 'session') {
            accumulator.sessionId = record.sessionId;
            accumulator.sessionShortId = record.sessionShortId;
            accumulator.sessionRelativeDir = pickPreferredSessionRelativeDir(
                accumulator.sessionRelativeDir,
                record.sessionRelativeDir
            );
        }

        applyRecord(accumulator, record);
        accumulators.set(groupInfo.groupKey, accumulator);
    }

    const defaultOrder = options.reportType === 'session' ? 'desc' : 'asc';
    const rows = sortRows([...accumulators.values()].map(finalizeAccumulator), options.order ?? defaultOrder);
    const totalsAccumulator = createAccumulator('TOTAL', 'TOTAL', 'all');
    for (const sessionId of uniqueSessionIds) {
        totalsAccumulator.sessionIds.add(sessionId);
    }

    for (const row of rows) {
        totalsAccumulator.models = new Set([...totalsAccumulator.models, ...row.models]);
        if (totalsAccumulator.firstTimestamp === '' || row.firstTimestamp < totalsAccumulator.firstTimestamp) {
            totalsAccumulator.firstTimestamp = row.firstTimestamp;
        }
        if (totalsAccumulator.lastTimestamp === '' || row.lastTimestamp > totalsAccumulator.lastTimestamp) {
            totalsAccumulator.lastTimestamp = row.lastTimestamp;
        }
        addTotals(totalsAccumulator.usage, row.usage);
        totalsAccumulator.costUsd += row.costUsd;
        totalsAccumulator.hasUnpricedUsage = totalsAccumulator.hasUnpricedUsage || row.hasUnpricedUsage;
    }

    return {
        reportType: options.reportType,
        selectedSource: options.selectedSource,
        timezone: options.timezone,
        locale: options.locale,
        tokenSemanticsNote: TOKEN_SEMANTICS_NOTE,
        since: filters.since,
        until: filters.until,
        period: filters.period,
        sessionFilter: options.sessionFilter,
        compact: options.compact ?? false,
        breakdown: options.breakdown ?? false,
        rows,
        totals: finalizeAccumulator(totalsAccumulator),
        sources: data.sources,
        pricingNote: getPricingNote()
    };
}

export function buildStatusline(data: ParsedUsageData, options: BuildStatuslineOptions): StatuslineData {
    const day = getDateKey(new Date().toISOString(), options.timezone);
    const records = filterRecords(data.records, options.timezone, day, day);
    const sourceTotals = new Map<StatuslineData['sourceTotals'][number]['source'], StatuslineData['sourceTotals'][number]>();
    let totalCostUsd = 0;
    let hasUnpricedUsage = false;

    for (const record of records) {
        const costUsd = record.estimatedCostUsd ?? 0;
        totalCostUsd += costUsd;
        hasUnpricedUsage = hasUnpricedUsage || record.estimatedCostUsd === null;

        const sourceTotal = sourceTotals.get(record.source) ?? {
            source: record.source,
            costUsd: 0,
            hasUnpricedUsage: false
        };

        sourceTotal.costUsd += costUsd;
        sourceTotal.hasUnpricedUsage = sourceTotal.hasUnpricedUsage || record.estimatedCostUsd === null;
        sourceTotals.set(record.source, sourceTotal);
    }

    const lastRecord = records.at(-1) ?? null;
    return {
        selectedSource: options.selectedSource,
        timezone: options.timezone,
        day,
        totalCostUsd,
        hasUnpricedUsage,
        sourceTotals: [...sourceTotals.values()].sort((left, right) => left.source.localeCompare(right.source)),
        lastActivity: lastRecord ? {
            source: lastRecord.source,
            sessionShortId: lastRecord.sessionShortId,
            model: lastRecord.model,
            timestamp: lastRecord.timestamp
        } : null
    };
}
