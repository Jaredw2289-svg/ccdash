import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ClaudeSettings } from '../types/ClaudeSettings';
import {
    DEFAULT_SETTINGS,
    SettingsSchema,
    type Settings
} from '../types/Settings';

import {
    getConfigPath,
    isCustomConfigPath
} from './config';

// Re-export for backward compatibility
export type { ClaudeSettings };

// Use fs.promises directly
const readFile = fs.promises.readFile;
const writeFile = fs.promises.writeFile;
const mkdir = fs.promises.mkdir;

export const CCSTATUSLINE_COMMANDS = {
    NPM: 'npx -y dashcc@latest',
    BUNX: 'bunx -y dashcc@latest',
    SELF_MANAGED: 'dashcc'
};

export function isKnownCommand(command: string): boolean {
    const prefixes = [CCSTATUSLINE_COMMANDS.NPM, CCSTATUSLINE_COMMANDS.BUNX, CCSTATUSLINE_COMMANDS.SELF_MANAGED];
    return prefixes.some(prefix => command === prefix || command.startsWith(`${prefix} --config `));
}

function needsQuoting(filePath: string): boolean {
    if (process.platform === 'win32') {
        // cmd.exe-safe set of characters that require quoting.
        return /[\s&()<>|^"]/.test(filePath);
    }

    return /[\s()[\];&#|'"\\$`]/.test(filePath);
}

function quotePathIfNeeded(filePath: string): string {
    if (!needsQuoting(filePath)) {
        return filePath;
    }

    if (process.platform === 'win32') {
        return `"${filePath.replace(/"/g, '""')}"`;
    }

    return `'${filePath.replace(/'/g, '\'\\\'\'')}'`;
}

/**
 * Determines the Claude config directory, checking CLAUDE_CONFIG_DIR environment variable first,
 * then falling back to the default ~/.claude directory.
 */
export function getClaudeConfigDir(): string {
    const envConfigDir = process.env.CLAUDE_CONFIG_DIR;

    if (envConfigDir) {
        try {
            // Validate that the path is absolute and reasonable
            const resolvedPath = path.resolve(envConfigDir);

            // Check if directory exists or can be created
            if (fs.existsSync(resolvedPath)) {
                const stats = fs.statSync(resolvedPath);
                if (stats.isDirectory()) {
                    return resolvedPath;
                }
            } else {
                // Directory doesn't exist yet, but we can try to use it
                // (mkdir will be called later when saving)
                return resolvedPath;
            }
        } catch {
            // Fall through to default on any error
        }
    }

    // Default fallback
    return path.join(os.homedir(), '.claude');
}

/**
 * Gets the full path to the Claude settings.json file.
 */
export function getClaudeSettingsPath(): string {
    return path.join(getClaudeConfigDir(), 'settings.json');
}

/**
 * Creates a backup of the current Claude settings file.
 */
async function backupClaudeSettings(suffix = '.bak'): Promise<string | null> {
    const settingsPath = getClaudeSettingsPath();
    const backupPath = settingsPath + suffix;
    try {
        if (fs.existsSync(settingsPath)) {
            const content = await readFile(settingsPath, 'utf-8');
            await writeFile(backupPath, content, 'utf-8');
            return backupPath;
        }
    } catch (error) {
        console.error('Failed to backup Claude settings:', error);
    }

    return null;
}

interface LoadClaudeSettingsOptions { logErrors?: boolean }

export async function loadClaudeSettings(options: LoadClaudeSettingsOptions = {}): Promise<ClaudeSettings> {
    const { logErrors = true } = options;
    const settingsPath = getClaudeSettingsPath();

    // File doesn't exist - return empty object
    if (!fs.existsSync(settingsPath)) {
        return {};
    }

    try {
        const content = await readFile(settingsPath, 'utf-8');
        return JSON.parse(content) as ClaudeSettings;
    } catch (error) {
        if (logErrors) {
            console.error('Failed to load Claude settings:', error);
        }
        throw error;
    }
}

export async function saveClaudeSettings(
    settings: ClaudeSettings
): Promise<void> {
    const settingsPath = getClaudeSettingsPath();
    const dir = path.dirname(settingsPath);

    // Backup settings before overwriting
    await backupClaudeSettings();

    await mkdir(dir, { recursive: true });
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

export async function isInstalled(): Promise<boolean> {
    let settings: ClaudeSettings;

    try {
        settings = await loadClaudeSettings({ logErrors: false });
    } catch {
        return false; // Can't determine if installed, assume not
    }
    const command = settings.statusLine?.command ?? '';

    return (
        isKnownCommand(command)
        && (settings.statusLine?.padding === 0
            || settings.statusLine?.padding === undefined)
    );
}

export function isBunxAvailable(): boolean {
    try {
        // Use platform-appropriate command to check for bunx availability
        const command = process.platform === 'win32' ? 'where bunx' : 'which bunx';
        execSync(command, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function buildCommand(baseCommand: string): string {
    if (isCustomConfigPath()) {
        return `${baseCommand} --config ${quotePathIfNeeded(getConfigPath())}`;
    }
    return baseCommand;
}

async function loadSavedSettingsForHookSync(): Promise<Settings | null> {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
        return DEFAULT_SETTINGS;
    }

    try {
        const content = await readFile(configPath, 'utf-8');
        const parsed = JSON.parse(content) as unknown;
        const result = SettingsSchema.safeParse(parsed);
        if (!result.success) {
            return null;
        }
        return result.data;
    } catch {
        return null;
    }
}

export async function installStatusLine(useBunx = false): Promise<void> {
    let settings: ClaudeSettings;

    const backupPath = await backupClaudeSettings('.orig');
    try {
        settings = await loadClaudeSettings({ logErrors: false });
    } catch {
        const fallbackBackupPath = `${getClaudeSettingsPath()}.orig`;
        console.error(`Warning: Could not read existing Claude settings. A backup exists at ${backupPath ?? fallbackBackupPath}.`);
        settings = {};
    }

    const baseCommand = useBunx
        ? CCSTATUSLINE_COMMANDS.BUNX
        : CCSTATUSLINE_COMMANDS.NPM;

    // Update settings with our status line (confirmation already handled in TUI)
    settings.statusLine = {
        type: 'command',
        command: buildCommand(baseCommand),
        padding: 0
    };

    await saveClaudeSettings(settings);

    const savedSettings = await loadSavedSettingsForHookSync();
    if (savedSettings) {
        const { syncWidgetHooks } = await import('./hooks');
        await syncWidgetHooks(savedSettings);
    }

    await installGlobalClaudeMd(useBunx);
}

export async function uninstallStatusLine(): Promise<void> {
    let settings: ClaudeSettings;

    try {
        settings = await loadClaudeSettings({ logErrors: false });
    } catch {
        console.error('Warning: Could not read existing Claude settings.');
        return; // if we can't read, return... what are we uninstalling?
    }

    if (settings.statusLine) {
        delete settings.statusLine;
        await saveClaudeSettings(settings);
    }

    try {
        const { removeManagedHooks } = await import('./hooks');
        await removeManagedHooks();
    } catch {
        // Ignore hook cleanup failures during uninstall
    }

    await uninstallGlobalClaudeMd();
}

// --- Global CLAUDE.md management ---

const CLAUDE_MD_TAG_START = '<!-- ccdash:session-dashboard-start -->';
const CLAUDE_MD_TAG_END = '<!-- ccdash:session-dashboard-end -->';

function getGlobalClaudeMdPath(): string {
    return path.join(getClaudeConfigDir(), 'CLAUDE.md');
}

function buildSessionDashboardSection(baseCommand: string): string {
    const command = isCustomConfigPath()
        ? `${baseCommand} --config ${quotePathIfNeeded(getConfigPath())}`
        : baseCommand;

    return `${CLAUDE_MD_TAG_START}
## Session Dashboard Status

After every assistant response, update the per-session dashboard status.

- Purpose: keep both \`Goal:\` and \`Now:\` accurate for the current Claude Code session.
- Goal is **fully Claude-managed** — if you don't write one, it stays empty. No automatic derivation from user prompts.
- Output style: match the user's language. High-level, no chain-of-thought, no markdown list markers, no surrounding quotes.
- Length: target 40-90 characters, hard max 120 characters.
- \`now\`: always update with the latest visible conclusion, completed step, or current action.
- \`goal\`: **required on the first turn** of each session. Should be a distilled session objective, not a paraphrase of the user's question. Update only when the stable session goal meaningfully changes.
- Privacy: never write hidden reasoning or private scratch work.

Write it with:

\`\`\`bash
${command} --write-session-status --now "<high-level now summary>" --goal "<stable session goal>"
\`\`\`

The session ID is automatically resolved from the hook cache — no \`--session\` flag or \`$SESSION_ID\` needed.
${CLAUDE_MD_TAG_END}`;
}

export async function installGlobalClaudeMd(useBunx: boolean): Promise<void> {
    const mdPath = getGlobalClaudeMdPath();
    const baseCommand = useBunx ? CCSTATUSLINE_COMMANDS.BUNX : CCSTATUSLINE_COMMANDS.NPM;
    const section = buildSessionDashboardSection(baseCommand);

    let content = '';
    try {
        content = await readFile(mdPath, 'utf-8');
    } catch {
        // File doesn't exist yet
    }

    // Replace existing managed section, or append
    const startIdx = content.indexOf(CLAUDE_MD_TAG_START);
    const endIdx = content.indexOf(CLAUDE_MD_TAG_END);

    if (startIdx !== -1 && endIdx !== -1) {
        content = content.substring(0, startIdx) + section + content.substring(endIdx + CLAUDE_MD_TAG_END.length);
    } else {
        const separator = content.length > 0 && !content.endsWith('\n') ? '\n\n' : content.length > 0 ? '\n' : '';
        content = content + separator + section + '\n';
    }

    await mkdir(path.dirname(mdPath), { recursive: true });
    await writeFile(mdPath, content, 'utf-8');
}

export async function uninstallGlobalClaudeMd(): Promise<void> {
    const mdPath = getGlobalClaudeMdPath();

    let content: string;
    try {
        content = await readFile(mdPath, 'utf-8');
    } catch {
        return; // File doesn't exist, nothing to remove
    }

    const startIdx = content.indexOf(CLAUDE_MD_TAG_START);
    const endIdx = content.indexOf(CLAUDE_MD_TAG_END);

    if (startIdx === -1 || endIdx === -1) {
        return; // No managed section found
    }

    // Remove the section and any surrounding blank lines
    let before = content.substring(0, startIdx);
    let after = content.substring(endIdx + CLAUDE_MD_TAG_END.length);
    before = before.replace(/\n+$/, '');
    after = after.replace(/^\n+/, '');
    const result = before.length > 0 && after.length > 0
        ? before + '\n\n' + after
        : before + after;

    if (result.trim().length === 0) {
        // File is empty after removal, delete it
        try { fs.unlinkSync(mdPath); } catch { /* ignore */ }
    } else {
        await writeFile(mdPath, result.endsWith('\n') ? result : result + '\n', 'utf-8');
    }
}

export async function getExistingStatusLine(): Promise<string | null> {
    try {
        const settings = await loadClaudeSettings({ logErrors: false });
        return settings.statusLine?.command ?? null;
    } catch {
        return null; // Can't read settings, return null
    }
}