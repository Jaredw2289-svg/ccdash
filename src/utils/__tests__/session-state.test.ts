import * as fs from 'fs';
import * as path from 'path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const MOCK_HOME_DIR = '/tmp/ccdash-session-state-test-home';

import type { StatusJSON } from '../../types/StatusJSON';
import {
    getDashboardState,
    getSessionStateFilePath
} from '../session-state';
import { writeSessionStatusFile } from '../session-status-file';

const ORIGINAL_HOME = process.env.HOME;

function makeStatusJson(transcriptPath?: string): StatusJSON {
    return {
        session_id: 'session-123',
        ...(transcriptPath ? { transcript_path: transcriptPath } : {}),
        cwd: '/Users/junyu/coding/ccdash',
        workspace: {
            current_dir: '/Users/junyu/coding/ccdash/src',
            project_dir: '/Users/junyu/coding/ccdash'
        }
    };
}

describe('session-state', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fs.rmSync(MOCK_HOME_DIR, { recursive: true, force: true });
        fs.mkdirSync(MOCK_HOME_DIR, { recursive: true });
        process.env.HOME = MOCK_HOME_DIR;
        process.env.CLAUDE_CONFIG_DIR = path.join(MOCK_HOME_DIR, '.claude');
    });

    afterEach(() => {
        fs.rmSync(MOCK_HOME_DIR, { recursive: true, force: true });
        if (ORIGINAL_HOME === undefined) {
            delete process.env.HOME;
        } else {
            process.env.HOME = ORIGINAL_HOME;
        }
        delete process.env.CLAUDE_CONFIG_DIR;
    });

    it('returns null when no session status exists', () => {
        const dashboardState = getDashboardState(makeStatusJson());
        expect(dashboardState).toBeNull();
    });

    it('returns null when no session_id', () => {
        const dashboardState = getDashboardState({});
        expect(dashboardState).toBeNull();
    });

    it('reads goal and now from session status file', () => {
        writeSessionStatusFile('session-123', {
            goal: 'Understand available capabilities in ccdash',
            now: 'Explaining the assistant capability surface for this repo'
        });

        const dashboardState = getDashboardState(makeStatusJson());

        expect(dashboardState?.goalSummary).toBe('Understand available capabilities in ccdash');
        expect(dashboardState?.lastConclusion).toBe('Explaining the assistant capability surface for this repo');
    });

    it('reads now from txt fallback', () => {
        fs.mkdirSync(path.join(MOCK_HOME_DIR, '.claude', 'status'), { recursive: true });
        fs.writeFileSync(
            path.join(MOCK_HOME_DIR, '.claude', 'status', 'session-123.txt'),
            '12:00\tWrapped narrow layouts without dropping dashboard context\n',
            'utf-8'
        );

        const dashboardState = getDashboardState(makeStatusJson());

        expect(dashboardState?.goalSummary).toBeNull();
        expect(dashboardState?.lastConclusion).toBe('Wrapped narrow layouts without dropping dashboard context');
    });

    it('caches state to disk', () => {
        writeSessionStatusFile('session-123', {
            goal: 'Test goal',
            now: 'Test now'
        });

        getDashboardState(makeStatusJson());

        const cached = JSON.parse(fs.readFileSync(getSessionStateFilePath('session-123'), 'utf-8')) as Record<string, unknown>;
        expect(cached.goalSummary).toBe('Test goal');
        expect(cached.lastConclusion).toBe('Test now');
    });

    it('returns state with only goal', () => {
        writeSessionStatusFile('session-123', {
            goal: 'Only a goal, no now',
            now: null
        });

        const dashboardState = getDashboardState(makeStatusJson());

        expect(dashboardState?.goalSummary).toBe('Only a goal, no now');
        expect(dashboardState?.lastConclusion).toBeNull();
    });
});