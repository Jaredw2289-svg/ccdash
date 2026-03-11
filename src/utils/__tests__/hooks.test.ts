import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    afterAll,
    afterEach,
    beforeEach,
    describe,
    expect,
    it
} from 'vitest';

import { DEFAULT_SETTINGS } from '../../types/Settings';
import { syncWidgetHooks } from '../hooks';

const ORIGINAL_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
let testClaudeConfigDir = '';

function getClaudeSettingsPath(): string {
    return path.join(testClaudeConfigDir, 'settings.json');
}

function writeClaudeSettings(content: Record<string, unknown>): void {
    const settingsPath = getClaudeSettingsPath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(content, null, 2), 'utf-8');
}

interface SavedHooksFile { hooks?: Record<string, Record<string, unknown>[]> }

function getSessionStartHooks(command: string): Record<string, unknown>[] {
    return ['startup', 'resume', 'clear', 'compact'].map(matcher => ({
        _tag: 'ccstatusline-managed',
        matcher,
        hooks: [{ type: 'command', command }]
    }));
}

describe('syncWidgetHooks', () => {
    beforeEach(() => {
        testClaudeConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-hooks-'));
        process.env.CLAUDE_CONFIG_DIR = testClaudeConfigDir;
    });

    afterEach(() => {
        if (testClaudeConfigDir) {
            fs.rmSync(testClaudeConfigDir, { recursive: true, force: true });
        }
    });

    afterAll(() => {
        if (ORIGINAL_CLAUDE_CONFIG_DIR === undefined) {
            delete process.env.CLAUDE_CONFIG_DIR;
        } else {
            process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CLAUDE_CONFIG_DIR;
        }
    });

    it('removes managed hooks and persists cleanup when status line is unset', async () => {
        const settingsPath = getClaudeSettingsPath();
        fs.writeFileSync(settingsPath, JSON.stringify({
            hooks: {
                PreToolUse: [
                    {
                        _tag: 'ccstatusline-managed',
                        matcher: 'Skill',
                        hooks: [{ type: 'command', command: 'old-command --hook' }]
                    },
                    {
                        matcher: 'Other',
                        hooks: [{ type: 'command', command: 'keep-command' }]
                    }
                ],
                UserPromptSubmit: [
                    {
                        _tag: 'ccstatusline-managed',
                        hooks: [{ type: 'command', command: 'old-command --hook' }]
                    }
                ]
            }
        }, null, 2), 'utf-8');

        await syncWidgetHooks(DEFAULT_SETTINGS);

        const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { hooks?: Record<string, unknown[]> };
        expect(saved.hooks).toEqual({
            PreToolUse: [
                {
                    matcher: 'Other',
                    hooks: [{ type: 'command', command: 'keep-command' }]
                }
            ]
        });
    });

    it('always installs UserPromptSubmit when a status line command exists', async () => {
        writeClaudeSettings({
            statusLine: {
                type: 'command',
                command: 'npx -y dashcc@latest'
            }
        });

        await syncWidgetHooks(DEFAULT_SETTINGS);

        const saved = JSON.parse(fs.readFileSync(getClaudeSettingsPath(), 'utf-8')) as SavedHooksFile;

        expect(saved.hooks).toEqual({
            SessionStart: getSessionStartHooks('npx -y dashcc@latest --hook'),
            UserPromptSubmit: [
                {
                    _tag: 'ccstatusline-managed',
                    hooks: [{ type: 'command', command: 'npx -y dashcc@latest --hook' }]
                }
            ]
        });
    });

    it('dedupes UserPromptSubmit while keeping widget-managed hooks', async () => {
        writeClaudeSettings({
            statusLine: {
                type: 'command',
                command: 'npx -y dashcc@latest'
            }
        });

        const settingsWithSkills = {
            ...DEFAULT_SETTINGS,
            lines: [[{ id: 'skills-1', type: 'skills' }], [], []]
        };

        await syncWidgetHooks(settingsWithSkills);

        const saved = JSON.parse(fs.readFileSync(getClaudeSettingsPath(), 'utf-8')) as SavedHooksFile;

        expect(saved.hooks).toEqual({
            SessionStart: getSessionStartHooks('npx -y dashcc@latest --hook'),
            UserPromptSubmit: [
                {
                    _tag: 'ccstatusline-managed',
                    hooks: [{ type: 'command', command: 'npx -y dashcc@latest --hook' }]
                }
            ],
            PreToolUse: [
                {
                    _tag: 'ccstatusline-managed',
                    matcher: 'Skill',
                    hooks: [{ type: 'command', command: 'npx -y dashcc@latest --hook' }]
                }
            ]
        });
    });
});