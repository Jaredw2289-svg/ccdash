export type ReportType = 'daily' | 'monthly' | 'session';
export type SourceSelection = 'all' | UsageSource;
export type UsageSource = 'claude' | 'codex';

export interface TokenTotals {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
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

export interface ClaudeCacheCreationDetails {
    ephemeral5mInputTokens: number;
    ephemeral1hInputTokens: number;
}

export interface RecordNativeMetadata {
    requestId?: string;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreation?: ClaudeCacheCreationDetails;
    rateLimits?: RateLimitSnapshot | null;
}

export interface UsageRecord {
    source: UsageSource;
    timestamp: string;
    model: string | null;
    sessionId: string;
    sessionShortId: string;
    sessionRelativeDir: string;
    sessionFile: string;
    totals: TokenTotals;
    estimatedCostUsd: number | null;
    pricingModel: string | null;
    nativeMetadata?: RecordNativeMetadata;
}

export interface SourceMetadata {
    source: UsageSource;
    rootPath: string;
    sessionFiles: number;
    latestRateLimits: RateLimitSnapshot | null;
}

export interface ParsedUsageData {
    selectedSource: SourceSelection;
    records: UsageRecord[];
    sources: Partial<Record<UsageSource, SourceMetadata>>;
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
    source: UsageSource | 'all';
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
    reportType: ReportType;
    selectedSource: SourceSelection;
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
    sources: Partial<Record<UsageSource, SourceMetadata>>;
    pricingNote: string;
}

export interface StatuslineData {
    selectedSource: SourceSelection;
    timezone: string;
    day: string;
    totalCostUsd: number;
    hasUnpricedUsage: boolean;
    sourceTotals: {
        source: UsageSource;
        costUsd: number;
        hasUnpricedUsage: boolean;
    }[];
    lastActivity: {
        source: UsageSource;
        sessionShortId: string;
        model: string | null;
        timestamp: string;
    } | null;
}