import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    calculateEstimatedCostUsd,
    getPricingRate
} from '../pricing';
import type {
    ParsedUsageData,
    RateLimitSnapshot,
    RecordNativeMetadata,
    SourceMetadata,
    TokenTotals,
    UsageRecord
} from '../types';

interface ParsedSourceUsage {
    metadata: SourceMetadata;
    records: UsageRecord[];
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function toNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseTokenTotals(value: unknown): TokenTotals | null {
    if (!isObject(value)) {
        return null;
    }

    const inputTokens = toNumber(value.input_tokens);
    const cachedInputTokens = toNumber(value.cached_input_tokens);
    const outputTokens = toNumber(value.output_tokens);
    const reasoningOutputTokens = toNumber(value.reasoning_output_tokens);
    const providedTotalTokens = toNumber(value.total_tokens);

    return {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens: providedTotalTokens || (inputTokens + outputTokens)
    };
}

function subtractTotals(current: TokenTotals, previous: TokenTotals): TokenTotals {
    const hasReset = current.totalTokens < previous.totalTokens
        || current.inputTokens < previous.inputTokens
        || current.cachedInputTokens < previous.cachedInputTokens
        || current.outputTokens < previous.outputTokens
        || current.reasoningOutputTokens < previous.reasoningOutputTokens;

    if (hasReset) {
        return current;
    }

    return {
        inputTokens: current.inputTokens - previous.inputTokens,
        cachedInputTokens: current.cachedInputTokens - previous.cachedInputTokens,
        outputTokens: current.outputTokens - previous.outputTokens,
        reasoningOutputTokens: current.reasoningOutputTokens - previous.reasoningOutputTokens,
        totalTokens: current.totalTokens - previous.totalTokens
    };
}

function hasUsage(totals: TokenTotals): boolean {
    return totals.inputTokens > 0
        || totals.cachedInputTokens > 0
        || totals.outputTokens > 0
        || totals.reasoningOutputTokens > 0
        || totals.totalTokens > 0;
}

function parseRateLimits(timestamp: string, value: unknown): RateLimitSnapshot | null {
    if (!isObject(value)) {
        return null;
    }

    const primary = isObject(value.primary) ? value.primary : null;
    const secondary = isObject(value.secondary) ? value.secondary : null;
    const credits = isObject(value.credits) ? value.credits : null;

    return {
        timestamp,
        planType: typeof value.plan_type === 'string' ? value.plan_type : null,
        primaryUsedPercent: primary ? toNumber(primary.used_percent) : null,
        primaryWindowMinutes: primary ? toNumber(primary.window_minutes) : null,
        primaryResetsAt: primary ? toNumber(primary.resets_at) : null,
        secondaryUsedPercent: secondary ? toNumber(secondary.used_percent) : null,
        secondaryWindowMinutes: secondary ? toNumber(secondary.window_minutes) : null,
        secondaryResetsAt: secondary ? toNumber(secondary.resets_at) : null,
        creditsBalance: credits ? toNumber(credits.balance) : null,
        creditsHasUnlimited: credits && typeof credits.unlimited === 'boolean' ? credits.unlimited : null
    };
}

function collectJsonlFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) {
        return [];
    }

    const files: string[] = [];

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            for (const childPath of collectJsonlFiles(fullPath)) {
                files.push(childPath);
            }
            continue;
        }

        if (entry.isFile() && fullPath.endsWith('.jsonl')) {
            files.push(fullPath);
        }
    }

    return files.sort();
}

function parseSessionId(filePath: string): string {
    return path.basename(filePath, '.jsonl');
}

function parseSessionShortId(sessionId: string): string {
    return sessionId.slice(-8);
}

function parseSessionRelativeDir(filePath: string, sessionRoot: string): string {
    const relativeDir = path.relative(sessionRoot, path.dirname(filePath));
    return relativeDir === '' ? '.' : relativeDir;
}

function parseUsageFile(filePath: string, sessionRoot: string): {
    latestRateLimits: RateLimitSnapshot | null;
    records: UsageRecord[];
} {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n');
    const sessionId = parseSessionId(filePath);
    const sessionShortId = parseSessionShortId(sessionId);
    const sessionRelativeDir = parseSessionRelativeDir(filePath, sessionRoot);

    const records: UsageRecord[] = [];
    let currentModel: string | null = null;
    let previousTotals: TokenTotals | null = null;
    let latestRateLimits: RateLimitSnapshot | null = null;

    for (const line of lines) {
        if (line.trim() === '') {
            continue;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            continue;
        }

        if (!isObject(parsed)) {
            continue;
        }

        if (parsed.type === 'turn_context' && isObject(parsed.payload) && typeof parsed.payload.model === 'string') {
            currentModel = parsed.payload.model;
            continue;
        }

        if (parsed.type !== 'event_msg' || !isObject(parsed.payload) || parsed.payload.type !== 'token_count') {
            continue;
        }

        const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : null;
        if (!timestamp) {
            continue;
        }

        const usageInfo = isObject(parsed.payload.info)
            ? parseTokenTotals(parsed.payload.info.total_token_usage)
            : null;

        const rateLimits = parseRateLimits(timestamp, parsed.payload.rate_limits);
        if (rateLimits && (!latestRateLimits || timestamp > latestRateLimits.timestamp)) {
            latestRateLimits = rateLimits;
        }

        if (!usageInfo) {
            continue;
        }

        const delta = previousTotals ? subtractTotals(usageInfo, previousTotals) : usageInfo;
        previousTotals = usageInfo;

        if (!hasUsage(delta)) {
            continue;
        }

        const nativeMetadata: RecordNativeMetadata = { rateLimits };
        const pricingRate = getPricingRate('codex', currentModel);
        records.push({
            source: 'codex',
            timestamp,
            model: currentModel,
            sessionId,
            sessionShortId,
            sessionRelativeDir,
            sessionFile: filePath,
            totals: delta,
            estimatedCostUsd: calculateEstimatedCostUsd('codex', delta, currentModel, nativeMetadata),
            pricingModel: pricingRate?.canonicalModel ?? null,
            nativeMetadata
        });
    }

    return {
        latestRateLimits,
        records
    };
}

export function resolveCodexHome(explicitCodexHome?: string): string {
    if (explicitCodexHome) {
        return explicitCodexHome;
    }

    return process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
}

export function parseCodexUsage(explicitCodexHome?: string): ParsedSourceUsage {
    const codexHome = resolveCodexHome(explicitCodexHome);
    const sessionRoot = path.join(codexHome, 'sessions');
    const sessionFiles = collectJsonlFiles(sessionRoot);

    const records: UsageRecord[] = [];
    let latestRateLimits: RateLimitSnapshot | null = null;

    for (const filePath of sessionFiles) {
        const parsed = parseUsageFile(filePath, sessionRoot);
        records.push(...parsed.records);

        if (parsed.latestRateLimits
            && (!latestRateLimits || parsed.latestRateLimits.timestamp > latestRateLimits.timestamp)) {
            latestRateLimits = parsed.latestRateLimits;
        }
    }

    return {
        metadata: {
            source: 'codex',
            rootPath: sessionRoot,
            sessionFiles: sessionFiles.length,
            latestRateLimits
        },
        records
    };
}

export function withCodexUsage(
    data: ParsedUsageData,
    explicitCodexHome?: string
): ParsedUsageData {
    const parsed = parseCodexUsage(explicitCodexHome);
    return {
        ...data,
        records: [...data.records, ...parsed.records],
        sources: {
            ...data.sources,
            codex: parsed.metadata
        }
    };
}