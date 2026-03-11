import * as fs from 'fs';
import * as path from 'path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it
} from 'vitest';

import {
    CURRENT_SESSION_POINTER_TTL_MS,
    RECENT_SESSION_WINDOW_MS,
    listRecentSessionsForCwd,
    normalizeProjectCwd,
    readCurrentSessionPointerForCwd,
    recordCurrentSessionPointer,
    recordRecentSession,
    resolveSessionIdForWrite
} from '../session-resolution';

const MOCK_HOME_DIR = '/tmp/ccdash-session-resolution-test-home';
const ORIGINAL_HOME = process.env.HOME;

function makeWorkspaceDir(name: string): string {
    const dir = path.join(MOCK_HOME_DIR, 'workspaces', name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getNormalizedWorkspaceDir(workspaceDir: string): string {
    const normalizedWorkspaceDir = normalizeProjectCwd(workspaceDir);
    if (!normalizedWorkspaceDir) {
        throw new Error(`Expected a normalized cwd for ${workspaceDir}`);
    }
    return normalizedWorkspaceDir;
}

function writeTranscript(workspaceDir: string, name: string, content: string): string {
    const transcriptPath = path.join(workspaceDir, name);
    fs.writeFileSync(transcriptPath, content, 'utf-8');
    return transcriptPath;
}

describe('session-resolution', () => {
    beforeEach(() => {
        fs.rmSync(MOCK_HOME_DIR, { recursive: true, force: true });
        fs.mkdirSync(MOCK_HOME_DIR, { recursive: true });
        process.env.HOME = MOCK_HOME_DIR;
    });

    afterEach(() => {
        fs.rmSync(MOCK_HOME_DIR, { recursive: true, force: true });
        if (ORIGINAL_HOME === undefined) {
            delete process.env.HOME;
        } else {
            process.env.HOME = ORIGINAL_HOME;
        }
    });

    it('keeps recent sessions isolated by cwd', () => {
        const alphaDir = makeWorkspaceDir('alpha');
        const betaDir = makeWorkspaceDir('beta');
        const normalizedAlphaDir = getNormalizedWorkspaceDir(alphaDir);
        const normalizedBetaDir = getNormalizedWorkspaceDir(betaDir);

        recordRecentSession({ sessionId: 'session-alpha', cwd: alphaDir });
        recordRecentSession({ sessionId: 'session-beta', cwd: betaDir });

        expect(resolveSessionIdForWrite({ cwd: alphaDir })).toEqual({
            kind: 'resolved',
            sessionId: 'session-alpha',
            cwd: normalizedAlphaDir,
            source: 'cwd-cache'
        });
        expect(resolveSessionIdForWrite({ cwd: betaDir })).toEqual({
            kind: 'resolved',
            sessionId: 'session-beta',
            cwd: normalizedBetaDir,
            source: 'cwd-cache'
        });
    });

    it('keeps current-session pointers isolated by cwd', () => {
        const alphaDir = makeWorkspaceDir('alpha-pointer');
        const betaDir = makeWorkspaceDir('beta-pointer');

        recordCurrentSessionPointer({ sessionId: 'pointer-alpha', cwd: alphaDir });
        recordCurrentSessionPointer({ sessionId: 'pointer-beta', cwd: betaDir });

        expect(readCurrentSessionPointerForCwd(alphaDir)).toMatchObject({ sessionId: 'pointer-alpha' });
        expect(readCurrentSessionPointerForCwd(betaDir)).toMatchObject({ sessionId: 'pointer-beta' });
    });

    it('prefers the current-session pointer over an ambiguous cwd cache', () => {
        const workspaceDir = makeWorkspaceDir('shared');
        const normalizedWorkspaceDir = getNormalizedWorkspaceDir(workspaceDir);

        recordRecentSession({ sessionId: 'session-1', cwd: workspaceDir });
        recordRecentSession({ sessionId: 'session-2', cwd: workspaceDir });
        recordCurrentSessionPointer({ sessionId: 'session-1', cwd: workspaceDir });

        expect(resolveSessionIdForWrite({ cwd: workspaceDir })).toEqual({
            kind: 'resolved',
            sessionId: 'session-1',
            cwd: normalizedWorkspaceDir,
            source: 'current-session-pointer'
        });
    });

    it('prefers an explicit session id over cwd cache resolution', () => {
        const workspaceDir = makeWorkspaceDir('explicit');
        const normalizedWorkspaceDir = getNormalizedWorkspaceDir(workspaceDir);

        recordRecentSession({ sessionId: 'cached-session', cwd: workspaceDir });
        recordCurrentSessionPointer({ sessionId: 'pointer-session', cwd: workspaceDir });

        expect(resolveSessionIdForWrite({
            explicitSessionId: 'manual-session',
            cwd: workspaceDir
        })).toEqual({
            kind: 'resolved',
            sessionId: 'manual-session',
            cwd: normalizedWorkspaceDir,
            source: 'explicit'
        });
    });

    it('prefers an env session id over the pointer and cwd cache', () => {
        const workspaceDir = makeWorkspaceDir('env-first');
        const normalizedWorkspaceDir = getNormalizedWorkspaceDir(workspaceDir);

        recordRecentSession({ sessionId: 'cached-session', cwd: workspaceDir });
        recordCurrentSessionPointer({ sessionId: 'pointer-session', cwd: workspaceDir });

        expect(resolveSessionIdForWrite({
            cwd: workspaceDir,
            envSessionId: 'env-session'
        })).toEqual({
            kind: 'resolved',
            sessionId: 'env-session',
            cwd: normalizedWorkspaceDir,
            source: 'env'
        });
    });

    it('prefers an explicit session id over env resolution', () => {
        const workspaceDir = makeWorkspaceDir('explicit-over-env');
        const normalizedWorkspaceDir = getNormalizedWorkspaceDir(workspaceDir);

        expect(resolveSessionIdForWrite({
            explicitSessionId: 'manual-session',
            envSessionId: 'env-session',
            cwd: workspaceDir
        })).toEqual({
            kind: 'resolved',
            sessionId: 'manual-session',
            cwd: normalizedWorkspaceDir,
            source: 'explicit'
        });
    });

    it('falls back to the single recent cwd session when the pointer is stale', () => {
        const workspaceDir = makeWorkspaceDir('stale-pointer');
        const normalizedWorkspaceDir = getNormalizedWorkspaceDir(workspaceDir);
        const staleTimestamp = new Date(Date.now() - CURRENT_SESSION_POINTER_TTL_MS - 60_000).toISOString();

        recordRecentSession({ sessionId: 'cached-session', cwd: workspaceDir });
        recordCurrentSessionPointer({
            sessionId: 'stale-pointer-session',
            cwd: workspaceDir,
            lastSeenAt: staleTimestamp
        });

        expect(readCurrentSessionPointerForCwd(workspaceDir)).toBeNull();
        expect(resolveSessionIdForWrite({ cwd: workspaceDir })).toEqual({
            kind: 'resolved',
            sessionId: 'cached-session',
            cwd: normalizedWorkspaceDir,
            source: 'cwd-cache'
        });
    });

    it('prunes stale sessions before resolving the current cwd', () => {
        const workspaceDir = makeWorkspaceDir('stale');
        const normalizedWorkspaceDir = getNormalizedWorkspaceDir(workspaceDir);
        const staleTimestamp = new Date(Date.now() - RECENT_SESSION_WINDOW_MS - 60_000).toISOString();

        recordRecentSession({
            sessionId: 'stale-session',
            cwd: workspaceDir,
            lastSeenAt: staleTimestamp
        });

        expect(listRecentSessionsForCwd(workspaceDir)).toEqual([]);
        expect(resolveSessionIdForWrite({ cwd: workspaceDir })).toEqual({
            kind: 'not-found',
            cwd: normalizedWorkspaceDir
        });
    });

    it('fails resolution when the pointer is stale and the cwd cache is still ambiguous', () => {
        const workspaceDir = makeWorkspaceDir('ambiguous-stale-pointer');
        const normalizedWorkspaceDir = getNormalizedWorkspaceDir(workspaceDir);
        const staleTimestamp = new Date(Date.now() - CURRENT_SESSION_POINTER_TTL_MS - 60_000).toISOString();

        recordRecentSession({ sessionId: 'session-1', cwd: workspaceDir });
        recordRecentSession({ sessionId: 'session-2', cwd: workspaceDir });
        recordCurrentSessionPointer({
            sessionId: 'session-1',
            cwd: workspaceDir,
            lastSeenAt: staleTimestamp
        });

        expect(resolveSessionIdForWrite({ cwd: workspaceDir })).toEqual({
            kind: 'ambiguous',
            cwd: normalizedWorkspaceDir,
            sessionIds: ['session-2', 'session-1']
        });
    });

    it('returns not-found when the current cwd has no known recent session', () => {
        const workspaceDir = makeWorkspaceDir('empty');
        const normalizedWorkspaceDir = getNormalizedWorkspaceDir(workspaceDir);

        expect(resolveSessionIdForWrite({ cwd: workspaceDir })).toEqual({
            kind: 'not-found',
            cwd: normalizedWorkspaceDir
        });
    });

    it('does not resolve from transcript custom-title entries', () => {
        const workspaceDir = makeWorkspaceDir('rename-only');
        const normalizedWorkspaceDir = getNormalizedWorkspaceDir(workspaceDir);

        writeTranscript(
            workspaceDir,
            'renamed.jsonl',
            '{"type":"custom-title","customTitle":"Renamed Session"}\n'
        );

        expect(resolveSessionIdForWrite({ cwd: workspaceDir })).toEqual({
            kind: 'not-found',
            cwd: normalizedWorkspaceDir
        });
    });
});