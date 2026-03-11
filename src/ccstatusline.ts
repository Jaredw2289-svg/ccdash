#!/usr/bin/env node
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';

import { runTUI } from './tui';
import type {
    SkillsMetrics,
    SpeedMetrics,
    TokenMetrics,
    WidgetItem
} from './types';
import type { RenderContext } from './types/RenderContext';
import type { StatusJSON } from './types/StatusJSON';
import { StatusJSONSchema } from './types/StatusJSON';
import { getVisibleText } from './utils/ansi';
import {
    installStatusLine,
    isBunxAvailable,
    uninstallStatusLine
} from './utils/claude-settings';
import { updateColorMap } from './utils/colors';
import {
    initConfigPath,
    loadSettings,
    saveSettings
} from './utils/config';
import {
    getSessionDuration,
    getSpeedMetricsCollection,
    getTokenMetrics
} from './utils/jsonl';
import {
    calculateMaxWidthsFromPreRendered,
    normalizeRenderContext,
    preRenderAllWidgets,
    renderStatusLine
} from './utils/renderer';
import { advanceGlobalSeparatorIndex } from './utils/separator-index';
import {
    CLAUDE_ENV_FILE_ENV_VAR,
    writeSessionEnvFile
} from './utils/session-env';
import {
    deriveProjectCwd,
    recordCurrentSessionPointer,
    recordRecentSession,
    resolveSessionIdForWrite
} from './utils/session-resolution';
import { getDashboardState } from './utils/session-state';
import { writeSessionStatusFile } from './utils/session-status-file';
import {
    getSkillsFilePath,
    getSkillsMetrics
} from './utils/skills';
import {
    getWidgetSpeedWindowSeconds,
    isWidgetSpeedWindowEnabled
} from './utils/speed-window';
import { prefetchUsageDataIfNeeded } from './utils/usage-prefetch';

const UPDATE_MESSAGE_COLOR = 'hex:D7A65F';

function hasSessionDurationInStatusJson(data: StatusJSON): boolean {
    const durationMs = data.cost?.total_duration_ms;
    return typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0;
}

function printRenderedLines(line: string): boolean {
    const renderedLines = line.split('\n');
    let renderedAny = false;

    for (const renderedLine of renderedLines) {
        const strippedLine = getVisibleText(renderedLine).trim();
        if (strippedLine.length === 0) {
            continue;
        }

        let outputLine = renderedLine.replace(/ /g, '\u00A0');
        outputLine = '\x1b[0m' + outputLine;
        console.log(outputLine);
        renderedAny = true;
    }

    return renderedAny;
}

function renderAuxiliaryMessage(
    settings: Awaited<ReturnType<typeof loadSettings>>,
    context: RenderContext,
    message: string
): string {
    const widgets: WidgetItem[] = [{
        id: 'updatemessage',
        type: 'custom-text',
        customText: message,
        color: UPDATE_MESSAGE_COLOR
    }];
    const preRenderedWidgets = preRenderAllWidgets([widgets], settings, context);
    const preCalculatedMaxWidths = calculateMaxWidthsFromPreRendered(preRenderedWidgets, settings);
    return renderStatusLine(
        widgets,
        settings,
        context,
        preRenderedWidgets[0] ?? [],
        preCalculatedMaxWidths
    );
}

async function readStdin(): Promise<string | null> {
    // Check if stdin is a TTY (terminal) - if it is, there's no piped data
    if (process.stdin.isTTY) {
        return null;
    }

    const chunks: string[] = [];

    try {
        // Use Node.js compatible approach
        if (typeof Bun !== 'undefined') {
            // Bun environment
            const decoder = new TextDecoder();
            for await (const chunk of Bun.stdin.stream()) {
                chunks.push(decoder.decode(chunk));
            }
        } else {
            // Node.js environment
            process.stdin.setEncoding('utf8');
            for await (const chunk of process.stdin) {
                chunks.push(chunk as string);
            }
        }
        return chunks.join('');
    } catch {
        return null;
    }
}

async function ensureWindowsUtf8CodePage() {
    if (process.platform !== 'win32') {
        return;
    }

    try {
        const { execFileSync } = await import('child_process');
        execFileSync('chcp.com', ['65001'], { stdio: 'ignore' });
    } catch {
        // Ignore failures to preserve statusline output even in restricted shells.
    }
}

async function renderMultipleLines(data: StatusJSON) {
    const settings = await loadSettings();

    // Set global chalk level based on settings
    chalk.level = settings.colorLevel;

    // Update color map after setting chalk level
    updateColorMap();

    // Get all lines to render
    const lines = settings.lines;

    // Check if session clock is needed
    const hasSessionClock = lines.some(line => line.some(item => item.type === 'session-clock'));

    const speedWidgetTypes = new Set(['output-speed', 'input-speed', 'total-speed']);
    const hasSpeedItems = lines.some(line => line.some(item => speedWidgetTypes.has(item.type)));
    const requestedSpeedWindows = new Set<number>();
    for (const line of lines) {
        for (const item of line) {
            if (speedWidgetTypes.has(item.type) && isWidgetSpeedWindowEnabled(item)) {
                requestedSpeedWindows.add(getWidgetSpeedWindowSeconds(item));
            }
        }
    }

    let tokenMetrics: TokenMetrics | null = null;
    if (data.transcript_path) {
        tokenMetrics = await getTokenMetrics(data.transcript_path);
    }

    let sessionDuration: string | null = null;
    if (hasSessionClock && !hasSessionDurationInStatusJson(data) && data.transcript_path) {
        sessionDuration = await getSessionDuration(data.transcript_path);
    }

    const usageData = await prefetchUsageDataIfNeeded(lines);

    let speedMetrics: SpeedMetrics | null = null;
    let windowedSpeedMetrics: Record<string, SpeedMetrics> | null = null;
    if (hasSpeedItems && data.transcript_path) {
        const speedMetricsCollection = await getSpeedMetricsCollection(data.transcript_path, {
            includeSubagents: true,
            windowSeconds: Array.from(requestedSpeedWindows)
        });

        speedMetrics = speedMetricsCollection.sessionAverage;
        windowedSpeedMetrics = speedMetricsCollection.windowed;
    }

    let skillsMetrics: SkillsMetrics | null = null;
    if (data.session_id) {
        skillsMetrics = getSkillsMetrics(data.session_id);
    }

    // Create render context
    const context: RenderContext = normalizeRenderContext(settings, {
        data,
        tokenMetrics,
        speedMetrics,
        windowedSpeedMetrics,
        usageData,
        sessionDuration,
        skillsMetrics,
        dashboardState: getDashboardState(data),
        isPreview: false
    });

    // Determine which lines are visible based on responsive tier and line priority
    const maxPriority = context.responsiveTier === 'narrow' ? 1 : 3;
    const visibleLineIndices = lines.map((_, i) => i).filter((i) => {
        const priority = settings.linePriority[i] ?? 1;
        return priority <= maxPriority;
    });

    // Always pre-render all widgets once (for efficiency)
    const preRenderedLines = preRenderAllWidgets(lines, settings, context);
    const preCalculatedMaxWidths = calculateMaxWidthsFromPreRendered(preRenderedLines, settings);

    // Render only visible lines using pre-rendered content
    let globalSeparatorIndex = 0;
    for (const i of visibleLineIndices) {
        const lineItems = lines[i];
        if (lineItems && lineItems.length > 0) {
            const lineContext = { ...context, lineIndex: i, globalSeparatorIndex };
            const preRenderedWidgets = preRenderedLines[i] ?? [];
            const line = renderStatusLine(lineItems, settings, lineContext, preRenderedWidgets, preCalculatedMaxWidths);
            const renderedAny = printRenderedLines(line);

            if (renderedAny) {
                globalSeparatorIndex = advanceGlobalSeparatorIndex(globalSeparatorIndex, lineItems);
            }
        }
    }

    // Check if there's an update message to display
    if (settings.updatemessage?.message
        && settings.updatemessage.message.trim() !== ''
        && settings.updatemessage.remaining
        && settings.updatemessage.remaining > 0) {
        const updateMessageLine = renderAuxiliaryMessage(settings, context, settings.updatemessage.message);
        printRenderedLines(updateMessageLine);

        // Decrement the remaining count
        const newRemaining = settings.updatemessage.remaining - 1;

        // Update or remove the updatemessage
        if (newRemaining <= 0) {
            // Remove the entire updatemessage block
            const { updatemessage, ...newSettings } = settings;
            void updatemessage;
            await saveSettings(newSettings);
        } else {
            // Update the remaining count
            await saveSettings({
                ...settings,
                updatemessage: {
                    ...settings.updatemessage,
                    remaining: newRemaining
                }
            });
        }
    }
}

function parseConfigArg(): string | undefined {
    const idx = process.argv.indexOf('--config');
    if (idx === -1)
        return undefined;
    const configPath = process.argv[idx + 1];
    if (!configPath || configPath.startsWith('--')) {
        console.error('--config requires a file path argument');
        process.exit(1);
    }
    process.argv.splice(idx, 2);
    return configPath;
}

interface HookInput {
    session_id?: string;
    cwd?: string;
    transcript_path?: string;
    workspace?: {
        current_dir?: string;
        project_dir?: string;
    };
    hook_event_name?: string;
    tool_name?: string;
    tool_input?: { skill?: string };
    prompt?: string;
}

function recordSessionActivity(
    sessionId: string,
    cwd?: string | null,
    transcriptPath?: string | null
): void {
    recordRecentSession({
        sessionId,
        cwd,
        transcriptPath: transcriptPath ?? null
    });
    recordCurrentSessionPointer({
        sessionId,
        cwd,
        transcriptPath: transcriptPath ?? null
    });
}

function getArgValue(flag: string): string | undefined {
    const index = process.argv.indexOf(flag);
    if (index === -1) {
        return undefined;
    }

    const value = process.argv[index + 1];
    if (!value || value.startsWith('--')) {
        return undefined;
    }

    return value;
}

function handleWriteSessionStatus(): void {
    const sessionResolution = resolveSessionIdForWrite({
        explicitSessionId: getArgValue('--session'),
        cwd: process.cwd()
    });
    const goal = getArgValue('--focus') ?? getArgValue('--goal');
    const now = getArgValue('--step') ?? getArgValue('--now');

    if (sessionResolution.kind === 'missing-cwd' || sessionResolution.kind === 'not-found') {
        console.error('--write-session-status: no recent Claude session found for this project (provide --session or wait for the statusline hook to render here)');
        process.exit(1);
    }

    if (sessionResolution.kind === 'ambiguous') {
        console.error(`--write-session-status: multiple recent Claude sessions found for this project; rerun with --session <id> (${sessionResolution.sessionIds.join(', ')})`);
        process.exit(1);
    }

    if (goal === undefined && now === undefined) {
        console.error('--write-session-status requires --focus/--goal and/or --step/--now');
        process.exit(1);
    }

    const result = writeSessionStatusFile(sessionResolution.sessionId, {
        goal,
        now
    });
    console.log(JSON.stringify(result));
}

function handleSessionStart(
    data: HookInput,
    sessionId: string,
    projectCwd: string | null
): void {
    const envFilePath = process.env[CLAUDE_ENV_FILE_ENV_VAR]?.trim();
    if (!envFilePath) {
        return;
    }

    writeSessionEnvFile(envFilePath, {
        sessionId,
        transcriptPath: data.transcript_path ?? null,
        projectDir: projectCwd
    });
}

async function handleHook(): Promise<void> {
    const input = await readStdin();
    if (!input) {
        console.log('{}');
        return;
    }
    try {
        const data = JSON.parse(input) as HookInput;
        const sessionId = data.session_id;
        const projectCwd = deriveProjectCwd(data);
        if (!sessionId) {
            console.log('{}');
            return;
        }

        recordSessionActivity(
            sessionId,
            projectCwd,
            data.transcript_path ?? null
        );

        if (data.hook_event_name === 'SessionStart') {
            handleSessionStart(data, sessionId, projectCwd);
            console.log('{}');
            return;
        }

        let skillName = '';
        if (data.hook_event_name === 'PreToolUse' && data.tool_name === 'Skill') {
            skillName = data.tool_input?.skill ?? '';
        } else if (data.hook_event_name === 'UserPromptSubmit') {
            const match = /^\/([a-zA-Z0-9_:-]+)/.exec(data.prompt ?? '');
            if (match) {
                skillName = match[1] ?? '';
            }
        }
        if (!skillName) {
            console.log('{}');
            return;
        }

        const filePath = getSkillsFilePath(sessionId);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const entry = JSON.stringify({
            timestamp: new Date().toISOString(),
            session_id: sessionId,
            skill: skillName,
            source: data.hook_event_name
        });
        fs.appendFileSync(filePath, entry + '\n');
    } catch { /* ignore parse errors */ }
    console.log('{}');
}

function printSetup(): void {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    dashcc Setup Guide                        ║
╚══════════════════════════════════════════════════════════════╝

1. Add to your ~/.claude/settings.json:

   {
     "statusLine": {
       "command": "npx -y dashcc@latest",
       "padding": 0
     }
   }

2. Add to your project's CLAUDE.md (for session goal/now updates):

   ## Session Dashboard Status
   After every response, update the per-session dashboard state.
   Always write \`--now\`, and only write \`--goal\` when the session goal actually changes:
   \`\`\`
   bun run src/ccstatusline.ts --write-session-status --now "<high-level step summary>" --goal "<stable session focus>"
   \`\`\`
   Keep both summaries high-level, one line, and under 120 characters.
   New sessions automatically export \`CCDASH_SESSION_ID\`, \`CCDASH_TRANSCRIPT_PATH\`, and \`CCDASH_PROJECT_DIR\`. Already-open sessions may need restart/resume to pick these up. When env vars are unavailable, dashcc falls back to the current-session pointer, then the project cache if exactly one recent session exists.

3. Start Claude Code - the status bar will appear automatically.

4. Run \`dashcc\` (no args) to open the TUI configurator.
`);
}

async function main() {
    // Parse --config before anything else
    initConfigPath(parseConfigArg());

    // Handle --install mode (non-interactive install)
    if (process.argv.includes('--install')) {
        const useBunx = isBunxAvailable();
        await installStatusLine(useBunx);
        const runner = useBunx ? 'bunx' : 'npx';
        console.log(`dashcc installed successfully (using ${runner}).`);
        console.log('Restart Claude Code to see the status line.');
        return;
    }

    // Handle --uninstall mode (non-interactive uninstall)
    if (process.argv.includes('--uninstall')) {
        await uninstallStatusLine();
        console.log('dashcc uninstalled successfully.');
        return;
    }

    // Handle --setup mode
    if (process.argv.includes('--setup')) {
        printSetup();
        return;
    }

    if (process.argv.includes('--write-session-status')) {
        handleWriteSessionStatus();
        return;
    }

    // Handle --hook mode (cross-platform hook handler for widgets)
    if (process.argv.includes('--hook')) {
        await handleHook();
        return;
    }

    // Check if we're in a piped/non-TTY environment first
    if (!process.stdin.isTTY) {
        await ensureWindowsUtf8CodePage();

        // We're receiving piped input
        const input = await readStdin();
        const jsonInput = (input && input.trim() !== '') ? input.trim() : null;

        if (jsonInput) {
            try {
                const result = StatusJSONSchema.safeParse(JSON.parse(jsonInput));
                if (!result.success) {
                    console.error('Invalid status JSON format:', result.error.message);
                    process.exit(1);
                }

                if (result.data.session_id) {
                    recordSessionActivity(
                        result.data.session_id,
                        deriveProjectCwd(result.data),
                        result.data.transcript_path ?? null
                    );
                }

                await renderMultipleLines(result.data);
            } catch (error) {
                console.error('Error parsing JSON:', error);
                process.exit(1);
            }
        }
    } else {
        // Interactive mode - run TUI
        runTUI();
    }
}

void main();