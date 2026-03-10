import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export type TerminalWidthProbeMode = 'interactive' | 'statusline';
export type TerminalWidthProbeSource = 'stdout-columns' | 'tty-probe' | 'tput' | 'unavailable';
export type ResolvedTerminalWidthSource = TerminalWidthProbeSource | 'fallback';

export interface TerminalWidthProbeResult {
    width: number | null;
    source: TerminalWidthProbeSource;
    reliable: boolean;
}

export interface ResolvedTerminalWidth {
    width: number;
    source: ResolvedTerminalWidthSource;
    reliable: boolean;
    estimated: boolean;
}

// Get package version
// __PACKAGE_VERSION__ will be replaced at build time
const PACKAGE_VERSION = '__PACKAGE_VERSION__';

export function getPackageVersion(): string {
    // If we have the build-time replaced version, use it (check if it looks like a version)
    if (/^\d+\.\d+\.\d+/.test(PACKAGE_VERSION)) {
        return PACKAGE_VERSION;
    }

    // Fallback for development mode
    const possiblePaths = [
        path.join(__dirname, '..', '..', 'package.json'), // Development: dist/utils/ -> root
        path.join(__dirname, '..', 'package.json')       // Production: dist/ -> root (bundled)
    ];

    for (const packageJsonPath of possiblePaths) {
        try {
            if (fs.existsSync(packageJsonPath)) {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { version?: string };
                return packageJson.version ?? '';
            }
        } catch {
            // Continue to next path
        }
    }

    return '';
}

function getStdoutColumns(): number | null {
    const columns = process.stdout.columns;
    if (process.stdout.isTTY && typeof columns === 'number' && columns > 0) {
        return columns;
    }

    return null;
}

function probeParentTtyWidth(): number | null {
    // Preserve historical behavior on Windows: width detection is unavailable.
    // This avoids Unix fallback command behavior (e.g. 2>/dev/null) on Windows.
    if (process.platform === 'win32') {
        return null;
    }

    try {
        // First try to get the tty of the parent process
        const tty = execSync('ps -o tty= -p $(ps -o ppid= -p $$)', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
            shell: '/bin/sh'
        }).trim();

        // Check if we got a valid tty (not ?? which means no tty)
        if (tty && tty !== '??' && tty !== '?') {
            // Now get the terminal size
            const width = execSync(
                `stty size < /dev/${tty} | awk '{print $2}'`,
                {
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'ignore'],
                    shell: '/bin/sh'
                }
            ).trim();

            const parsed = parseInt(width, 10);
            if (!isNaN(parsed) && parsed > 0) {
                return parsed;
            }
        }
    } catch {
        // Command failed, width detection not available
    }

    return null;
}

function probeTputWidth(): number | null {
    // Preserve historical behavior on Windows: width detection is unavailable.
    if (process.platform === 'win32') {
        return null;
    }

    try {
        const width = execSync('tput cols 2>/dev/null', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
        }).trim();

        const parsed = parseInt(width, 10);
        if (!isNaN(parsed) && parsed > 0) {
            return parsed;
        }
    } catch {
        // tput also failed
    }

    return null;
}

export const DEFAULT_FALLBACK_TERMINAL_WIDTH = 80;

export function probeTerminalWidth(mode: TerminalWidthProbeMode = 'statusline'): TerminalWidthProbeResult {
    if (mode === 'interactive') {
        const stdoutWidth = getStdoutColumns();
        if (stdoutWidth !== null) {
            return {
                width: stdoutWidth,
                source: 'stdout-columns',
                reliable: true
            };
        }
    }

    const ttyWidth = probeParentTtyWidth();
    if (ttyWidth !== null) {
        return {
            width: ttyWidth,
            source: 'tty-probe',
            reliable: true
        };
    }

    const tputWidth = probeTputWidth();
    if (tputWidth !== null) {
        return {
            width: tputWidth,
            source: 'tput',
            reliable: mode === 'interactive'
        };
    }

    return {
        width: null,
        source: 'unavailable',
        reliable: false
    };
}

export function resolveTerminalWidth(
    probeResult: TerminalWidthProbeResult,
    fallbackWidth = DEFAULT_FALLBACK_TERMINAL_WIDTH
): ResolvedTerminalWidth {
    if (probeResult.reliable && probeResult.width && probeResult.width > 0) {
        return {
            width: probeResult.width,
            source: probeResult.source,
            reliable: true,
            estimated: false
        };
    }

    return {
        width: fallbackWidth,
        source: 'fallback',
        reliable: false,
        estimated: true
    };
}

// Get terminal width for the requested mode, falling back to the configured width if probing is unreliable
export function getTerminalWidth(
    mode: TerminalWidthProbeMode = 'statusline',
    fallbackWidth = DEFAULT_FALLBACK_TERMINAL_WIDTH
): number {
    return resolveTerminalWidth(probeTerminalWidth(mode), fallbackWidth).width;
}

// Check if terminal width detection is available
export function canDetectTerminalWidth(mode: TerminalWidthProbeMode = 'statusline'): boolean {
    return probeTerminalWidth(mode).reliable;
}