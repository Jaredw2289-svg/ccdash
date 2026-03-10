import { execSync } from 'child_process';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import {
    canDetectTerminalWidth,
    getTerminalWidth,
    probeTerminalWidth,
    resolveTerminalWidth
} from '../terminal';

vi.mock('child_process', () => ({ execSync: vi.fn() }));

describe('terminal utils', () => {
    const mockExecSync = execSync as unknown as {
        mock: { calls: unknown[][] };
        mockImplementationOnce: (impl: () => never) => void;
        mockReturnValueOnce: (value: string) => void;
    };
    const originalColumnsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    const originalIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

    const mockStdout = (columns: number, isTTY = true) => {
        Object.defineProperty(process.stdout, 'columns', {
            configurable: true,
            value: columns
        });
        Object.defineProperty(process.stdout, 'isTTY', {
            configurable: true,
            value: isTTY
        });
    };

    const restoreStdout = () => {
        if (originalColumnsDescriptor) {
            Object.defineProperty(process.stdout, 'columns', originalColumnsDescriptor);
        }
        if (originalIsTTYDescriptor) {
            Object.defineProperty(process.stdout, 'isTTY', originalIsTTYDescriptor);
        }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
        restoreStdout();
    });

    afterEach(() => {
        restoreStdout();
        vi.restoreAllMocks();
    });

    it('returns width from stdout columns in interactive mode when available', () => {
        mockStdout(132, true);

        expect(probeTerminalWidth('interactive')).toEqual({
            width: 132,
            source: 'stdout-columns',
            reliable: true
        });
        expect(mockExecSync.mock.calls.length).toBe(0);
    });

    it('returns width from tty probe in statusline mode when available', () => {
        mockExecSync.mockReturnValueOnce('ttys001\n');
        mockExecSync.mockReturnValueOnce('120\n');

        expect(probeTerminalWidth('statusline')).toEqual({
            width: 120,
            source: 'tty-probe',
            reliable: true
        });
        expect(mockExecSync.mock.calls[0]?.[0]).toContain('ps -o tty=');
        expect(mockExecSync.mock.calls[1]?.[0]).toContain('stty size < /dev/ttys001');
    });

    it('marks tput width as unreliable in statusline mode', () => {
        mockExecSync.mockImplementationOnce(() => { throw new Error('tty unavailable'); });
        mockExecSync.mockReturnValueOnce('90\n');

        expect(probeTerminalWidth('statusline')).toEqual({
            width: 90,
            source: 'tput',
            reliable: false
        });
        expect(mockExecSync.mock.calls[1]?.[0]).toBe('tput cols 2>/dev/null');
    });

    it('resolves fallback width when probe is estimated', () => {
        const resolved = resolveTerminalWidth({
            width: 90,
            source: 'tput',
            reliable: false
        }, 96);

        expect(resolved).toEqual({
            width: 96,
            source: 'fallback',
            reliable: false,
            estimated: true
        });
    });

    it('returns configured fallback width when all probes fail', () => {
        mockExecSync.mockImplementationOnce(() => { throw new Error('tty unavailable'); });
        mockExecSync.mockImplementationOnce(() => { throw new Error('tput unavailable'); });

        expect(getTerminalWidth('statusline', 112)).toBe(112);
    });

    it('detects availability only for reliable statusline measurements', () => {
        mockExecSync.mockImplementationOnce(() => { throw new Error('tty unavailable'); });
        mockExecSync.mockReturnValueOnce('90\n');

        expect(canDetectTerminalWidth()).toBe(false);
    });

    it('returns fallback width on Windows', () => {
        vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');

        expect(probeTerminalWidth('statusline')).toEqual({
            width: null,
            source: 'unavailable',
            reliable: false
        });
        expect(getTerminalWidth('statusline', 88)).toBe(88);
        expect(canDetectTerminalWidth()).toBe(false);
        expect(mockExecSync.mock.calls.length).toBe(0);
    });
});