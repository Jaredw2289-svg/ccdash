import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import {
    createCliOutput,
    parseArgs,
    runCli
} from '../cli';
import { loadUsageData } from '../load';

function writeJsonlFile(rootDir: string, relativePath: string, lines: unknown[]): string {
    const filePath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, lines.map(line => JSON.stringify(line)).join('\n'));
    return filePath;
}

describe('cli', () => {
    const tempDirs: string[] = [];

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-09T12:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
        for (const dir of tempDirs) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        tempDirs.length = 0;
    });

    it('parses unified source flags', () => {
        const parsed = parseArgs([
            'daily',
            '2026-03-09',
            '--source',
            'all',
            '--compact',
            '--claude-home',
            '/tmp/a',
            '--codex-home',
            '/tmp/b',
            '--openclaw-home',
            '/tmp/c'
        ], 'test');

        expect(parsed).toMatchObject({
            command: 'daily',
            period: '2026-03-09',
            source: 'all',
            compact: true,
            claudeHome: '/tmp/a',
            codexHome: '/tmp/b',
            openclawHome: '/tmp/c',
            mainThreadOnly: false
        });

        const parsedMainThreadOnly = parseArgs([
            'daily',
            '--source',
            'openclaw',
            '--main-thread-only',
            '--openclaw-home',
            '/tmp/openclaw'
        ], 'test');

        expect(parsedMainThreadOnly.mainThreadOnly).toBe(true);
        expect(parsedMainThreadOnly.source).toBe('openclaw');
        expect(parsedMainThreadOnly.openclawHome).toBe('/tmp/openclaw');
    });

    it('emits stable report json with explicit source rows and custom homes', () => {
        const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tkusage-cli-claude-'));
        const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tkusage-cli-codex-'));
        const openclawHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tkusage-cli-openclaw-'));
        tempDirs.push(claudeHome, codexHome, openclawHome);

        writeJsonlFile(claudeHome, path.join('projects', 'workspace-a', 'session-a.jsonl'), [
            {
                type: 'assistant',
                timestamp: '2026-03-09T08:00:00.000Z',
                requestId: 'req-1',
                sessionId: 'session-a',
                message: {
                    model: 'claude-haiku-4-5-20251001',
                    usage: {
                        input_tokens: 10,
                        cache_read_input_tokens: 5,
                        output_tokens: 3
                    }
                }
            }
        ]);
        writeJsonlFile(codexHome, path.join('sessions', '2026', '03', '09', 'session-b.jsonl'), [
            {
                timestamp: '2026-03-09T09:00:00.000Z',
                type: 'turn_context',
                payload: { model: 'gpt-5.4' }
            },
            {
                timestamp: '2026-03-09T09:00:10.000Z',
                type: 'event_msg',
                payload: {
                    type: 'token_count',
                    info: {
                        total_token_usage: {
                            input_tokens: 20,
                            cached_input_tokens: 5,
                            output_tokens: 2,
                            reasoning_output_tokens: 1,
                            total_tokens: 22
                        }
                    }
                }
            }
        ]);
        writeJsonlFile(openclawHome, path.join('agents', 'main', 'sessions', 'session-c.jsonl'), [
            {
                type: 'session',
                id: 'openclaw-session-c',
                timestamp: '2026-03-09T09:30:00.000Z'
            },
            {
                type: 'message',
                id: 'assistant-c',
                timestamp: '2026-03-09T09:30:10.000Z',
                message: {
                    role: 'assistant',
                    model: 'gpt-5.4',
                    usage: {
                        input: 11,
                        cacheRead: 7,
                        cacheWrite: 5,
                        output: 3,
                        totalTokens: 26,
                        cost: {
                            total: 0.123
                        }
                    }
                }
            }
        ]);

        const output = runCli([
            'daily',
            '--json',
            '--source',
            'all',
            '--timezone',
            'UTC',
            '--claude-home',
            claudeHome,
            '--codex-home',
            codexHome,
            '--openclaw-home',
            openclawHome
        ], {
            loadUsageData,
            version: 'test'
        });
        const parsed = JSON.parse(output) as {
            pricingNote: string;
            rows: {
                source: string;
                usage: {
                    inputTokens: number;
                    cachedInputTokens: number;
                    totalTokens: number;
                };
            }[];
            sources: {
                claude: { rootPath: string };
                codex: { rootPath: string };
                openclaw: { rootPath: string };
            };
        };

        expect(parsed.rows).toHaveLength(3);
        expect(parsed.rows.map(row => row.source).sort()).toEqual(['claude', 'codex', 'openclaw']);
        expect(parsed.rows.find(row => row.source === 'claude')?.usage).toMatchObject({
            inputTokens: 15,
            cachedInputTokens: 5,
            totalTokens: 18
        });
        expect(parsed.rows.find(row => row.source === 'codex')?.usage).toMatchObject({
            inputTokens: 20,
            cachedInputTokens: 5,
            totalTokens: 23
        });
        expect(parsed.rows.find(row => row.source === 'openclaw')?.usage).toMatchObject({
            inputTokens: 23,
            cachedInputTokens: 12,
            totalTokens: 26
        });
        expect(parsed.sources.claude.rootPath).toBe(path.join(claudeHome, 'projects'));
        expect(parsed.sources.codex.rootPath).toBe(path.join(codexHome, 'sessions'));
        expect(parsed.sources.openclaw.rootPath).toBe(path.join(openclawHome, 'agents'));
        expect(parsed.pricingNote).toContain('native OpenClaw session-log costs');
    });

    it('emits openclaw-only daily json with native cost totals', () => {
        const openclawHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tkusage-cli-openclaw-only-'));
        tempDirs.push(openclawHome);

        writeJsonlFile(openclawHome, path.join('agents', 'main', 'sessions', 'session-only.jsonl'), [
            {
                type: 'session',
                id: 'openclaw-session-only',
                timestamp: '2026-03-09T12:00:00.000Z'
            },
            {
                type: 'message',
                id: 'assistant-only',
                timestamp: '2026-03-09T12:00:10.000Z',
                message: {
                    role: 'assistant',
                    model: 'claude-sonnet-4-6',
                    usage: {
                        input: 2,
                        cacheRead: 3,
                        cacheWrite: 4,
                        output: 5,
                        totalTokens: 14,
                        cost: {
                            total: 0.045
                        }
                    }
                }
            }
        ]);

        const output = runCli([
            'daily',
            '--json',
            '--source',
            'openclaw',
            '--timezone',
            'UTC',
            '--openclaw-home',
            openclawHome
        ], {
            loadUsageData,
            version: 'test'
        });

        const parsed = JSON.parse(output) as {
            rows: Array<{
                source: string;
                costUsd: number;
                usage: {
                    inputTokens: number;
                    cachedInputTokens: number;
                    totalTokens: number;
                };
            }>;
        };

        expect(parsed.rows).toHaveLength(1);
        expect(parsed.rows[0]).toMatchObject({
            source: 'openclaw',
            costUsd: 0.045,
            usage: {
                inputTokens: 9,
                cachedInputTokens: 7,
                totalTokens: 14
            }
        });
    });

    it('renders a compact empty report without crashing', () => {
        const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tkusage-empty-claude-'));
        const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tkusage-empty-codex-'));
        const openclawHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tkusage-empty-openclaw-'));
        tempDirs.push(claudeHome, codexHome, openclawHome);

        const output = createCliOutput({
            breakdown: false,
            claudeHome,
            codexHome,
            command: 'daily',
            compact: true,
            json: false,
            mainThreadOnly: false,
            openclawHome,
            order: 'desc',
            source: 'all',
            statuslineFormat: 'plain',
            timezone: 'UTC'
        }, {
            loadUsageData,
            version: 'test'
        });

        expect(output).toContain('No usage records matched the selected filters.');
    });

    it('renders a one-line plain statusline', () => {
        const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tkusage-status-claude-'));
        tempDirs.push(claudeHome);

        writeJsonlFile(claudeHome, path.join('projects', 'workspace-a', 'session-a.jsonl'), [
            {
                type: 'assistant',
                timestamp: '2026-03-09T08:00:00.000Z',
                requestId: 'req-1',
                sessionId: 'session-a',
                message: {
                    model: 'claude-haiku-4-5-20251001',
                    usage: {
                        input_tokens: 10,
                        output_tokens: 3
                    }
                }
            }
        ]);

        const output = runCli([
            'statusline',
            '--source',
            'claude',
            '--timezone',
            'UTC',
            '--claude-home',
            claudeHome
        ], {
            loadUsageData,
            version: 'test'
        });

        expect(output).toContain('2026-03-09 est');
        expect(output).toContain('last claude:ession-a');
    });
});
