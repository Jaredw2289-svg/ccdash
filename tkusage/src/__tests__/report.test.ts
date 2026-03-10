import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import {
    buildReport,
    buildStatusline
} from '../report';
import type { ParsedUsageData } from '../types';

const FIXTURE: ParsedUsageData = {
    selectedSource: 'all',
    sources: {
        claude: {
            source: 'claude',
            rootPath: '/tmp/.claude/projects',
            sessionFiles: 2,
            latestRateLimits: null
        },
        codex: {
            source: 'codex',
            rootPath: '/tmp/.codex/sessions',
            sessionFiles: 2,
            latestRateLimits: {
                timestamp: '2026-03-09T18:00:00.000Z',
                planType: 'plus',
                primaryUsedPercent: 0,
                primaryWindowMinutes: 300,
                primaryResetsAt: 1,
                secondaryUsedPercent: 17,
                secondaryWindowMinutes: 10080,
                secondaryResetsAt: 2,
                creditsBalance: null,
                creditsHasUnlimited: null
            }
        }
    },
    records: [
        {
            source: 'claude',
            timestamp: '2026-03-01T07:30:00.000Z',
            model: 'claude-sonnet-4-5-20250929',
            sessionId: 'claude-session-a',
            sessionShortId: 'ession-a',
            sessionRelativeDir: 'workspace-a',
            sessionFile: '/tmp/.claude/projects/workspace-a/claude-session-a.jsonl',
            totals: {
                inputTokens: 100,
                cachedInputTokens: 50,
                outputTokens: 10,
                reasoningOutputTokens: 0,
                totalTokens: 160
            },
            estimatedCostUsd: 0.0025,
            pricingModel: 'claude-sonnet-4-5'
        },
        {
            source: 'codex',
            timestamp: '2026-03-01T10:30:00.000Z',
            model: 'gpt-5.4',
            sessionId: 'codex-session-a',
            sessionShortId: 'ession-b',
            sessionRelativeDir: '2026/03/01',
            sessionFile: '/tmp/.codex/sessions/2026/03/01/codex-session-a.jsonl',
            totals: {
                inputTokens: 1000,
                cachedInputTokens: 300,
                outputTokens: 120,
                reasoningOutputTokens: 40,
                totalTokens: 1120
            },
            estimatedCostUsd: 0.00325,
            pricingModel: 'gpt-5.4'
        },
        {
            source: 'codex',
            timestamp: '2026-03-09T19:00:00.000Z',
            model: 'gpt-5.1-codex-mini',
            sessionId: 'codex-session-b',
            sessionShortId: 'ession-c',
            sessionRelativeDir: '2026/03/09',
            sessionFile: '/tmp/.codex/sessions/2026/03/09/codex-session-b.jsonl',
            totals: {
                inputTokens: 400,
                cachedInputTokens: 100,
                outputTokens: 60,
                reasoningOutputTokens: 10,
                totalTokens: 460
            },
            estimatedCostUsd: 0.00097,
            pricingModel: 'gpt-5.1-codex-mini'
        }
    ]
};

describe('buildReport', () => {
    it('builds merged daily rows with explicit source fields', () => {
        const report = buildReport(FIXTURE, {
            reportType: 'daily',
            selectedSource: 'all',
            timezone: 'America/Los_Angeles',
            breakdown: true
        });

        expect(report.rows).toHaveLength(3);
        expect(report.rows[0]).toMatchObject({
            label: '2026-03-09',
            source: 'codex'
        });
        expect(report.rows[1]).toMatchObject({
            label: '2026-03-01',
            source: 'codex'
        });
        expect(report.rows[2]).toMatchObject({
            label: '2026-02-28',
            source: 'claude'
        });
        expect(report.totals.costUsd).toBeCloseTo(0.00672, 5);
    });

    it('groups monthly rows across timezone boundaries', () => {
        const report = buildReport(FIXTURE, {
            reportType: 'monthly',
            selectedSource: 'all',
            timezone: 'America/Los_Angeles'
        });

        expect(report.rows).toHaveLength(2);
        expect(report.rows.some(row => row.label === '2026-02' && row.source === 'claude')).toBe(true);
        expect(report.rows.some(row => row.label === '2026-03' && row.source === 'codex')).toBe(true);
    });

    it('filters session rows by session id fragment', () => {
        const report = buildReport(FIXTURE, {
            reportType: 'session',
            selectedSource: 'all',
            timezone: 'UTC',
            sessionFilter: 'session-b'
        });

        expect(report.rows).toHaveLength(1);
        expect(report.rows[0]).toMatchObject({
            sessionId: 'codex-session-b',
            source: 'codex'
        });
    });
});

describe('buildStatusline', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-09T12:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns per-source totals for the current day', () => {
        const statusline = buildStatusline(FIXTURE, {
            selectedSource: 'all',
            timezone: 'UTC'
        });

        expect(statusline.sourceTotals).toEqual([
            {
                source: 'codex',
                costUsd: 0.00097,
                hasUnpricedUsage: false
            }
        ]);
    });
});