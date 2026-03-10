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
            '/tmp/b'
        ], 'test');

        expect(parsed).toMatchObject({
            command: 'daily',
            period: '2026-03-09',
            source: 'all',
            compact: true,
            claudeHome: '/tmp/a',
            codexHome: '/tmp/b'
        });
    });

    it('emits stable report json with explicit source rows and custom homes', () => {
        const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tkusage-cli-claude-'));
        const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tkusage-cli-codex-'));
        tempDirs.push(claudeHome, codexHome);

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
            codexHome
        ], {
            loadUsageData,
            version: 'test'
        });
        const parsed = JSON.parse(output) as {
            rows: { source: string }[];
            sources: {
                claude: { rootPath: string };
                codex: { rootPath: string };
            };
        };

        expect(parsed.rows).toHaveLength(2);
        expect(parsed.rows.map(row => row.source).sort()).toEqual(['claude', 'codex']);
        expect(parsed.sources.claude.rootPath).toBe(path.join(claudeHome, 'projects'));
        expect(parsed.sources.codex.rootPath).toBe(path.join(codexHome, 'sessions'));
    });

    it('renders a compact empty report without crashing', () => {
        const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tkusage-empty-claude-'));
        const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tkusage-empty-codex-'));
        tempDirs.push(claudeHome, codexHome);

        const output = createCliOutput({
            breakdown: false,
            claudeHome,
            codexHome,
            command: 'daily',
            compact: true,
            json: false,
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