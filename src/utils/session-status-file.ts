import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { getClaudeConfigDir } from './claude-settings';

export interface SessionStatusFile {
    goal: string | null;
    now: string | null;
    updatedAt: string | null;
}

const STATUS_SUMMARY_MAX_LENGTH = 120;

function normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
        return text;
    }

    return text.substring(0, maxLength - 1) + '\u2026';
}

function normalizeStatusText(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = normalizeWhitespace(value);
    if (normalized.length === 0) {
        return null;
    }

    return truncate(normalized, STATUS_SUMMARY_MAX_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getSessionStatusDir(): string {
    return path.join(getClaudeConfigDir(), 'status');
}

export function getSessionStatusJsonFilePath(sessionId: string): string {
    return path.join(getSessionStatusDir(), `${sessionId}.json`);
}

export function getSessionStatusTxtFilePath(sessionId: string): string {
    return path.join(getSessionStatusDir(), `${sessionId}.txt`);
}

function toSessionStatusFile(value: unknown): SessionStatusFile | null {
    if (!isRecord(value)) {
        return null;
    }

    const goal = normalizeStatusText(value.goal);
    const now = normalizeStatusText(value.now);
    const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : null;

    if (!goal && !now && !updatedAt) {
        return null;
    }

    return {
        goal,
        now,
        updatedAt
    };
}

function readJsonStatusFile(sessionId: string): SessionStatusFile | null {
    const filePath = getSessionStatusJsonFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        return toSessionStatusFile(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
    } catch {
        return null;
    }
}

function readTextStatusNow(sessionId: string): string | null {
    const filePath = getSessionStatusTxtFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(filePath, 'utf-8').trimEnd();
        if (content.length === 0) {
            return null;
        }

        const lines = content.split('\n');
        const lastLine = lines[lines.length - 1];
        if (!lastLine) {
            return null;
        }

        const tabIndex = lastLine.indexOf('\t');
        const summary = tabIndex === -1 ? lastLine : lastLine.slice(tabIndex + 1);
        return normalizeStatusText(summary);
    } catch {
        return null;
    }
}

export function readSessionStatusFile(sessionId: string): SessionStatusFile | null {
    const jsonStatus = readJsonStatusFile(sessionId);
    const fallbackNow = jsonStatus?.now ?? readTextStatusNow(sessionId);

    if (!jsonStatus && !fallbackNow) {
        return null;
    }

    return {
        goal: jsonStatus?.goal ?? null,
        now: fallbackNow ?? null,
        updatedAt: jsonStatus?.updatedAt ?? null
    };
}

export function writeSessionStatusFile(
    sessionId: string,
    updates: {
        goal?: string | null;
        now?: string | null;
        updatedAt?: string | null;
    }
): SessionStatusFile {
    const existing = readSessionStatusFile(sessionId) ?? {
        goal: null,
        now: null,
        updatedAt: null
    };

    const next: SessionStatusFile = {
        goal: updates.goal === undefined ? existing.goal : normalizeStatusText(updates.goal),
        now: updates.now === undefined ? existing.now : normalizeStatusText(updates.now),
        updatedAt: updates.updatedAt ?? new Date().toISOString()
    };

    fs.mkdirSync(getSessionStatusDir(), { recursive: true });
    fs.writeFileSync(getSessionStatusJsonFilePath(sessionId), JSON.stringify(next, null, 2), 'utf-8');

    return next;
}

function getTerminalKey(): string | null {
    const candidates = [
        process.env.TERM_SESSION_ID,
        process.env.ITERM_SESSION_ID,
        process.env.TMUX_PANE,
        process.env.KITTY_WINDOW_ID,
        process.env.WEZTERM_PANE,
        process.env.ALACRITTY_WINDOW_ID,
        process.env.WINDOWID
    ];
    for (const value of candidates) {
        if (value && value.trim().length > 0) {
            // Sanitize for use as filename: replace non-alphanumeric with _
            return value.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
        }
    }
    return null;
}

function getLastSessionIdCachePath(): string {
    const homeDir = process.env.HOME?.trim() ?? os.homedir();
    const termKey = getTerminalKey();
    if (termKey) {
        return path.join(homeDir, '.cache', 'ccdash', 'session-by-term', termKey);
    }
    return path.join(homeDir, '.cache', 'ccdash', 'last-session-id');
}

export function writeLastSessionId(sessionId: string): void {
    try {
        const cachePath = getLastSessionIdCachePath();
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(cachePath, sessionId, 'utf-8');
    } catch {
        // Ignore cache write failures
    }
}

export function readLastSessionId(): string | null {
    try {
        const cachePath = getLastSessionIdCachePath();
        if (!fs.existsSync(cachePath)) {
            return null;
        }
        const content = fs.readFileSync(cachePath, 'utf-8').trim();
        return content.length > 0 ? content : null;
    } catch {
        return null;
    }
}