import type {
    RecordNativeMetadata,
    TokenTotals,
    UsageSource
} from './types';

interface CodexPricingRate {
    source: 'codex';
    canonicalModel: string;
    inputUsdPerMillion: number;
    cachedInputUsdPerMillion: number;
    outputUsdPerMillion: number;
}

interface ClaudePricingRate {
    source: 'claude';
    canonicalModel: string;
    inputUsdPerMillion: number;
    cacheWrite5mUsdPerMillion: number;
    cacheWrite1hUsdPerMillion: number;
    cacheReadUsdPerMillion: number;
    outputUsdPerMillion: number;
}

export type PricingRate = ClaudePricingRate | CodexPricingRate;

const CODEX_PRICING_TABLE: CodexPricingRate[] = [
    {
        source: 'codex',
        canonicalModel: 'gpt-5.4',
        inputUsdPerMillion: 2.5,
        cachedInputUsdPerMillion: 0.25,
        outputUsdPerMillion: 15
    },
    {
        source: 'codex',
        canonicalModel: 'gpt-5.3-codex',
        inputUsdPerMillion: 1.5,
        cachedInputUsdPerMillion: 0.15,
        outputUsdPerMillion: 10
    },
    {
        source: 'codex',
        canonicalModel: 'gpt-5.1-codex',
        inputUsdPerMillion: 1.25,
        cachedInputUsdPerMillion: 0.125,
        outputUsdPerMillion: 10
    },
    {
        source: 'codex',
        canonicalModel: 'gpt-5.1-codex-mini',
        inputUsdPerMillion: 0.25,
        cachedInputUsdPerMillion: 0.025,
        outputUsdPerMillion: 2
    }
];

const CLAUDE_PRICING_TABLE: ClaudePricingRate[] = [
    {
        source: 'claude',
        canonicalModel: 'claude-opus-4-6',
        inputUsdPerMillion: 5,
        cacheWrite5mUsdPerMillion: 6.25,
        cacheWrite1hUsdPerMillion: 10,
        cacheReadUsdPerMillion: 0.5,
        outputUsdPerMillion: 25
    },
    {
        source: 'claude',
        canonicalModel: 'claude-opus-4-1',
        inputUsdPerMillion: 15,
        cacheWrite5mUsdPerMillion: 18.75,
        cacheWrite1hUsdPerMillion: 30,
        cacheReadUsdPerMillion: 1.5,
        outputUsdPerMillion: 75
    },
    {
        source: 'claude',
        canonicalModel: 'claude-sonnet-4-5',
        inputUsdPerMillion: 3,
        cacheWrite5mUsdPerMillion: 3.75,
        cacheWrite1hUsdPerMillion: 6,
        cacheReadUsdPerMillion: 0.3,
        outputUsdPerMillion: 15
    },
    {
        source: 'claude',
        canonicalModel: 'claude-haiku-4-5',
        inputUsdPerMillion: 1,
        cacheWrite5mUsdPerMillion: 1.25,
        cacheWrite1hUsdPerMillion: 2,
        cacheReadUsdPerMillion: 0.1,
        outputUsdPerMillion: 5
    }
];

const CODEX_MODEL_ALIASES: Record<string, string> = {
    'gpt-5-codex': 'gpt-5.1-codex',
    'gpt-5-codex-mini': 'gpt-5.1-codex-mini',
    'gpt-5.4-codex': 'gpt-5.4'
};

function normalizeModelKey(model: string): string {
    return model.trim().toLowerCase();
}

function getCodexPricingRate(model: string): CodexPricingRate | null {
    const normalized = normalizeModelKey(model);
    const aliased = CODEX_MODEL_ALIASES[normalized] ?? normalized;

    const exact = CODEX_PRICING_TABLE.find(rate => rate.canonicalModel === aliased);
    if (exact) {
        return exact;
    }

    if (aliased.includes('gpt-5.4')) {
        return CODEX_PRICING_TABLE[0] ?? null;
    }

    if (aliased.includes('gpt-5.3-codex')) {
        return CODEX_PRICING_TABLE[1] ?? null;
    }

    if (aliased.includes('mini')) {
        return CODEX_PRICING_TABLE[3] ?? null;
    }

    if (aliased.includes('codex')) {
        return CODEX_PRICING_TABLE[2] ?? null;
    }

    return null;
}

function getClaudePricingRate(model: string): ClaudePricingRate | null {
    const normalized = normalizeModelKey(model);

    if (normalized.includes('opus-4-6')) {
        return CLAUDE_PRICING_TABLE[0] ?? null;
    }

    if (normalized.includes('opus-4-1') || normalized.includes('opus-4-5') || normalized.includes('opus-4')) {
        return CLAUDE_PRICING_TABLE[1] ?? null;
    }

    if (normalized.includes('sonnet-4-6') || normalized.includes('sonnet-4-5') || normalized.includes('sonnet-4')) {
        return CLAUDE_PRICING_TABLE[2] ?? null;
    }

    if (normalized.includes('haiku-4-5') || normalized.includes('haiku-4')) {
        return CLAUDE_PRICING_TABLE[3] ?? null;
    }

    return null;
}

export function getPricingRate(source: UsageSource, model: string | null): PricingRate | null {
    if (!model) {
        return null;
    }

    return source === 'claude' ? getClaudePricingRate(model) : getCodexPricingRate(model);
}

function calculateCodexCostUsd(usage: TokenTotals, rate: CodexPricingRate): number {
    const nonCachedInputTokens = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
    const outputTokens = usage.outputTokens + usage.reasoningOutputTokens;

    const inputCost = (nonCachedInputTokens / 1_000_000) * rate.inputUsdPerMillion;
    const cachedCost = (usage.cachedInputTokens / 1_000_000) * rate.cachedInputUsdPerMillion;
    const outputCost = (outputTokens / 1_000_000) * rate.outputUsdPerMillion;

    return inputCost + cachedCost + outputCost;
}

function calculateClaudeCostUsd(
    usage: TokenTotals,
    rate: ClaudePricingRate,
    nativeMetadata?: RecordNativeMetadata
): number {
    const cacheCreationInputTokens = nativeMetadata?.cacheCreationInputTokens ?? 0;
    const cacheReadInputTokens = nativeMetadata?.cacheReadInputTokens ?? 0;
    const cacheCreation = nativeMetadata?.cacheCreation;
    const cacheCreation5mTokens = cacheCreation?.ephemeral5mInputTokens ?? 0;
    const cacheCreation1hTokens = cacheCreation?.ephemeral1hInputTokens ?? 0;
    const attributedCacheCreationTokens = cacheCreation5mTokens + cacheCreation1hTokens;
    const remainingCacheCreationTokens = Math.max(0, cacheCreationInputTokens - attributedCacheCreationTokens);

    const inputCost = (usage.inputTokens / 1_000_000) * rate.inputUsdPerMillion;
    const cacheWrite5mCost = ((cacheCreation5mTokens + remainingCacheCreationTokens) / 1_000_000)
        * rate.cacheWrite5mUsdPerMillion;
    const cacheWrite1hCost = (cacheCreation1hTokens / 1_000_000) * rate.cacheWrite1hUsdPerMillion;
    const cacheReadCost = (cacheReadInputTokens / 1_000_000) * rate.cacheReadUsdPerMillion;
    const outputCost = (usage.outputTokens / 1_000_000) * rate.outputUsdPerMillion;

    return inputCost + cacheWrite5mCost + cacheWrite1hCost + cacheReadCost + outputCost;
}

export function calculateEstimatedCostUsd(
    source: UsageSource,
    usage: TokenTotals,
    model: string | null,
    nativeMetadata?: RecordNativeMetadata
): number | null {
    const rate = getPricingRate(source, model);
    if (!rate) {
        return null;
    }

    return rate.source === 'claude'
        ? calculateClaudeCostUsd(usage, rate, nativeMetadata)
        : calculateCodexCostUsd(usage, rate);
}

export function getPricingNote(): string {
    return 'Estimated USD using embedded Claude and Codex token pricing. Not a vendor billing statement.';
}