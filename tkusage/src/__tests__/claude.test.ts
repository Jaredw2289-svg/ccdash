import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    afterEach,
    describe,
    expect,
    it
} from 'vitest';

import { parseClaudeUsage } from '../sources/claude';

function writeJsonlFile(rootDir: string, relativePath: string, lines: unknown[]): string {
    const filePath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, lines.map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n'));
    return filePath;
}

describe('parseClaudeUsage', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        tempDirs.length = 0;
    });

    it('deduplicates request ids and skips sidechains, malformed lines, and missing timestamps', () => {
        const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tkusage-claude-'));
        tempDirs.push(claudeHome);

        writeJsonlFile(claudeHome, path.join('projects', 'workspace-a', 'session-a.jsonl'), [
            '{not json',
            {
                type: 'assistant',
                timestamp: '2026-03-09T10:00:00.000Z',
                requestId: 'req-1',
                sessionId: 'session-a',
                message: {
                    model: 'claude-sonnet-4-5-20250929',
                    usage: {
                        input_tokens: 100,
                        cache_creation_input_tokens: 20,
                        cache_read_input_tokens: 30,
                        cache_creation: {
                            ephemeral_5m_input_tokens: 5,
                            ephemeral_1h_input_tokens: 15
                        },
                        output_tokens: 10
                    }
                }
            },
            {
                type: 'assistant',
                timestamp: '2026-03-09T10:00:01.000Z',
                requestId: 'req-1',
                sessionId: 'session-a',
                message: {
                    model: 'claude-sonnet-4-5-20250929',
                    usage: {
                        input_tokens: 100,
                        cache_creation_input_tokens: 20,
                        cache_read_input_tokens: 30,
                        cache_creation: {
                            ephemeral_5m_input_tokens: 5,
                            ephemeral_1h_input_tokens: 15
                        },
                        output_tokens: 10
                    }
                }
            },
            {
                type: 'assistant',
                timestamp: '2026-03-09T10:01:00.000Z',
                requestId: 'req-sidechain',
                sessionId: 'session-a',
                isSidechain: true,
                message: {
                    model: 'claude-sonnet-4-5-20250929',
                    usage: {
                        input_tokens: 1,
                        output_tokens: 1
                    }
                }
            },
            {
                type: 'assistant',
                requestId: 'req-missing-ts',
                sessionId: 'session-a',
                message: {
                    model: 'claude-sonnet-4-5-20250929',
                    usage: {
                        input_tokens: 10,
                        output_tokens: 10
                    }
                }
            },
            {
                type: 'assistant',
                timestamp: '2026-03-09T11:00:00.000Z',
                sessionId: 'session-a',
                message: {
                    model: 'claude-haiku-4-5-20251001',
                    usage: {
                        input_tokens: 40,
                        cache_read_input_tokens: 10,
                        output_tokens: 8
                    }
                }
            }
        ]);

        const parsed = parseClaudeUsage(claudeHome);

        expect(parsed.metadata.sessionFiles).toBe(1);
        expect(parsed.records).toHaveLength(2);
        expect(parsed.records[0]).toMatchObject({
            source: 'claude',
            sessionId: 'session-a',
            sessionShortId: 'ession-a',
            sessionRelativeDir: 'workspace-a',
            pricingModel: 'claude-sonnet-4-5'
        });
        expect(parsed.records[0]?.totals).toEqual({
            inputTokens: 100,
            cachedInputTokens: 50,
            outputTokens: 10,
            reasoningOutputTokens: 0,
            totalTokens: 160
        });
        expect(parsed.records[0]?.nativeMetadata).toMatchObject({
            requestId: 'req-1',
            cacheCreationInputTokens: 20,
            cacheReadInputTokens: 30,
            cacheCreation: {
                ephemeral5mInputTokens: 5,
                ephemeral1hInputTokens: 15
            }
        });
        expect(parsed.records[0]?.estimatedCostUsd).toBeGreaterThan(0);

        expect(parsed.records[1]).toMatchObject({ pricingModel: 'claude-haiku-4-5' });
    });
});