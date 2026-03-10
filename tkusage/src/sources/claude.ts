import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    calculateEstimatedCostUsd,
    getPricingRate
} from '../pricing';
import type {
    ParsedUsageData,
    RecordNativeMetadata,
    SourceMetadata,
    TokenTotals,
    UsageRecord
} from '../types';

interface ParsedSourceUsage {
    metadata: SourceMetadata;
    records: UsageRecord[];
}

interface ParsedClaudeUsage {
    cacheCreation: {
        ephemeral1hInputTokens: number;
        ephemeral5mInputTokens: number;
    };
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    inputTokens: number;
    outputTokens: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function toNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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

function parseSessionShortId(sessionId: string): string {
    return sessionId.slice(-8);
}

function parseSessionRelativeDir(filePath: string, transcriptRoot: string): string {
    const relativeDir = path.relative(transcriptRoot, path.dirname(filePath));
    return relativeDir === '' ? '.' : relativeDir;
}

function parseClaudeUsagePayload(value: unknown): ParsedClaudeUsage | null {
    if (!isObject(value)) {
        return null;
    }

    const cacheCreation = isObject(value.cache_creation) ? value.cache_creation : null;
    const inputTokens = toNumber(value.input_tokens);
    const outputTokens = toNumber(value.output_tokens);
    const cacheCreationInputTokens = toNumber(value.cache_creation_input_tokens);
    const cacheReadInputTokens = toNumber(value.cache_read_input_tokens);

    return {
        cacheCreation: {
            ephemeral1hInputTokens: cacheCreation ? toNumber(cacheCreation.ephemeral_1h_input_tokens) : 0,
            ephemeral5mInputTokens: cacheCreation ? toNumber(cacheCreation.ephemeral_5m_input_tokens) : 0
        },
        cacheCreationInputTokens,
        cacheReadInputTokens,
        inputTokens,
        outputTokens
    };
}

function shouldReplaceExistingRecord(existing: UsageRecord, next: UsageRecord): boolean {
    if (next.totals.totalTokens !== existing.totals.totalTokens) {
        return next.totals.totalTokens > existing.totals.totalTokens;
    }

    if (next.timestamp !== existing.timestamp) {
        return next.timestamp > existing.timestamp;
    }

    return next.totals.outputTokens > existing.totals.outputTokens;
}

function parseUsageFile(filePath: string, transcriptRoot: string): UsageRecord[] {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n');
    const recordsByKey = new Map<string, UsageRecord>();
    const fallbackSessionId = path.basename(filePath, '.jsonl');
    const sessionRelativeDir = parseSessionRelativeDir(filePath, transcriptRoot);

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

        if (!isObject(parsed) || parsed.isSidechain === true || parsed.type !== 'assistant') {
            continue;
        }

        const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : null;
        const message = isObject(parsed.message) ? parsed.message : null;
        const usage = message ? parseClaudeUsagePayload(message.usage) : null;

        if (!timestamp || !usage) {
            continue;
        }

        const sessionId = typeof parsed.sessionId === 'string' && parsed.sessionId.trim() !== ''
            ? parsed.sessionId
            : fallbackSessionId;
        const sessionShortId = parseSessionShortId(sessionId);
        const model = typeof message?.model === 'string' ? message.model : null;
        const cachedInputTokens = usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
        const totals: TokenTotals = {
            inputTokens: usage.inputTokens,
            cachedInputTokens,
            outputTokens: usage.outputTokens,
            reasoningOutputTokens: 0,
            totalTokens: usage.inputTokens + cachedInputTokens + usage.outputTokens
        };
        const nativeMetadata: RecordNativeMetadata = {
            requestId: typeof parsed.requestId === 'string' ? parsed.requestId : undefined,
            cacheCreationInputTokens: usage.cacheCreationInputTokens,
            cacheReadInputTokens: usage.cacheReadInputTokens,
            cacheCreation: usage.cacheCreation
        };
        const pricingRate = getPricingRate('claude', model);
        const record: UsageRecord = {
            source: 'claude',
            timestamp,
            model,
            sessionId,
            sessionShortId,
            sessionRelativeDir,
            sessionFile: filePath,
            totals,
            estimatedCostUsd: calculateEstimatedCostUsd('claude', totals, model, nativeMetadata),
            pricingModel: pricingRate?.canonicalModel ?? null,
            nativeMetadata
        };

        const key = nativeMetadata.requestId ?? `line:${index}`;
        const existing = recordsByKey.get(key);
        if (!existing || shouldReplaceExistingRecord(existing, record)) {
            recordsByKey.set(key, record);
        }
    }

    return [...recordsByKey.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export function resolveClaudeHome(explicitClaudeHome?: string): string {
    if (explicitClaudeHome) {
        return explicitClaudeHome;
    }

    const envConfigDir = process.env.CLAUDE_CONFIG_DIR;
    return envConfigDir && envConfigDir.trim() !== '' ? envConfigDir : path.join(os.homedir(), '.claude');
}

export function parseClaudeUsage(explicitClaudeHome?: string): ParsedSourceUsage {
    const claudeHome = resolveClaudeHome(explicitClaudeHome);
    const transcriptRoot = path.join(claudeHome, 'projects');
    const sessionFiles = collectJsonlFiles(transcriptRoot);
    const records = sessionFiles.flatMap(filePath => parseUsageFile(filePath, transcriptRoot));

    return {
        metadata: {
            source: 'claude',
            rootPath: transcriptRoot,
            sessionFiles: sessionFiles.length,
            latestRateLimits: null
        },
        records
    };
}

export function withClaudeUsage(
    data: ParsedUsageData,
    explicitClaudeHome?: string
): ParsedUsageData {
    const parsed = parseClaudeUsage(explicitClaudeHome);
    return {
        ...data,
        records: [...data.records, ...parsed.records],
        sources: {
            ...data.sources,
            claude: parsed.metadata
        }
    };
}