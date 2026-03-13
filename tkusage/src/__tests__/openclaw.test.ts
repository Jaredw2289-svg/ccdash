import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    afterEach,
    describe,
    expect,
    it
} from 'vitest';

import { parseOpenClawUsage } from '../sources/openclaw';

function writeJsonlFile(rootDir: string, relativePath: string, lines: unknown[]): string {
    const filePath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, lines.map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n'));
    return filePath;
}

describe('parseOpenClawUsage', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        tempDirs.length = 0;
    });

    it('parses assistant usage across agents, ignores backup files, and leaves missing cost unpriced', () => {
        const openclawHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tkusage-openclaw-'));
        tempDirs.push(openclawHome);

        writeJsonlFile(openclawHome, path.join('agents', 'main', 'sessions', 'session-a.jsonl'), [
            '{bad json',
            {
                type: 'session',
                id: 'openclaw-session-a',
                timestamp: '2026-03-09T10:00:00.000Z'
            },
            {
                type: 'model_change',
                id: 'model-a',
                timestamp: '2026-03-09T10:00:01.000Z',
                modelId: 'claude-sonnet-4-6'
            },
            {
                type: 'message',
                id: 'assistant-a',
                timestamp: '2026-03-09T10:00:05.000Z',
                message: {
                    role: 'assistant',
                    usage: {
                        input: 1,
                        cacheRead: 2,
                        cacheWrite: 3,
                        output: 4,
                        totalTokens: 10,
                        cost: {
                            total: 0.25
                        }
                    }
                }
            },
            {
                type: 'message',
                id: 'assistant-aborted',
                timestamp: '2026-03-09T10:00:06.000Z',
                message: {
                    role: 'assistant',
                    provider: 'openclaw',
                    model: 'delivery-mirror',
                    usage: {
                        input: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                        output: 0,
                        totalTokens: 0,
                        cost: {
                            total: 0
                        }
                    }
                }
            },
            {
                type: 'message',
                id: 'user-a',
                timestamp: '2026-03-09T10:00:07.000Z',
                message: {
                    role: 'user',
                    usage: {
                        input: 999,
                        output: 999
                    }
                }
            }
        ]);

        writeJsonlFile(openclawHome, path.join('agents', 'reviewer', 'sessions', 'session-b.jsonl'), [
            {
                type: 'custom',
                customType: 'model-snapshot',
                timestamp: '2026-03-09T11:00:00.000Z',
                data: {
                    modelId: 'gpt-5.4'
                }
            },
            {
                type: 'message',
                id: 'assistant-b',
                timestamp: '2026-03-09T11:00:05.000Z',
                message: {
                    role: 'assistant',
                    model: 'gpt-5.4',
                    usage: {
                        input: 5,
                        cacheRead: 7,
                        cacheWrite: 11,
                        output: 13,
                        totalTokens: 36
                    }
                }
            }
        ]);

        writeJsonlFile(openclawHome, path.join('agents', 'archived', 'sessions', 'ignored.jsonl.deleted.2026-03-09T11-00-00.000Z'), [
            {
                type: 'message',
                id: 'ignored',
                timestamp: '2026-03-09T12:00:00.000Z',
                message: {
                    role: 'assistant',
                    model: 'claude-sonnet-4-6',
                    usage: {
                        input: 100,
                        output: 100,
                        cost: {
                            total: 10
                        }
                    }
                }
            }
        ]);

        const parsed = parseOpenClawUsage(openclawHome);

        expect(parsed.metadata.rootPath).toBe(path.join(openclawHome, 'agents'));
        expect(parsed.metadata.sessionFiles).toBe(2);
        expect(parsed.records).toHaveLength(2);
        expect(parsed.records[0]).toMatchObject({
            source: 'openclaw',
            sessionId: 'openclaw-session-a',
            sessionShortId: 'ession-a',
            sessionRelativeDir: 'main',
            model: 'claude-sonnet-4-6',
            pricingModel: null,
            estimatedCostUsd: 0.25
        });
        expect(parsed.records[0]?.totals).toEqual({
            inputTokens: 6,
            cachedInputTokens: 5,
            outputTokens: 4,
            reasoningOutputTokens: 0,
            totalTokens: 10
        });
        expect(parsed.records[1]).toMatchObject({
            source: 'openclaw',
            sessionId: 'session-b',
            sessionShortId: 'ession-b',
            sessionRelativeDir: 'reviewer',
            model: 'gpt-5.4',
            pricingModel: null,
            estimatedCostUsd: null
        });
        expect(parsed.records[1]?.totals).toEqual({
            inputTokens: 23,
            cachedInputTokens: 18,
            outputTokens: 13,
            reasoningOutputTokens: 0,
            totalTokens: 36
        });
    });
});
