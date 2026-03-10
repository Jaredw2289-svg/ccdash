import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { DashboardState } from '../types/DashboardState';
import type { StatusJSON } from '../types/StatusJSON';

import { readSessionStatusFile } from './session-status-file';

const EMPTY_STATE: DashboardState = {
    goalSummary: null,
    lastConclusion: null
};

function toDashboardState(value: unknown): DashboardState | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }

    const record = value as Record<string, unknown>;
    return {
        goalSummary: typeof record.goalSummary === 'string' ? record.goalSummary : null,
        lastConclusion: typeof record.lastConclusion === 'string' ? record.lastConclusion : null
    };
}

function getSessionStateDir(): string {
    const homeDir = process.env.HOME?.trim() ?? os.homedir();
    return path.join(homeDir, '.cache', 'ccdash', 'sessions');
}

export function getSessionStateFilePath(sessionId: string): string {
    return path.join(getSessionStateDir(), `${sessionId}.json`);
}

function ensureSessionStateDir(): void {
    fs.mkdirSync(getSessionStateDir(), { recursive: true });
}

function readJsonFile(filePath: string): unknown {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function readSessionState(sessionId: string): DashboardState | null {
    const filePath = getSessionStateFilePath(sessionId);

    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        return toDashboardState(readJsonFile(filePath));
    } catch {
        return null;
    }
}

function writeSessionState(sessionId: string, state: DashboardState): void {
    try {
        ensureSessionStateDir();
        fs.writeFileSync(getSessionStateFilePath(sessionId), JSON.stringify(state, null, 2), 'utf-8');
    } catch {
        // Ignore cache write failures to preserve dashboard rendering.
    }
}

export function getDashboardState(data: StatusJSON | undefined): DashboardState | null {
    const sessionId = data?.session_id;
    if (!sessionId) {
        return null;
    }

    const state = readSessionState(sessionId) ?? { ...EMPTY_STATE };
    let changed = false;
    const sessionStatus = readSessionStatusFile(sessionId);

    if (sessionStatus?.goal && sessionStatus.goal !== state.goalSummary) {
        state.goalSummary = sessionStatus.goal;
        changed = true;
    }

    if (sessionStatus?.now && sessionStatus.now !== state.lastConclusion) {
        state.lastConclusion = sessionStatus.now;
        changed = true;
    }

    if (!state.goalSummary && !state.lastConclusion) {
        return null;
    }

    if (changed) {
        writeSessionState(sessionId, state);
    }

    return state;
}