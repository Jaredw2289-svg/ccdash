import type {
    PricingRate,
    TokenTotals
} from './types';

const PRICING_TABLE: PricingRate[] = [
    {
        canonicalModel: 'gpt-5.4',
        inputUsdPerMillion: 2.5,
        cachedInputUsdPerMillion: 0.25,
        outputUsdPerMillion: 15
    },
    {
        canonicalModel: 'gpt-5.3-codex',
        inputUsdPerMillion: 1.5,
        cachedInputUsdPerMillion: 0.15,
        outputUsdPerMillion: 10
    },
    {
        canonicalModel: 'gpt-5.1-codex',
        inputUsdPerMillion: 1.25,
        cachedInputUsdPerMillion: 0.125,
        outputUsdPerMillion: 10
    },
    {
        canonicalModel: 'gpt-5.1-codex-mini',
        inputUsdPerMillion: 0.25,
        cachedInputUsdPerMillion: 0.025,
        outputUsdPerMillion: 2
    }
];

const MODEL_ALIASES: Record<string, string> = {
    'gpt-5-codex': 'gpt-5.1-codex',
    'gpt-5-codex-mini': 'gpt-5.1-codex-mini',
    'gpt-5.4-codex': 'gpt-5.4'
};

function normalizeModelKey(model: string): string {
    return model.trim().toLowerCase();
}

export function getPricingRate(model: string | null): PricingRate | null {
    if (!model) {
        return null;
    }

    const normalized = normalizeModelKey(model);
    const aliased = MODEL_ALIASES[normalized] ?? normalized;

    const exact = PRICING_TABLE.find(rate => rate.canonicalModel === aliased);
    if (exact) {
        return exact;
    }

    if (aliased.includes('gpt-5.4')) {
        return PRICING_TABLE[0] ?? null;
    }

    if (aliased.includes('gpt-5.3-codex')) {
        return PRICING_TABLE[1] ?? null;
    }

    if (aliased.includes('mini')) {
        return PRICING_TABLE[3] ?? null;
    }

    if (aliased.includes('codex')) {
        return PRICING_TABLE[2] ?? null;
    }

    return null;
}

export function calculateApiEquivalentCostUsd(usage: TokenTotals, model: string | null): number | null {
    const rate = getPricingRate(model);
    if (!rate) {
        return null;
    }

    const nonCachedInputTokens = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
    const outputTokens = usage.outputTokens + usage.reasoningOutputTokens;

    const inputCost = (nonCachedInputTokens / 1_000_000) * rate.inputUsdPerMillion;
    const cachedCost = (usage.cachedInputTokens / 1_000_000) * rate.cachedInputUsdPerMillion;
    const outputCost = (outputTokens / 1_000_000) * rate.outputUsdPerMillion;

    return inputCost + cachedCost + outputCost;
}