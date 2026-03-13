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
import { renderReport } from '../format';
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
                inputTokens: 150,
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
                totalTokens: 1160
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
                totalTokens: 470
            },
            estimatedCostUsd: 0.00097,
            pricingModel: 'gpt-5.1-codex-mini'
        }
    ]
};

const SIDECHAIN_FIXTURE: ParsedUsageData = {
    selectedSource: 'claude',
    sources: {
        claude: {
            source: 'claude',
            rootPath: '/tmp/.claude/projects',
            sessionFiles: 2,
            latestRateLimits: null
        }
    },
    records: [
        {
            source: 'claude',
            timestamp: '2026-03-10T08:00:00.000Z',
            model: 'claude-opus-4-6',
            sessionId: 'claude-session-a',
            sessionShortId: 'ession-a',
            sessionRelativeDir: 'workspace-a',
            sessionFile: '/tmp/.claude/projects/workspace-a/claude-session-a.jsonl',
            totals: {
                inputTokens: 100,
                cachedInputTokens: 40,
                outputTokens: 10,
                reasoningOutputTokens: 0,
                totalTokens: 110
            },
            estimatedCostUsd: 1.25,
            pricingModel: 'claude-opus-4-6'
        },
        {
            source: 'claude',
            timestamp: '2026-03-10T08:05:00.000Z',
            model: 'claude-opus-4-6',
            sessionId: 'claude-session-a',
            sessionShortId: 'ession-a',
            sessionRelativeDir: 'workspace-a/claude-session-a/subagents',
            sessionFile: '/tmp/.claude/projects/workspace-a/claude-session-a/subagents/agent-a.jsonl',
            totals: {
                inputTokens: 80,
                cachedInputTokens: 30,
                outputTokens: 9,
                reasoningOutputTokens: 0,
                totalTokens: 89
            },
            estimatedCostUsd: 0.95,
            pricingModel: 'claude-opus-4-6'
        },
        {
            source: 'claude',
            timestamp: '2026-03-10T09:00:00.000Z',
            model: 'claude-opus-4-6',
            sessionId: 'claude-session-b',
            sessionShortId: 'ession-b',
            sessionRelativeDir: 'workspace-b',
            sessionFile: '/tmp/.claude/projects/workspace-b/claude-session-b.jsonl',
            totals: {
                inputTokens: 60,
                cachedInputTokens: 20,
                outputTokens: 6,
                reasoningOutputTokens: 0,
                totalTokens: 66
            },
            estimatedCostUsd: 0.8,
            pricingModel: 'claude-opus-4-6'
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
            label: '2026-02-28',
            source: 'claude'
        });
        expect(report.rows[1]).toMatchObject({
            label: '2026-03-01',
            source: 'codex'
        });
        expect(report.rows[2]).toMatchObject({
            label: '2026-03-09',
            source: 'codex'
        });
        expect(report.totals.costUsd).toBeCloseTo(0.00672, 5);
        expect(report.rows[0]?.usage.inputTokens).toBe(150);
        expect(report.rows[1]?.usage.totalTokens).toBe(1160);
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

    it('keeps session counts stable across sidechain rows and prefers the project directory', () => {
        const dailyReport = buildReport(SIDECHAIN_FIXTURE, {
            reportType: 'daily',
            selectedSource: 'claude',
            timezone: 'UTC'
        });
        const sessionReport = buildReport(SIDECHAIN_FIXTURE, {
            reportType: 'session',
            selectedSource: 'claude',
            timezone: 'UTC'
        });

        expect(dailyReport.rows).toHaveLength(1);
        expect(dailyReport.rows[0]?.sessionCount).toBe(2);

        const sessionCostTotal = sessionReport.rows.reduce((sum, row) => sum + row.costUsd, 0);
        expect(dailyReport.rows[0]?.costUsd).toBeCloseTo(sessionCostTotal, 5);

        expect(sessionReport.rows).toHaveLength(2);
        expect(sessionReport.rows.find(row => row.sessionId === 'claude-session-a')?.sessionRelativeDir).toBe('workspace-a');
    });

    it('renders the total row inside the boxed table', () => {
        const report = buildReport(FIXTURE, {
            reportType: 'daily',
            selectedSource: 'all',
            timezone: 'America/Los_Angeles'
        });

        const output = renderReport(report, {
            footer: {
                commands: ['tkusage daily --source all'],
                githubUrl: 'https://github.com/example/repo'
            }
        });

        expect(output).toContain('┌');
        expect(output).toContain('└');
        expect(output).toContain('│ Total');
        expect(output).not.toContain('TOTAL  input=');
        expect(output).toContain('Tokens: Input = total prompt input');
        expect(output).toContain('Common commands');
        expect(output).toContain('tkusage daily --source all');
        expect(output).toContain('Star on GitHub: https://github.com/example/repo');
        expect(output).not.toContain('$32.46+');
    });

    it('renders row separators and ansi colors for tty output', () => {
        const report = buildReport(FIXTURE, {
            reportType: 'daily',
            selectedSource: 'all',
            timezone: 'America/Los_Angeles'
        });
        const originalDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
        const originalNoColor = process.env.NO_COLOR;

        Object.defineProperty(process.stdout, 'isTTY', {
            value: true,
            configurable: true
        });
        delete process.env.NO_COLOR;

        const output = renderReport(report);

        if (originalDescriptor) {
            Object.defineProperty(process.stdout, 'isTTY', originalDescriptor);
        }
        if (originalNoColor === undefined) {
            delete process.env.NO_COLOR;
        } else {
            process.env.NO_COLOR = originalNoColor;
        }

        expect((output.match(/├/g) ?? []).length).toBeGreaterThan(1);
        expect(output).toContain('\u001B[36m');
        expect(output).toContain('\u001B[33m');
    });

    it('merges same-day rows into one visual block while keeping sources separate', () => {
        const report = buildReport(FIXTURE, {
            reportType: 'daily',
            selectedSource: 'all',
            timezone: 'UTC'
        });

        const output = renderReport(report);

        expect((output.match(/│ 2026-03-01 │/g) ?? []).length).toBe(1);
        expect(output).toContain('│ 2026-03-01 │ Claude');
        expect(output).toContain('│            │ Codex ');
        expect(output).toContain('│            ├');
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
