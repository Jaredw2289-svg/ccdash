import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { getSessionIdFromEnv } from './session-env';

export const RECENT_SESSION_WINDOW_MS = 6 * 60 * 60 * 1000;
export const CURRENT_SESSION_POINTER_TTL_MS = 30 * 60 * 1000;
const MAX_RECENT_SESSIONS_PER_CWD = 12;

export interface RecentProjectSession {
    sessionId: string;
    cwd: string;
    transcriptPath: string | null;
    lastSeenAt: string;
}

export interface CurrentProjectSessionPointer {
    sessionId: string;
    cwd: string;
    transcriptPath: string | null;
    lastSeenAt: string;
}

interface SessionIndexFile {
    cwd: string;
    sessions: RecentProjectSession[];
}

export type SessionResolutionResult = {
    kind: 'resolved';
    sessionId: string;
    cwd: string | null;
    source: 'explicit' | 'env' | 'current-session-pointer' | 'cwd-cache';
} | { kind: 'missing-cwd' } | {
    kind: 'not-found';
    cwd: string;
} | {
    kind: 'ambiguous';
    cwd: string;
    sessionIds: string[];
};

interface ResolveSessionIdOptions {
    explicitSessionId?: string;
    envSessionId?: string | null;
    cwd?: string | null;
    nowMs?: number;
}

interface RecordRecentSessionOptions {
    sessionId: string;
    cwd?: string | null;
    transcriptPath?: string | null;
    lastSeenAt?: string;
}

interface SessionLikeCwdSource {
    cwd?: string;
    workspace?: {
        current_dir?: string;
        project_dir?: string;
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeProjectCwd(cwd?: string | null): string | null {
    if (!cwd) {
        return null;
    }

    const trimmed = cwd.trim();
    if (trimmed.length === 0) {
        return null;
    }

    const resolved = path.resolve(trimmed);
    try {
        return fs.realpathSync(resolved);
    } catch {
        return resolved;
    }
}

export function deriveProjectCwd(source?: SessionLikeCwdSource | null): string | null {
    if (!source) {
        return null;
    }

    return normalizeProjectCwd(
        source.cwd
        ?? source.workspace?.current_dir
        ?? source.workspace?.project_dir
        ?? null
    );
}

function getSessionIndexDir(): string {
    const homeDir = process.env.HOME?.trim() ?? os.homedir();
    return path.join(homeDir, '.cache', 'ccdash', 'session-by-cwd');
}

function getCurrentSessionPointerDir(): string {
    const homeDir = process.env.HOME?.trim() ?? os.homedir();
    return path.join(homeDir, '.cache', 'ccdash', 'current-session-by-cwd');
}

function getSessionIndexFilePath(cwd: string): string {
    const hash = createHash('sha1').update(cwd).digest('hex');
    return path.join(getSessionIndexDir(), `${hash}.json`);
}

function getCurrentSessionPointerFilePath(cwd: string): string {
    const hash = createHash('sha1').update(cwd).digest('hex');
    return path.join(getCurrentSessionPointerDir(), `${hash}.json`);
}

function parseSessionRecord(value: unknown): RecentProjectSession | null {
    if (!isRecord(value)) {
        return null;
    }

    const sessionId = typeof value.sessionId === 'string' ? value.sessionId.trim() : '';
    const cwd = normalizeProjectCwd(typeof value.cwd === 'string' ? value.cwd : null);
    const transcriptPath = typeof value.transcriptPath === 'string' && value.transcriptPath.trim().length > 0
        ? value.transcriptPath
        : null;
    const lastSeenAt = typeof value.lastSeenAt === 'string' ? value.lastSeenAt : '';

    if (!sessionId || !cwd || !lastSeenAt) {
        return null;
    }

    const lastSeenMs = Date.parse(lastSeenAt);
    if (!Number.isFinite(lastSeenMs)) {
        return null;
    }

    return {
        sessionId,
        cwd,
        transcriptPath,
        lastSeenAt: new Date(lastSeenMs).toISOString()
    };
}

function parseSessionEntry(value: unknown): RecentProjectSession | null {
    return parseSessionRecord(value);
}

function parseCurrentSessionPointer(value: unknown): CurrentProjectSessionPointer | null {
    return parseSessionRecord(value);
}

function pruneRecentSessions(
    sessions: RecentProjectSession[],
    nowMs: number
): RecentProjectSession[] {
    const seen = new Set<string>();

    return sessions
        .filter((session) => {
            const lastSeenMs = Date.parse(session.lastSeenAt);
            return Number.isFinite(lastSeenMs) && (nowMs - lastSeenMs) <= RECENT_SESSION_WINDOW_MS;
        })
        .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
        .filter((session) => {
            if (seen.has(session.sessionId)) {
                return false;
            }
            seen.add(session.sessionId);
            return true;
        })
        .slice(0, MAX_RECENT_SESSIONS_PER_CWD);
}

function readSessionIndexFile(
    filePath: string,
    expectedCwd: string,
    nowMs: number
): RecentProjectSession[] {
    if (!fs.existsSync(filePath)) {
        return [];
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
        if (!isRecord(parsed) || !Array.isArray(parsed.sessions)) {
            return [];
        }

        const fileCwd = normalizeProjectCwd(typeof parsed.cwd === 'string' ? parsed.cwd : null);
        if (fileCwd !== expectedCwd) {
            return [];
        }

        return pruneRecentSessions(
            parsed.sessions
                .map(parseSessionEntry)
                .filter((session): session is RecentProjectSession => session !== null),
            nowMs
        );
    } catch {
        return [];
    }
}

function writeSessionIndexFile(cwd: string, sessions: RecentProjectSession[]): void {
    const filePath = getSessionIndexFilePath(cwd);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    if (sessions.length === 0) {
        if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, { force: true });
        }
        return;
    }

    const payload: SessionIndexFile = {
        cwd,
        sessions
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

function writeCurrentSessionPointerFile(cwd: string, pointer: CurrentProjectSessionPointer | null): void {
    const filePath = getCurrentSessionPointerFilePath(cwd);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    if (!pointer) {
        if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, { force: true });
        }
        return;
    }

    fs.writeFileSync(filePath, JSON.stringify(pointer, null, 2), 'utf-8');
}

export function listRecentSessionsForCwd(
    cwd?: string | null,
    nowMs = Date.now()
): RecentProjectSession[] {
    const normalizedCwd = normalizeProjectCwd(cwd);
    if (!normalizedCwd) {
        return [];
    }

    const sessions = readSessionIndexFile(getSessionIndexFilePath(normalizedCwd), normalizedCwd, nowMs);
    writeSessionIndexFile(normalizedCwd, sessions);
    return sessions;
}

export function recordRecentSession({
    sessionId,
    cwd,
    transcriptPath = null,
    lastSeenAt
}: RecordRecentSessionOptions): RecentProjectSession | null {
    const normalizedCwd = normalizeProjectCwd(cwd);
    const trimmedSessionId = sessionId.trim();
    if (!normalizedCwd || trimmedSessionId.length === 0) {
        return null;
    }

    const nowIso = lastSeenAt ?? new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const nextSession: RecentProjectSession = {
        sessionId: trimmedSessionId,
        cwd: normalizedCwd,
        transcriptPath,
        lastSeenAt: Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : new Date().toISOString()
    };

    const sessions = listRecentSessionsForCwd(normalizedCwd, Number.isFinite(nowMs) ? nowMs : Date.now())
        .filter(entry => entry.sessionId !== nextSession.sessionId);

    sessions.unshift(nextSession);
    writeSessionIndexFile(normalizedCwd, pruneRecentSessions(sessions, Date.parse(nextSession.lastSeenAt)));

    return nextSession;
}

export function readCurrentSessionPointerForCwd(
    cwd?: string | null,
    nowMs = Date.now()
): CurrentProjectSessionPointer | null {
    const normalizedCwd = normalizeProjectCwd(cwd);
    if (!normalizedCwd) {
        return null;
    }

    const filePath = getCurrentSessionPointerFilePath(normalizedCwd);
    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        const pointer = parseCurrentSessionPointer(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
        if (pointer?.cwd !== normalizedCwd) {
            writeCurrentSessionPointerFile(normalizedCwd, null);
            return null;
        }

        const lastSeenMs = Date.parse(pointer.lastSeenAt);
        if (!Number.isFinite(lastSeenMs) || (nowMs - lastSeenMs) > CURRENT_SESSION_POINTER_TTL_MS) {
            writeCurrentSessionPointerFile(normalizedCwd, null);
            return null;
        }

        return pointer;
    } catch {
        writeCurrentSessionPointerFile(normalizedCwd, null);
        return null;
    }
}

export function recordCurrentSessionPointer({
    sessionId,
    cwd,
    transcriptPath = null,
    lastSeenAt
}: RecordRecentSessionOptions): CurrentProjectSessionPointer | null {
    const normalizedCwd = normalizeProjectCwd(cwd);
    const trimmedSessionId = sessionId.trim();
    if (!normalizedCwd || trimmedSessionId.length === 0) {
        return null;
    }

    const nowIso = lastSeenAt ?? new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const pointer: CurrentProjectSessionPointer = {
        sessionId: trimmedSessionId,
        cwd: normalizedCwd,
        transcriptPath,
        lastSeenAt: Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : new Date().toISOString()
    };

    writeCurrentSessionPointerFile(normalizedCwd, pointer);
    return pointer;
}

export function resolveSessionIdForWrite(options: ResolveSessionIdOptions = {}): SessionResolutionResult {
    const explicitSessionId = options.explicitSessionId?.trim();
    if (explicitSessionId) {
        return {
            kind: 'resolved',
            sessionId: explicitSessionId,
            cwd: normalizeProjectCwd(options.cwd ?? process.cwd()),
            source: 'explicit'
        };
    }

    const envSessionId = (options.envSessionId ?? getSessionIdFromEnv())?.trim();
    if (envSessionId) {
        return {
            kind: 'resolved',
            sessionId: envSessionId,
            cwd: normalizeProjectCwd(options.cwd ?? process.cwd()),
            source: 'env'
        };
    }

    const normalizedCwd = normalizeProjectCwd(options.cwd ?? process.cwd());
    if (!normalizedCwd) {
        return { kind: 'missing-cwd' };
    }

    const pointer = readCurrentSessionPointerForCwd(normalizedCwd, options.nowMs ?? Date.now());
    if (pointer) {
        return {
            kind: 'resolved',
            sessionId: pointer.sessionId,
            cwd: normalizedCwd,
            source: 'current-session-pointer'
        };
    }

    const sessions = listRecentSessionsForCwd(normalizedCwd, options.nowMs ?? Date.now());
    if (sessions.length === 0) {
        return {
            kind: 'not-found',
            cwd: normalizedCwd
        };
    }

    if (sessions.length > 1) {
        return {
            kind: 'ambiguous',
            cwd: normalizedCwd,
            sessionIds: sessions.map(session => session.sessionId)
        };
    }

    const session = sessions[0];
    if (!session) {
        return {
            kind: 'not-found',
            cwd: normalizedCwd
        };
    }

    return {
        kind: 'resolved',
        sessionId: session.sessionId,
        cwd: normalizedCwd,
        source: 'cwd-cache'
    };
}