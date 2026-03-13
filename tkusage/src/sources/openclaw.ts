import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { UsageCacheStore } from '../cache';
import type {
    ParsedUsageData,
    SourceMetadata,
    TokenTotals,
    UsageRecord
} from '../types';

interface ParsedSourceUsage {
    metadata: SourceMetadata;
    records: UsageRecord[];
}

interface ParsedOpenClawUsage {
    cacheRead: number;
    cacheWrite: number;
    costTotal: number | null;
    input: number;
    output: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function toNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toNullableNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function collectJsonlFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) {
        return [];
    }

    const files: string[] = [];

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectJsonlFiles(fullPath));
            continue;
        }

        if (entry.isFile() && fullPath.endsWith('.jsonl')) {
            files.push(fullPath);
        }
    }

    return files.sort();
}

function parseSessionShortId(sessionId: string): string {
    return sessionId.slice(-8);
}

function parseSessionRelativeDir(filePath: string, agentsRoot: string): string {
    const relativeDir = path.relative(agentsRoot, path.dirname(filePath));
    const pathParts = relativeDir.split(path.sep).filter(Boolean);
    const sessionsIndex = pathParts.indexOf('sessions');

    if (sessionsIndex !== -1) {
        pathParts.splice(sessionsIndex, 1);
    }

    return pathParts.length > 0 ? pathParts.join(path.sep) : '.';
}

function parseUsage(value: unknown): ParsedOpenClawUsage | null {
    if (!isObject(value)) {
        return null;
    }

    const cost = isObject(value.cost) ? value.cost : null;
    return {
        cacheRead: toNumber(value.cacheRead),
        cacheWrite: toNumber(value.cacheWrite),
        costTotal: cost ? toNullableNumber(cost.total) : null,
        input: toNumber(value.input),
        output: toNumber(value.output)
    };
}

function hasUsage(totals: TokenTotals, costUsd: number | null): boolean {
    return totals.inputTokens > 0
        || totals.cachedInputTokens > 0
        || totals.outputTokens > 0
        || totals.reasoningOutputTokens > 0
        || totals.totalTokens > 0
        || (costUsd !== null && costUsd > 0);
}

function shouldReplaceExistingRecord(existing: UsageRecord, next: UsageRecord): boolean {
    if (next.totals.totalTokens !== existing.totals.totalTokens) {
        return next.totals.totalTokens > existing.totals.totalTokens;
    }

    if (next.timestamp !== existing.timestamp) {
        return next.timestamp > existing.timestamp;
    }

    const existingCost = existing.estimatedCostUsd ?? 0;
    const nextCost = next.estimatedCostUsd ?? 0;
    return nextCost > existingCost;
}

function parseUsageFile(filePath: string, agentsRoot: string): UsageRecord[] {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n');
    const fallbackSessionId = path.basename(filePath, '.jsonl');
    const sessionRelativeDir = parseSessionRelativeDir(filePath, agentsRoot);

    const recordsByKey = new Map<string, UsageRecord>();
    let sessionId = fallbackSessionId;
    let currentModel: string | null = null;

    for (const [index, line] of lines.entries()) {
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

        if (parsed.type === 'session' && typeof parsed.id === 'string' && parsed.id.trim() !== '') {
            sessionId = parsed.id;
            continue;
        }

        if (parsed.type === 'model_change' && typeof parsed.modelId === 'string') {
            currentModel = parsed.modelId;
            continue;
        }

        if (parsed.type === 'custom'
            && parsed.customType === 'model-snapshot'
            && isObject(parsed.data)
            && typeof parsed.data.modelId === 'string') {
            currentModel = parsed.data.modelId;
            continue;
        }

        if (parsed.type !== 'message') {
            continue;
        }

        const message = isObject(parsed.message) ? parsed.message : null;
        if (!message || message.role !== 'assistant') {
            continue;
        }

        const usage = parseUsage(message.usage);
        const timestamp = typeof parsed.timestamp === 'string'
            ? parsed.timestamp
            : (typeof message.timestamp === 'number'
                ? new Date(message.timestamp).toISOString()
                : null);

        if (!usage || !timestamp) {
            continue;
        }

        const cachedInputTokens = usage.cacheRead + usage.cacheWrite;
        const inputTokens = usage.input + cachedInputTokens;
        const totals: TokenTotals = {
            inputTokens,
            cachedInputTokens,
            outputTokens: usage.output,
            reasoningOutputTokens: 0,
            totalTokens: inputTokens + usage.output
        };

        if (!hasUsage(totals, usage.costTotal)) {
            continue;
        }

        const record: UsageRecord = {
            source: 'openclaw',
            timestamp,
            model: typeof message.model === 'string' ? message.model : currentModel,
            sessionId,
            sessionShortId: parseSessionShortId(sessionId),
            sessionRelativeDir,
            sessionFile: filePath,
            totals,
            estimatedCostUsd: usage.costTotal,
            pricingModel: null
        };

        const key = typeof parsed.id === 'string' && parsed.id.trim() !== ''
            ? parsed.id
            : `line:${index}`;
        const existing = recordsByKey.get(key);
        if (!existing || shouldReplaceExistingRecord(existing, record)) {
            recordsByKey.set(key, record);
        }
    }

    return [...recordsByKey.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export function resolveOpenClawHome(explicitOpenclawHome?: string): string {
    if (explicitOpenclawHome) {
        return explicitOpenclawHome;
    }

    const stateDir = process.env.OPENCLAW_STATE_DIR;
    return stateDir && stateDir.trim() !== '' ? stateDir : path.join(os.homedir(), '.openclaw');
}

export function parseOpenClawUsage(
    explicitOpenclawHome?: string,
    cache?: UsageCacheStore
): ParsedSourceUsage {
    const openclawHome = resolveOpenClawHome(explicitOpenclawHome);
    const agentsRoot = path.join(openclawHome, 'agents');
    const sessionFiles = collectJsonlFiles(agentsRoot);
    const existingFiles = new Set(sessionFiles);
    const records: UsageRecord[] = [];

    for (const filePath of sessionFiles) {
        const stats = fs.statSync(filePath);
        const cached = cache?.get(filePath, 'openclaw', stats.mtimeMs, stats.size);
        if (cached) {
            records.push(...cached.records);
            continue;
        }

        const parsedRecords = parseUsageFile(filePath, agentsRoot);
        cache?.set(filePath, 'openclaw', stats.mtimeMs, stats.size, parsedRecords, null);
        records.push(...parsedRecords);
    }

    cache?.prune('openclaw', existingFiles);

    return {
        metadata: {
            source: 'openclaw',
            rootPath: agentsRoot,
            sessionFiles: sessionFiles.length,
            latestRateLimits: null
        },
        records
    };
}

export function withOpenClawUsage(
    data: ParsedUsageData,
    explicitOpenclawHome?: string,
    cache?: UsageCacheStore
): ParsedUsageData {
    const parsed = parseOpenClawUsage(explicitOpenclawHome, cache);
    return {
        ...data,
        records: [...data.records, ...parsed.records],
        sources: {
            ...data.sources,
            openclaw: parsed.metadata
        }
    };
}
