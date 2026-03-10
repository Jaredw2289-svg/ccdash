import { render } from 'ink';
import { PassThrough } from 'node:stream';
import React from 'react';
import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import { DEFAULT_SETTINGS } from '../../../types/Settings';
import type { WidgetItem } from '../../../types/Widget';
import { StatusLinePreview } from '../StatusLinePreview';

class MockTtyStream extends PassThrough {
    isTTY = true;
    columns = 140;
    rows = 40;

    setRawMode() {
        return this;
    }

    ref() {
        return this;
    }

    unref() {
        return this;
    }
}

interface CapturedWriteStream extends NodeJS.WriteStream { getOutput: () => string }

function createMockStdin(): NodeJS.ReadStream {
    return new MockTtyStream() as unknown as NodeJS.ReadStream;
}

function createMockStdout(): CapturedWriteStream {
    const stream = new MockTtyStream();
    const chunks: string[] = [];

    stream.on('data', (chunk: Buffer | string) => {
        chunks.push(chunk.toString());
    });

    return Object.assign(stream as unknown as NodeJS.WriteStream, {
        getOutput() {
            return chunks.join('');
        }
    });
}

function flushInk() {
    return new Promise((resolve) => {
        setTimeout(resolve, 25);
    });
}

function stripAnsi(value: string): string {
    return value.replace(/\u001B\[[0-9;]*m/g, '');
}

describe('StatusLinePreview', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders using fallback width when hook width is unreliable', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const lines: WidgetItem[][] = [[
            { id: 'session', type: 'custom-text', customText: 'Session: [██░░░░░░░░░░░░░░] 15.0% · 1h44m left' },
            { id: 'weekly', type: 'custom-text', customText: 'Weekly: [████░░░░░░░░░░░░] 26.0% · resets Thu 10pm' }
        ]];
        const instance = render(
            React.createElement(StatusLinePreview, {
                lines,
                terminalWidth: 140,
                statuslineWidthProbe: {
                    width: 80,
                    source: 'tput',
                    reliable: false
                },
                settings: {
                    ...DEFAULT_SETTINGS,
                    flexMode: 'responsive-stable',
                    defaultSeparator: '·',
                    defaultPadding: ' ',
                    overflowBehavior: 'wrap',
                    fallbackTerminalWidth: 80
                },
                onTruncationChange: vi.fn()
            }),
            {
                stdin,
                stdout,
                stderr,
                debug: true,
                exitOnCtrlC: false,
                patchConsole: false
            }
        );

        try {
            await flushInk();
            const output = stripAnsi(stdout.getOutput());
            const contentLines = output
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.includes('Session:') || line.includes('Weekly:'));

            expect(output).toContain('Previewing fallback width 80 for hook rendering.');
            expect(contentLines.some(line => line.includes('Session:') && !line.includes('Weekly:'))).toBe(true);
            expect(contentLines.some(line => line.includes('Weekly:') && !line.includes('Session:'))).toBe(true);
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('keeps long goal summaries visible across wrapped preview lines', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const lines: WidgetItem[][] = [[
            {
                id: 'goal',
                type: 'custom-text',
                customText: 'Goal: Ship the install renderer release, and verify wrap behavior in preview without dropping long text'
            }
        ]];
        const instance = render(
            React.createElement(StatusLinePreview, {
                lines,
                terminalWidth: 120,
                settings: {
                    ...DEFAULT_SETTINGS,
                    flexMode: 'responsive-stable',
                    overflowBehavior: 'wrap',
                    fallbackTerminalWidth: 80
                },
                onTruncationChange: vi.fn()
            }),
            {
                stdin,
                stdout,
                stderr,
                debug: true,
                exitOnCtrlC: false,
                patchConsole: false
            }
        );

        try {
            await flushInk();
            const output = stripAnsi(stdout.getOutput());
            const goalLines = output
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.includes('Goal:') || line.includes('preview without'));

            expect(output).toContain('Goal: Ship the install renderer release');
            expect(output).toContain('without dropping long text');
            expect(goalLines.length).toBeGreaterThanOrEqual(1);
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });
});