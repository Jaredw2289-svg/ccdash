import type { BlockMetrics } from '../types';

import { getCachedBlockMetrics } from './jsonl';
import {
    FIVE_HOUR_BLOCK_MS,
    SEVEN_DAY_WINDOW_MS,
    type UsageData,
    type UsageError,
    type UsageWindowMetrics
} from './usage-types';

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function buildUsageWindow(resetAtMs: number, nowMs: number, durationMs: number): UsageWindowMetrics | null {
    if (!Number.isFinite(resetAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(durationMs) || durationMs <= 0) {
        return null;
    }

    const startAtMs = resetAtMs - durationMs;
    const elapsedMs = clamp(nowMs - startAtMs, 0, durationMs);
    const remainingMs = durationMs - elapsedMs;
    const elapsedPercent = (elapsedMs / durationMs) * 100;

    return {
        sessionDurationMs: durationMs,
        elapsedMs,
        remainingMs,
        elapsedPercent,
        remainingPercent: 100 - elapsedPercent
    };
}

export function getUsageWindowFromResetAt(sessionResetAt: string | undefined, nowMs = Date.now()): UsageWindowMetrics | null {
    if (!sessionResetAt) {
        return null;
    }

    const resetAtMs = Date.parse(sessionResetAt);
    if (Number.isNaN(resetAtMs)) {
        return null;
    }

    return buildUsageWindow(resetAtMs, nowMs, FIVE_HOUR_BLOCK_MS);
}

export function getUsageWindowFromBlockMetrics(blockMetrics: BlockMetrics, nowMs = Date.now()): UsageWindowMetrics | null {
    const startAtMs = blockMetrics.startTime.getTime();
    if (Number.isNaN(startAtMs)) {
        return null;
    }

    return buildUsageWindow(startAtMs + FIVE_HOUR_BLOCK_MS, nowMs, FIVE_HOUR_BLOCK_MS);
}

export function resolveUsageWindowWithFallback(
    usageData: UsageData,
    blockMetrics?: BlockMetrics | null,
    nowMs = Date.now()
): UsageWindowMetrics | null {
    const usageWindow = getUsageWindowFromResetAt(usageData.sessionResetAt, nowMs);
    if (usageWindow) {
        return usageWindow;
    }

    const fallbackMetrics = blockMetrics ?? getCachedBlockMetrics();
    if (!fallbackMetrics) {
        return null;
    }

    return getUsageWindowFromBlockMetrics(fallbackMetrics, nowMs);
}

export function getWeeklyUsageWindowFromResetAt(weeklyResetAt: string | undefined, nowMs = Date.now()): UsageWindowMetrics | null {
    if (!weeklyResetAt) {
        return null;
    }

    const resetAtMs = Date.parse(weeklyResetAt);
    if (Number.isNaN(resetAtMs)) {
        return null;
    }

    return buildUsageWindow(resetAtMs, nowMs, SEVEN_DAY_WINDOW_MS);
}

export function resolveWeeklyUsageWindow(usageData: UsageData, nowMs = Date.now()): UsageWindowMetrics | null {
    return getWeeklyUsageWindowFromResetAt(usageData.weeklyResetAt, nowMs);
}

export function formatUsageDuration(durationMs: number, compact = false): string {
    const clampedMs = Math.max(0, durationMs);
    const elapsedHours = Math.floor(clampedMs / (1000 * 60 * 60));
    const elapsedMinutes = Math.floor((clampedMs % (1000 * 60 * 60)) / (1000 * 60));

    if (compact) {
        return elapsedMinutes === 0 ? `${elapsedHours}h` : `${elapsedHours}h${elapsedMinutes}m`;
    }

    if (elapsedMinutes === 0) {
        return `${elapsedHours}hr`;
    }

    return `${elapsedHours}hr ${elapsedMinutes}m`;
}

export function formatResetDay(resetAtIso: string): string {
    const resetDate = new Date(resetAtIso);
    if (isNaN(resetDate.getTime()))
        return '';

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const hours = resetDate.getHours();
    const ampm = hours >= 12 ? 'pm' : 'am';
    const hour12 = hours % 12 || 12;
    const timeStr = `${hour12}${ampm}`;

    if (resetDate.toDateString() === tomorrow.toDateString()) {
        return `tomorrow ${timeStr}`;
    }

    const dayName = days[resetDate.getDay()];
    return `${dayName} ${timeStr}`;
}

export function getUsageErrorMessage(error: UsageError): string {
    switch (error) {
        case 'no-credentials': return '[No credentials]';
        case 'timeout': return '[Timeout]';
        case 'rate-limited': return '[Rate limited]';
        case 'api-error': return '[API Error]';
        case 'parse-error': return '[Parse Error]';
    }
}

export function makeUsageProgressBar(percent: number, width = 15, colorCoded = false): string {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    const slateSage = '\x1b[38;2;111;175;143m';
    const slateAmber = '\x1b[38;2;215;166;95m';
    const slateCoral = '\x1b[38;2;201;122;107m';
    const reset = '\x1b[39m';

    if (!colorCoded || filled === 0) {
        return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
    }

    const greenThreshold = Math.round((70 / 100) * width);
    const yellowThreshold = Math.round((90 / 100) * width);

    let bar = '';
    for (let i = 0; i < filled; i++) {
        if (i < greenThreshold) {
            bar += `${slateSage}█${reset}`;
        } else if (i < yellowThreshold) {
            bar += `${slateAmber}█${reset}`;
        } else {
            bar += `${slateCoral}█${reset}`;
        }
    }

    return '[' + bar + '░'.repeat(empty) + ']';
}