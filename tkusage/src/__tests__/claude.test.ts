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

    it('includes sidechains by default, deduplicates request ids across files, and supports main-thread-only mode', () => {
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
                requestId: 'req-main-sidechain',
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

        writeJsonlFile(claudeHome, path.join('projects', 'workspace-a', 'session-a', 'subagents', 'agent-a.jsonl'), [
            {
                type: 'assistant',
                timestamp: '2026-03-09T10:00:02.000Z',
                requestId: 'req-1',
                sessionId: 'session-a',
                isSidechain: true,
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
                        output_tokens: 12
                    }
                }
            },
            {
                type: 'assistant',
                timestamp: '2026-03-09T10:02:00.000Z',
                requestId: 'req-subagent-only',
                sessionId: 'session-a',
                isSidechain: true,
                message: {
                    model: 'claude-sonnet-4-5-20250929',
                    usage: {
                        input_tokens: 7,
                        output_tokens: 3
                    }
                }
            }
        ]);

        const parsed = parseClaudeUsage(claudeHome);
        const parsedMainThreadOnly = parseClaudeUsage(claudeHome, undefined, {
            mainThreadOnly: true
        });

        expect(parsed.metadata.sessionFiles).toBe(2);
        expect(parsed.records).toHaveLength(4);
        expect(parsed.records[0]).toMatchObject({
            source: 'claude',
            sessionId: 'session-a',
            sessionShortId: 'ession-a',
            sessionRelativeDir: 'workspace-a',
            pricingModel: 'claude-sonnet-4-5'
        });
        expect(parsed.records[0]?.totals).toEqual({
            inputTokens: 150,
            cachedInputTokens: 50,
            outputTokens: 12,
            reasoningOutputTokens: 0,
            totalTokens: 162
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
        expect(parsed.records.every(record => record.sessionRelativeDir === 'workspace-a')).toBe(true);
        expect(parsed.records.some(record => record.nativeMetadata?.requestId === 'req-main-sidechain')).toBe(true);
        expect(parsed.records.some(record => record.nativeMetadata?.requestId === 'req-subagent-only')).toBe(true);

        expect(parsed.records[3]).toMatchObject({
            pricingModel: 'claude-haiku-4-5',
            totals: {
                inputTokens: 50,
                cachedInputTokens: 10,
                outputTokens: 8,
                reasoningOutputTokens: 0,
                totalTokens: 58
            }
        });

        expect(parsedMainThreadOnly.records).toHaveLength(2);
        expect(parsedMainThreadOnly.records.every(record => record.sessionRelativeDir === 'workspace-a')).toBe(true);
        expect(parsedMainThreadOnly.records.some(record => record.nativeMetadata?.requestId === 'req-main-sidechain')).toBe(false);
        expect(parsedMainThreadOnly.records.some(record => record.nativeMetadata?.requestId === 'req-subagent-only')).toBe(false);
        expect(parsedMainThreadOnly.records[0]?.totals).toEqual({
            inputTokens: 150,
            cachedInputTokens: 50,
            outputTokens: 10,
            reasoningOutputTokens: 0,
            totalTokens: 160
        });
    });
});
