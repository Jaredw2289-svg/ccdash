export interface TokenTotals {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
}

export interface UsageRecord {
    timestamp: string;
    model: string | null;
    sessionId: string;
    sessionShortId: string;
    sessionRelativeDir: string;
    sessionFile: string;
    totals: TokenTotals;
}

export interface RateLimitSnapshot {
    timestamp: string;
    planType: string | null;
    primaryUsedPercent: number | null;
    primaryWindowMinutes: number | null;
    primaryResetsAt: number | null;
    secondaryUsedPercent: number | null;
    secondaryWindowMinutes: number | null;
    secondaryResetsAt: number | null;
    creditsBalance: number | null;
    creditsHasUnlimited: boolean | null;
}

export interface ParsedUsageData {
    codexHome: string;
    sessionRoot: string;
    sessionFiles: number;
    records: UsageRecord[];
    latestRateLimits: RateLimitSnapshot | null;
}

export interface PricingRate {
    canonicalModel: string;
    inputUsdPerMillion: number;
    cachedInputUsdPerMillion: number;
    outputUsdPerMillion: number;
}

export interface ModelBreakdown {
    model: string;
    canonicalModel: string | null;
    usage: TokenTotals;
    costUsd: number;
    hasPricing: boolean;
}

export interface AggregateRow {
    key: string;
    label: string;
    firstTimestamp: string;
    lastTimestamp: string;
    sessionCount: number;
    models: string[];
    usage: TokenTotals;
    costUsd: number;
    hasUnpricedUsage: boolean;
    breakdown: ModelBreakdown[];
    sessionId?: string;
    sessionShortId?: string;
    sessionRelativeDir?: string;
}

export interface ReportData {
    reportType: 'daily' | 'monthly' | 'session';
    timezone: string;
    locale?: string;
    since?: string;
    until?: string;
    period?: string;
    sessionFilter?: string;
    compact: boolean;
    breakdown: boolean;
    rows: AggregateRow[];
    totals: AggregateRow;
    latestRateLimits: RateLimitSnapshot | null;
    codexHome: string;
    sessionFiles: number;
}