import { execFileSync } from 'child_process';
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
    CCDASH_PROJECT_DIR_ENV_VAR,
    CCDASH_SESSION_ID_ENV_VAR,
    CCDASH_TRANSCRIPT_PATH_ENV_VAR
} from '../session-env';
import {
    CURRENT_SESSION_POINTER_TTL_MS,
    normalizeProjectCwd,
    readCurrentSessionPointerForCwd,
    recordCurrentSessionPointer,
    recordRecentSession
} from '../session-resolution';

const MOCK_HOME_DIR = '/tmp/ccdash-cli-test-home';
const SCRIPT_PATH = path.join(process.cwd(), 'src', 'ccstatusline.ts');
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;

describe('ccstatusline cli', () => {
    beforeEach(() => {
        fs.rmSync(MOCK_HOME_DIR, { recursive: true, force: true });
        fs.mkdirSync(path.join(MOCK_HOME_DIR, '.cache', 'ccdash'), { recursive: true });
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
        if (ORIGINAL_CLAUDE_CONFIG_DIR === undefined) {
            delete process.env.CLAUDE_CONFIG_DIR;
        } else {
            process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CLAUDE_CONFIG_DIR;
        }
    });

    it('does not replay cached input when stdin is empty', () => {
        fs.writeFileSync(
            path.join(MOCK_HOME_DIR, '.cache', 'ccdash', 'last-input.json'),
            JSON.stringify({
                session_id: 'wrong-session',
                cwd: '/tmp/other-project',
                model: { id: 'claude-opus-4-6' }
            }),
            'utf-8'
        );

        const output = execFileSync(process.execPath, ['run', SCRIPT_PATH], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                HOME: MOCK_HOME_DIR,
                CLAUDE_CONFIG_DIR: path.join(MOCK_HOME_DIR, '.claude')
            },
            input: '',
            encoding: 'utf-8'
        });

        expect(output).toBe('');
    });

    it('writes session status for the current project when exactly one recent session exists', () => {
        const workspaceDir = path.join(MOCK_HOME_DIR, 'workspace-one');
        fs.mkdirSync(workspaceDir, { recursive: true });
        recordRecentSession({ sessionId: 'session-one', cwd: workspaceDir });

        const output = execFileSync(process.execPath, [
            'run',
            SCRIPT_PATH,
            '--write-session-status',
            '--now',
            'Updated the dashboard renderer'
        ], {
            cwd: workspaceDir,
            env: {
                ...process.env,
                HOME: MOCK_HOME_DIR,
                CLAUDE_CONFIG_DIR: path.join(MOCK_HOME_DIR, '.claude')
            },
            encoding: 'utf-8'
        });

        const parsedOutput = JSON.parse(output) as { now?: string };
        const writtenStatus = JSON.parse(
            fs.readFileSync(
                path.join(MOCK_HOME_DIR, '.claude', 'status', 'session-one.json'),
                'utf-8'
            )
        ) as { now?: string };

        expect(parsedOutput).toMatchObject({ now: 'Updated the dashboard renderer' });
        expect(writtenStatus).toMatchObject({ now: 'Updated the dashboard renderer' });
    });

    it('fails instead of guessing when multiple recent sessions exist for the same project', () => {
        const workspaceDir = path.join(MOCK_HOME_DIR, 'workspace-ambiguous');
        fs.mkdirSync(workspaceDir, { recursive: true });
        recordRecentSession({ sessionId: 'session-a', cwd: workspaceDir });
        recordRecentSession({ sessionId: 'session-b', cwd: workspaceDir });

        expect(() => execFileSync(process.execPath, [
            'run',
            SCRIPT_PATH,
            '--write-session-status',
            '--now',
            'This should fail'
        ], {
            cwd: workspaceDir,
            env: {
                ...process.env,
                HOME: MOCK_HOME_DIR,
                CLAUDE_CONFIG_DIR: path.join(MOCK_HOME_DIR, '.claude')
            },
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        })).toThrowError(/multiple recent Claude sessions/);
    });

    it('writes session status using the current-session pointer when the cwd cache is ambiguous', () => {
        const workspaceDir = path.join(MOCK_HOME_DIR, 'workspace-pointer');
        fs.mkdirSync(workspaceDir, { recursive: true });
        recordRecentSession({ sessionId: 'session-a', cwd: workspaceDir });
        recordRecentSession({ sessionId: 'session-b', cwd: workspaceDir });
        recordCurrentSessionPointer({ sessionId: 'session-b', cwd: workspaceDir });

        const output = execFileSync(process.execPath, [
            'run',
            SCRIPT_PATH,
            '--write-session-status',
            '--now',
            'Pointer-selected session write'
        ], {
            cwd: workspaceDir,
            env: {
                ...process.env,
                HOME: MOCK_HOME_DIR,
                CLAUDE_CONFIG_DIR: path.join(MOCK_HOME_DIR, '.claude')
            },
            encoding: 'utf-8'
        });

        const parsedOutput = JSON.parse(output) as { now?: string };
        const writtenStatus = JSON.parse(
            fs.readFileSync(
                path.join(MOCK_HOME_DIR, '.claude', 'status', 'session-b.json'),
                'utf-8'
            )
        ) as { now?: string };

        expect(parsedOutput).toMatchObject({ now: 'Pointer-selected session write' });
        expect(writtenStatus).toMatchObject({ now: 'Pointer-selected session write' });
        expect(fs.existsSync(path.join(MOCK_HOME_DIR, '.claude', 'status', 'session-a.json'))).toBe(false);
    });

    it('writes session status using CCDASH_SESSION_ID when present', () => {
        const workspaceDir = path.join(MOCK_HOME_DIR, 'workspace-env');
        fs.mkdirSync(workspaceDir, { recursive: true });
        recordRecentSession({ sessionId: 'session-a', cwd: workspaceDir });
        recordCurrentSessionPointer({ sessionId: 'session-a', cwd: workspaceDir });

        const output = execFileSync(process.execPath, [
            'run',
            SCRIPT_PATH,
            '--write-session-status',
            '--now',
            'Env-selected session write'
        ], {
            cwd: workspaceDir,
            env: {
                ...process.env,
                HOME: MOCK_HOME_DIR,
                CLAUDE_CONFIG_DIR: path.join(MOCK_HOME_DIR, '.claude'),
                [CCDASH_SESSION_ID_ENV_VAR]: 'session-env'
            },
            encoding: 'utf-8'
        });

        const parsedOutput = JSON.parse(output) as { now?: string };
        const writtenStatus = JSON.parse(
            fs.readFileSync(
                path.join(MOCK_HOME_DIR, '.claude', 'status', 'session-env.json'),
                'utf-8'
            )
        ) as { now?: string };

        expect(parsedOutput).toMatchObject({ now: 'Env-selected session write' });
        expect(writtenStatus).toMatchObject({ now: 'Env-selected session write' });
        expect(fs.existsSync(path.join(MOCK_HOME_DIR, '.claude', 'status', 'session-a.json'))).toBe(false);
    });

    it('fails when the pointer is stale and the cwd cache is ambiguous', () => {
        const workspaceDir = path.join(MOCK_HOME_DIR, 'workspace-stale-pointer');
        fs.mkdirSync(workspaceDir, { recursive: true });
        const staleTimestamp = new Date(Date.now() - CURRENT_SESSION_POINTER_TTL_MS - 60_000).toISOString();

        recordRecentSession({ sessionId: 'session-a', cwd: workspaceDir });
        recordRecentSession({ sessionId: 'session-b', cwd: workspaceDir });
        recordCurrentSessionPointer({
            sessionId: 'session-b',
            cwd: workspaceDir,
            lastSeenAt: staleTimestamp
        });

        expect(() => execFileSync(process.execPath, [
            'run',
            SCRIPT_PATH,
            '--write-session-status',
            '--now',
            'This should still fail'
        ], {
            cwd: workspaceDir,
            env: {
                ...process.env,
                HOME: MOCK_HOME_DIR,
                CLAUDE_CONFIG_DIR: path.join(MOCK_HOME_DIR, '.claude')
            },
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        })).toThrowError(/multiple recent Claude sessions/);
    });

    it('refreshes the current-session pointer from hook input', () => {
        const workspaceDir = path.join(MOCK_HOME_DIR, 'workspace-hook');
        fs.mkdirSync(workspaceDir, { recursive: true });
        const transcriptPath = path.join(workspaceDir, 'session-hook.jsonl');
        const normalizedWorkspaceDir = normalizeProjectCwd(workspaceDir);

        execFileSync(process.execPath, [
            'run',
            SCRIPT_PATH,
            '--hook'
        ], {
            cwd: workspaceDir,
            env: {
                ...process.env,
                HOME: MOCK_HOME_DIR,
                CLAUDE_CONFIG_DIR: path.join(MOCK_HOME_DIR, '.claude')
            },
            input: JSON.stringify({
                session_id: 'session-hook',
                cwd: workspaceDir,
                transcript_path: transcriptPath,
                hook_event_name: 'UserPromptSubmit',
                prompt: 'hello'
            }),
            encoding: 'utf-8'
        });

        expect(readCurrentSessionPointerForCwd(workspaceDir)).toMatchObject({
            sessionId: 'session-hook',
            cwd: normalizedWorkspaceDir,
            transcriptPath
        });
    });

    it('writes CCDASH_* exports during SessionStart and refreshes pointer state', () => {
        const workspaceDir = path.join(MOCK_HOME_DIR, 'workspace-session-start');
        fs.mkdirSync(workspaceDir, { recursive: true });
        const normalizedWorkspaceDir = normalizeProjectCwd(workspaceDir);
        const transcriptPath = path.join(workspaceDir, 'session-start.jsonl');
        const envFilePath = path.join(MOCK_HOME_DIR, 'session.env');

        execFileSync(process.execPath, [
            'run',
            SCRIPT_PATH,
            '--hook'
        ], {
            cwd: workspaceDir,
            env: {
                ...process.env,
                HOME: MOCK_HOME_DIR,
                CLAUDE_CONFIG_DIR: path.join(MOCK_HOME_DIR, '.claude'),
                CLAUDE_ENV_FILE: envFilePath
            },
            input: JSON.stringify({
                session_id: 'session-start',
                cwd: workspaceDir,
                transcript_path: transcriptPath,
                hook_event_name: 'SessionStart'
            }),
            encoding: 'utf-8'
        });

        const envFile = fs.readFileSync(envFilePath, 'utf-8');
        expect(envFile).toContain(`export ${CCDASH_SESSION_ID_ENV_VAR}='session-start'`);
        expect(envFile).toContain(`export ${CCDASH_TRANSCRIPT_PATH_ENV_VAR}='${transcriptPath}'`);
        expect(envFile).toContain(`export ${CCDASH_PROJECT_DIR_ENV_VAR}='${normalizedWorkspaceDir}'`);
        expect(readCurrentSessionPointerForCwd(workspaceDir)).toMatchObject({
            sessionId: 'session-start',
            cwd: normalizedWorkspaceDir,
            transcriptPath
        });
    });

    it('replaces old CCDASH_* exports during SessionStart without duplicating them', () => {
        const workspaceDir = path.join(MOCK_HOME_DIR, 'workspace-session-start-update');
        fs.mkdirSync(workspaceDir, { recursive: true });
        const transcriptPath = path.join(workspaceDir, 'session-start\'s.jsonl');
        const envFilePath = path.join(MOCK_HOME_DIR, 'session-update.env');

        fs.writeFileSync(envFilePath, [
            'export KEEP_ME=\'1\'',
            'export CCDASH_SESSION_ID=\'old-session\'',
            'export CCDASH_TRANSCRIPT_PATH=\'old-transcript\'',
            'export CCDASH_PROJECT_DIR=\'old-project\'',
            ''
        ].join('\n'), 'utf-8');

        execFileSync(process.execPath, [
            'run',
            SCRIPT_PATH,
            '--hook'
        ], {
            cwd: workspaceDir,
            env: {
                ...process.env,
                HOME: MOCK_HOME_DIR,
                CLAUDE_CONFIG_DIR: path.join(MOCK_HOME_DIR, '.claude'),
                CLAUDE_ENV_FILE: envFilePath
            },
            input: JSON.stringify({
                session_id: 'session-start-new',
                cwd: workspaceDir,
                transcript_path: transcriptPath,
                hook_event_name: 'SessionStart'
            }),
            encoding: 'utf-8'
        });

        const envFile = fs.readFileSync(envFilePath, 'utf-8');
        expect(envFile).toContain('export KEEP_ME=\'1\'');
        expect(envFile.match(new RegExp(`export ${CCDASH_SESSION_ID_ENV_VAR}=`, 'g'))).toHaveLength(1);
        expect(envFile.match(new RegExp(`export ${CCDASH_TRANSCRIPT_PATH_ENV_VAR}=`, 'g'))).toHaveLength(1);
        expect(envFile.match(new RegExp(`export ${CCDASH_PROJECT_DIR_ENV_VAR}=`, 'g'))).toHaveLength(1);
        expect(envFile).toContain(`export ${CCDASH_SESSION_ID_ENV_VAR}='session-start-new'`);
        expect(envFile).toContain(`export ${CCDASH_TRANSCRIPT_PATH_ENV_VAR}='${transcriptPath.replace(/'/g, '\'\\\'\'')}'`);
    });

    it('refreshes the current-session pointer from piped statusline input', () => {
        const workspaceDir = path.join(MOCK_HOME_DIR, 'workspace-statusline');
        fs.mkdirSync(workspaceDir, { recursive: true });
        const transcriptPath = path.join(workspaceDir, 'session-statusline.jsonl');
        const normalizedWorkspaceDir = normalizeProjectCwd(workspaceDir);

        execFileSync(process.execPath, ['run', SCRIPT_PATH], {
            cwd: workspaceDir,
            env: {
                ...process.env,
                HOME: MOCK_HOME_DIR,
                CLAUDE_CONFIG_DIR: path.join(MOCK_HOME_DIR, '.claude')
            },
            input: JSON.stringify({
                session_id: 'session-statusline',
                cwd: workspaceDir,
                transcript_path: transcriptPath
            }),
            encoding: 'utf-8'
        });

        expect(readCurrentSessionPointerForCwd(workspaceDir)).toMatchObject({
            sessionId: 'session-statusline',
            cwd: normalizedWorkspaceDir,
            transcriptPath
        });
    });
});