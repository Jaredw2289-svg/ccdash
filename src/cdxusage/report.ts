import {
    formatTimestamp,
    getDateKey,
    getMonthBounds,
    getMonthKey,
    normalizeDayInput,
    normalizeMonthInput
} from './dates';
import {
    calculateApiEquivalentCostUsd,
    getPricingRate
} from './pricing';
import type {
    AggregateRow,
    ModelBreakdown,
    ParsedUsageData,
    ReportData,
    TokenTotals,
    UsageRecord
} from './types';

interface BuildReportOptions {
    reportType: 'daily' | 'monthly' | 'session';
    timezone: string;
    locale?: string;
    since?: string;
    until?: string;
    period?: string;
    sessionFilter?: string;
    compact?: boolean;
    breakdown?: boolean;
    order?: 'asc' | 'desc';
}

interface AggregateAccumulator {
    key: string;
    label: string;
    firstTimestamp: string;
    lastTimestamp: string;
    sessionIds: Set<string>;
    models: Set<string>;
    usage: TokenTotals;
    costUsd: number;
    hasUnpricedUsage: boolean;
    breakdown: Map<string, ModelBreakdown>;
    sessionId?: string;
    sessionShortId?: string;
    sessionRelativeDir?: string;
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

function createAccumulator(key: string, label: string): AggregateAccumulator {
    return {
        key,
        label,
        firstTimestamp: '',
        lastTimestamp: '',
        sessionIds: new Set<string>(),
        models: new Set<string>(),
        usage: createEmptyTotals(),
        costUsd: 0,
        hasUnpricedUsage: false,
        breakdown: new Map<string, ModelBreakdown>()
    };
}

function getRecordDayKey(record: UsageRecord, timezone: string): string {
    return getDateKey(record.timestamp, timezone);
}

function applyRecord(
    accumulator: AggregateAccumulator,
    record: UsageRecord
): void {
    accumulator.sessionIds.add(record.sessionId);

    const modelLabel = record.model ?? 'unknown';
    accumulator.models.add(modelLabel);

    if (accumulator.firstTimestamp === '' || record.timestamp < accumulator.firstTimestamp) {
        accumulator.firstTimestamp = record.timestamp;
    }

    if (accumulator.lastTimestamp === '' || record.timestamp > accumulator.lastTimestamp) {
        accumulator.lastTimestamp = record.timestamp;
    }

    addTotals(accumulator.usage, record.totals);

    const costUsd = calculateApiEquivalentCostUsd(record.totals, record.model);
    if (costUsd === null) {
        accumulator.hasUnpricedUsage = true;
    } else {
        accumulator.costUsd += costUsd;
    }

    const existingBreakdown = accumulator.breakdown.get(modelLabel);
    if (existingBreakdown) {
        addTotals(existingBreakdown.usage, record.totals);
        if (costUsd === null) {
            existingBreakdown.hasPricing = false;
        } else {
            existingBreakdown.costUsd += costUsd;
        }
        return;
    }

    const rate = getPricingRate(record.model);
    accumulator.breakdown.set(modelLabel, {
        model: modelLabel,
        canonicalModel: rate?.canonicalModel ?? null,
        usage: { ...record.totals },
        costUsd: costUsd ?? 0,
        hasPricing: costUsd !== null
    });
}

function finalizeAccumulator(accumulator: AggregateAccumulator): AggregateRow {
    const breakdown = Array.from(accumulator.breakdown.values()).sort((left, right) => {
        if (right.costUsd !== left.costUsd) {
            return right.costUsd - left.costUsd;
        }

        return left.model.localeCompare(right.model);
    });

    return {
        key: accumulator.key,
        label: accumulator.label,
        firstTimestamp: accumulator.firstTimestamp,
        lastTimestamp: accumulator.lastTimestamp,
        sessionCount: accumulator.sessionIds.size,
        models: Array.from(accumulator.models).sort(),
        usage: accumulator.usage,
        costUsd: accumulator.costUsd,
        hasUnpricedUsage: accumulator.hasUnpricedUsage || breakdown.some(item => !item.hasPricing),
        breakdown,
        sessionId: accumulator.sessionId,
        sessionShortId: accumulator.sessionShortId,
        sessionRelativeDir: accumulator.sessionRelativeDir
    };
}

function sortRows(rows: AggregateRow[], order: 'asc' | 'desc'): AggregateRow[] {
    return rows.sort((left, right) => {
        const comparison = left.key.localeCompare(right.key);
        return order === 'asc' ? comparison : -comparison;
    });
}

function filterRecords(
    records: UsageRecord[],
    timezone: string,
    since?: string,
    until?: string,
    sessionFilter?: string
): UsageRecord[] {
    return records.filter((record) => {
        if (sessionFilter && !record.sessionId.includes(sessionFilter) && !record.sessionShortId.includes(sessionFilter)) {
            return false;
        }

        const dayKey = getRecordDayKey(record, timezone);
        if (since && dayKey < since) {
            return false;
        }

        if (until && dayKey > until) {
            return false;
        }

        return true;
    });
}

function normalizeFilters(options: BuildReportOptions): { since?: string; until?: string; period?: string } {
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
        since,
        until,
        period
    };
}

function buildDailyRows(records: UsageRecord[], timezone: string): AggregateRow[] {
    const byDay = new Map<string, AggregateAccumulator>();

    for (const record of records) {
        const key = getDateKey(record.timestamp, timezone);
        const accumulator = byDay.get(key) ?? createAccumulator(key, key);
        applyRecord(accumulator, record);
        byDay.set(key, accumulator);
    }

    return Array.from(byDay.values()).map(finalizeAccumulator);
}

function buildMonthlyRows(records: UsageRecord[], timezone: string): AggregateRow[] {
    const byMonth = new Map<string, AggregateAccumulator>();

    for (const record of records) {
        const key = getMonthKey(record.timestamp, timezone);
        const accumulator = byMonth.get(key) ?? createAccumulator(key, key);
        applyRecord(accumulator, record);
        byMonth.set(key, accumulator);
    }

    return Array.from(byMonth.values()).map(finalizeAccumulator);
}

function buildSessionRows(records: UsageRecord[], timezone: string, locale?: string): AggregateRow[] {
    const bySession = new Map<string, AggregateAccumulator>();

    for (const record of records) {
        const key = record.sessionId;
        const accumulator = bySession.get(key) ?? createAccumulator(key, record.sessionShortId);
        accumulator.sessionId = record.sessionId;
        accumulator.sessionShortId = record.sessionShortId;
        accumulator.sessionRelativeDir = record.sessionRelativeDir;
        applyRecord(accumulator, record);
        accumulator.label = `${record.sessionShortId} (${formatTimestamp(record.timestamp, timezone, locale)})`;
        bySession.set(key, accumulator);
    }

    return Array.from(bySession.values()).map(finalizeAccumulator);
}

function buildTotalsRow(rows: AggregateRow[]): AggregateRow {
    const accumulator = createAccumulator('TOTAL', 'TOTAL');

    for (const row of rows) {
        accumulator.sessionIds.add(row.key);
        row.models.forEach(model => accumulator.models.add(model));

        if (accumulator.firstTimestamp === '' || (row.firstTimestamp && row.firstTimestamp < accumulator.firstTimestamp)) {
            accumulator.firstTimestamp = row.firstTimestamp;
        }

        if (accumulator.lastTimestamp === '' || row.lastTimestamp > accumulator.lastTimestamp) {
            accumulator.lastTimestamp = row.lastTimestamp;
        }

        addTotals(accumulator.usage, row.usage);
        accumulator.costUsd += row.costUsd;
        accumulator.hasUnpricedUsage = accumulator.hasUnpricedUsage || row.hasUnpricedUsage;

        for (const item of row.breakdown) {
            const existing = accumulator.breakdown.get(item.model);
            if (existing) {
                addTotals(existing.usage, item.usage);
                existing.costUsd += item.costUsd;
                existing.hasPricing = existing.hasPricing && item.hasPricing;
                continue;
            }

            accumulator.breakdown.set(item.model, {
                model: item.model,
                canonicalModel: item.canonicalModel,
                usage: { ...item.usage },
                costUsd: item.costUsd,
                hasPricing: item.hasPricing
            });
        }
    }

    accumulator.sessionIds = new Set(rows.map(row => row.sessionId ?? row.key));

    return finalizeAccumulator(accumulator);
}

export function buildReport(data: ParsedUsageData, options: BuildReportOptions): ReportData {
    const timezone = options.timezone;
    const normalized = normalizeFilters(options);
    const filteredRecords = filterRecords(
        data.records,
        timezone,
        normalized.since,
        normalized.until,
        options.sessionFilter
    );

    const reportRows = (() => {
        switch (options.reportType) {
            case 'monthly':
                return buildMonthlyRows(filteredRecords, timezone);
            case 'session':
                return buildSessionRows(filteredRecords, timezone, options.locale);
            case 'daily':
            default:
                return buildDailyRows(filteredRecords, timezone);
        }
    })();

    const order = options.order ?? 'desc';
    const rows = sortRows(reportRows, order);
    const totals = buildTotalsRow(rows);

    return {
        reportType: options.reportType,
        timezone,
        locale: options.locale,
        since: normalized.since,
        until: normalized.until,
        period: normalized.period,
        sessionFilter: options.sessionFilter,
        compact: options.compact ?? false,
        breakdown: options.breakdown ?? false,
        rows,
        totals,
        latestRateLimits: data.latestRateLimits,
        codexHome: data.codexHome,
        sessionFiles: data.sessionFiles
    };
}