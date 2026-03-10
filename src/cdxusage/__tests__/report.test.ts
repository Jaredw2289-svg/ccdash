import {
    describe,
    expect,
    it
} from 'vitest';

import { renderReport } from '../format';
import { buildReport } from '../report';
import type { ParsedUsageData } from '../types';

const FIXTURE: ParsedUsageData = {
    codexHome: '/tmp/.codex',
    sessionRoot: '/tmp/.codex/sessions',
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
    },
    records: [
        {
            timestamp: '2026-03-09T18:00:00.000Z',
            model: 'gpt-5.4',
            sessionId: 'session-a',
            sessionShortId: 'ession-a',
            sessionRelativeDir: '2026/03/09',
            sessionFile: '/tmp/.codex/sessions/2026/03/09/session-a.jsonl',
            totals: {
                inputTokens: 1000,
                cachedInputTokens: 300,
                outputTokens: 120,
                reasoningOutputTokens: 40,
                totalTokens: 1120
            }
        },
        {
            timestamp: '2026-03-09T19:00:00.000Z',
            model: 'gpt-5.1-codex-mini',
            sessionId: 'session-b',
            sessionShortId: 'ession-b',
            sessionRelativeDir: '2026/03/09',
            sessionFile: '/tmp/.codex/sessions/2026/03/09/session-b.jsonl',
            totals: {
                inputTokens: 400,
                cachedInputTokens: 100,
                outputTokens: 60,
                reasoningOutputTokens: 10,
                totalTokens: 460
            }
        },
        {
            timestamp: '2026-03-08T21:00:00.000Z',
            model: 'unknown-model',
            sessionId: 'session-c',
            sessionShortId: 'ession-c',
            sessionRelativeDir: '2026/03/08',
            sessionFile: '/tmp/.codex/sessions/2026/03/08/session-c.jsonl',
            totals: {
                inputTokens: 200,
                cachedInputTokens: 0,
                outputTokens: 30,
                reasoningOutputTokens: 0,
                totalTokens: 230
            }
        }
    ]
};

describe('buildReport', () => {
    it('aggregates daily usage with per-model breakdowns and partial pricing coverage', () => {
        const report = buildReport(FIXTURE, {
            reportType: 'daily',
            timezone: 'America/Los_Angeles',
            breakdown: true
        });

        expect(report.rows).toHaveLength(2);
        expect(report.rows[0]).toMatchObject({
            key: '2026-03-09',
            sessionCount: 2,
            hasUnpricedUsage: false
        });
        expect(report.rows[0]?.usage).toEqual({
            inputTokens: 1400,
            cachedInputTokens: 400,
            outputTokens: 180,
            reasoningOutputTokens: 50,
            totalTokens: 1580
        });
        expect(report.rows[0]?.breakdown).toHaveLength(2);
        expect(report.rows[1]).toMatchObject({
            key: '2026-03-08',
            hasUnpricedUsage: true
        });
        expect(report.totals.hasUnpricedUsage).toBe(true);
        expect(report.totals.costUsd).toBeGreaterThan(0);
    });

    it('renders a readable report with totals and latest limit context', () => {
        const report = buildReport(FIXTURE, {
            reportType: 'session',
            timezone: 'America/Los_Angeles',
            compact: true,
            breakdown: true
        });

        const output = renderReport(report);

        expect(output).toContain('cdxusage session report');
        expect(output).toContain('Latest limits: plan=plus | 5h=0.0% | 7d=17.0%');
        expect(output).toContain('TOTAL');
        expect(output).toContain('breakdown');
    });
});