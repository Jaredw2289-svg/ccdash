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
import {
    TerminalWidthMenu,
    buildTerminalWidthItems,
    getTerminalWidthSelectionIndex,
    validateCompactThresholdInput,
    validateFallbackTerminalWidthInput
} from '../TerminalWidthMenu';

class MockTtyStream extends PassThrough {
    isTTY = true;
    columns = 120;
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

interface CapturedWriteStream extends NodeJS.WriteStream {
    clearOutput: () => void;
    getOutput: () => string;
}

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
        clearOutput() {
            chunks.length = 0;
        },
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

describe('TerminalWidthMenu helpers', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('validates compact threshold input', () => {
        expect(validateCompactThresholdInput('')).toBe('Please enter a valid number');
        expect(validateCompactThresholdInput('0')).toBe('Value must be between 1 and 99 (you entered 0)');
        expect(validateCompactThresholdInput('100')).toBe('Value must be between 1 and 99 (you entered 100)');
        expect(validateCompactThresholdInput('42')).toBeNull();
    });

    it('validates fallback width input', () => {
        expect(validateFallbackTerminalWidthInput('')).toBe('Please enter a valid number');
        expect(validateFallbackTerminalWidthInput('0')).toBe('Value must be between 1 and 500 (you entered 0)');
        expect(validateFallbackTerminalWidthInput('501')).toBe('Value must be between 1 and 500 (you entered 501)');
        expect(validateFallbackTerminalWidthInput('120')).toBeNull();
    });

    it('builds terminal width menu items with active and threshold sublabels', () => {
        const items = buildTerminalWidthItems('full-until-compact', 60, 88);

        expect(items).toHaveLength(5);
        expect(items[0]).toMatchObject({
            label: 'Responsive stable',
            sublabel: '(recommended, default)',
            value: 'responsive-stable'
        });
        expect(items[1]).toMatchObject({
            label: 'Full width always',
            value: 'full'
        });
        expect(items[2]).toMatchObject({
            label: 'Full width minus 40',
            sublabel: '(fixed reserve)',
            value: 'full-minus-40'
        });
        expect(items[3]).toMatchObject({
            label: 'Full width until compact',
            sublabel: '(threshold 60%, active)',
            value: 'full-until-compact'
        });
        expect(items[4]).toMatchObject({
            label: 'Fallback width',
            sublabel: '(88 cols)',
            value: 'fallback-width'
        });
        expect(items[0]?.description).toContain('Narrow widths reserve 50%');
        expect(items[3]?.description).toContain('60%');
    });

    it('returns the current option index for list selection', () => {
        expect(getTerminalWidthSelectionIndex('responsive-stable')).toBe(0);
        expect(getTerminalWidthSelectionIndex('full')).toBe(1);
        expect(getTerminalWidthSelectionIndex('full-minus-40')).toBe(2);
        expect(getTerminalWidthSelectionIndex('full-until-compact')).toBe(3);
    });

    it('keeps full-until-compact selected after confirming the threshold prompt', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onUpdate = vi.fn();
        const onBack = vi.fn();
        const instance = render(
            React.createElement(TerminalWidthMenu, {
                settings: {
                    ...DEFAULT_SETTINGS,
                    flexMode: 'full',
                    compactThreshold: 60
                },
                statuslineWidthProbe: {
                    width: null,
                    source: 'unavailable',
                    reliable: false
                },
                onUpdate,
                onBack
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
            stdin.write('\u001B[B');
            await flushInk();
            stdin.write('\u001B[B');
            await flushInk();
            stdin.write('\r');
            await flushInk();

            expect(stdout.getOutput()).toContain('Enter compact threshold (1-99):');

            stdout.clearOutput();

            stdin.write('\r');
            await flushInk();

            expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
                flexMode: 'full-until-compact',
                compactThreshold: 60
            }));

            const output = stdout.getOutput();

            expect(output).toContain('▶  Full width until compact');
            expect(output).not.toContain('▶  Responsive stable');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });

    it('updates fallback width from the editor prompt', async () => {
        const stdin = createMockStdin();
        const stdout = createMockStdout();
        const stderr = createMockStdout();
        const onUpdate = vi.fn();
        const onBack = vi.fn();
        const instance = render(
            React.createElement(TerminalWidthMenu, {
                settings: {
                    ...DEFAULT_SETTINGS,
                    fallbackTerminalWidth: 9
                },
                statuslineWidthProbe: {
                    width: 80,
                    source: 'tput',
                    reliable: false
                },
                onUpdate,
                onBack
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
            stdin.write('\u001B[B');
            await flushInk();
            stdin.write('\u001B[B');
            await flushInk();
            stdin.write('\u001B[B');
            await flushInk();
            stdin.write('\u001B[B');
            await flushInk();
            stdin.write('\r');
            await flushInk();

            expect(stdout.getOutput()).toContain('Enter fallback width (1-500 columns):');

            stdout.clearOutput();

            stdin.write('6');
            await flushInk();
            stdin.write('\r');
            await flushInk();

            expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ fallbackTerminalWidth: 96 }));
            expect(stdout.getOutput()).toContain('Live hook width: estimated from fallback 96 columns');
        } finally {
            instance.unmount();
            instance.cleanup();
            stdin.destroy();
            stdout.destroy();
            stderr.destroy();
        }
    });
});