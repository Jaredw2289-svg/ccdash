import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    afterEach,
    describe,
    expect,
    it
} from 'vitest';

import { parseCodexUsage } from '../sources/codex';

function writeJsonlFile(rootDir: string, relativePath: string, lines: unknown[]): string {
    const filePath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, lines.map(line => JSON.stringify(line)).join('\n'));
    return filePath;
}

describe('parseCodexUsage', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        tempDirs.length = 0;
    });

    it('extracts usage deltas, model switches, resets, and latest rate limits', () => {
        const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tkusage-codex-'));
        tempDirs.push(codexHome);

        writeJsonlFile(codexHome, path.join('sessions', '2026', '03', '09', 'rollout-a.jsonl'), [
            {
                timestamp: '2026-03-09T10:00:00.000Z',
                type: 'turn_context',
                payload: { model: 'gpt-5.4' }
            },
            {
                timestamp: '2026-03-09T10:00:05.000Z',
                type: 'event_msg',
                payload: {
                    type: 'token_count',
                    info: {
                        total_token_usage: {
                            input_tokens: 100,
                            cached_input_tokens: 20,
                            output_tokens: 10,
                            reasoning_output_tokens: 5,
                            total_tokens: 110
                        }
                    },
                    rate_limits: {
                        plan_type: 'plus',
                        primary: {
                            used_percent: 1,
                            window_minutes: 300,
                            resets_at: 111
                        },
                        secondary: {
                            used_percent: 4,
                            window_minutes: 10080,
                            resets_at: 222
                        }
                    }
                }
            },
            {
                timestamp: '2026-03-09T10:00:06.000Z',
                type: 'event_msg',
                payload: {
                    type: 'token_count',
                    info: {
                        total_token_usage: {
                            input_tokens: 100,
                            cached_input_tokens: 20,
                            output_tokens: 10,
                            reasoning_output_tokens: 5,
                            total_tokens: 110
                        }
                    }
                }
            },
            {
                timestamp: '2026-03-09T10:01:00.000Z',
                type: 'turn_context',
                payload: { model: 'gpt-5.1-codex-mini' }
            },
            {
                timestamp: '2026-03-09T10:01:05.000Z',
                type: 'event_msg',
                payload: {
                    type: 'token_count',
                    info: {
                        total_token_usage: {
                            input_tokens: 150,
                            cached_input_tokens: 30,
                            output_tokens: 20,
                            reasoning_output_tokens: 6,
                            total_tokens: 170
                        }
                    },
                    rate_limits: {
                        plan_type: 'plus',
                        primary: {
                            used_percent: 2,
                            window_minutes: 300,
                            resets_at: 333
                        },
                        secondary: {
                            used_percent: 5,
                            window_minutes: 10080,
                            resets_at: 444
                        }
                    }
                }
            },
            {
                timestamp: '2026-03-09T10:02:05.000Z',
                type: 'event_msg',
                payload: {
                    type: 'token_count',
                    info: {
                        total_token_usage: {
                            input_tokens: 20,
                            cached_input_tokens: 5,
                            output_tokens: 3,
                            reasoning_output_tokens: 0,
                            total_tokens: 23
                        }
                    }
                }
            }
        ]);

        const parsed = parseCodexUsage(codexHome);

        expect(parsed.metadata.sessionFiles).toBe(1);
        expect(parsed.records).toHaveLength(3);
        expect(parsed.records[0]).toMatchObject({
            source: 'codex',
            model: 'gpt-5.4',
            sessionShortId: 'ollout-a',
            sessionRelativeDir: path.join('2026', '03', '09'),
            pricingModel: 'gpt-5.4'
        });
        expect(parsed.records[1]?.totals).toEqual({
            inputTokens: 50,
            cachedInputTokens: 10,
            outputTokens: 10,
            reasoningOutputTokens: 1,
            totalTokens: 60
        });
        expect(parsed.records[2]?.totals).toEqual({
            inputTokens: 20,
            cachedInputTokens: 5,
            outputTokens: 3,
            reasoningOutputTokens: 0,
            totalTokens: 23
        });
        expect(parsed.metadata.latestRateLimits).toMatchObject({
            planType: 'plus',
            primaryUsedPercent: 2,
            secondaryUsedPercent: 5,
            primaryResetsAt: 333,
            secondaryResetsAt: 444
        });
    });
});