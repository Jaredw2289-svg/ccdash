import * as fs from 'fs';
import * as path from 'path';

export const CCDASH_SESSION_ID_ENV_VAR = 'CCDASH_SESSION_ID';
export const CCDASH_TRANSCRIPT_PATH_ENV_VAR = 'CCDASH_TRANSCRIPT_PATH';
export const CCDASH_PROJECT_DIR_ENV_VAR = 'CCDASH_PROJECT_DIR';
export const CLAUDE_ENV_FILE_ENV_VAR = 'CLAUDE_ENV_FILE';

const MANAGED_CCDASH_ENV_VARS = [
    CCDASH_SESSION_ID_ENV_VAR,
    CCDASH_TRANSCRIPT_PATH_ENV_VAR,
    CCDASH_PROJECT_DIR_ENV_VAR
];

function quoteShellValue(value: string): string {
    return `'${value.replace(/'/g, '\'\\\'\'')}'`;
}

function isManagedCcdashExport(line: string): boolean {
    return MANAGED_CCDASH_ENV_VARS.some(name => line.startsWith(`export ${name}=`));
}

export function getSessionIdFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
    const sessionId = env[CCDASH_SESSION_ID_ENV_VAR]?.trim();
    return sessionId && sessionId.length > 0 ? sessionId : null;
}

export function writeSessionEnvFile(
    envFilePath: string,
    values: {
        sessionId: string;
        transcriptPath?: string | null;
        projectDir?: string | null;
    }
): void {
    const trimmedPath = envFilePath.trim();
    if (trimmedPath.length === 0) {
        return;
    }

    let existingLines: string[] = [];
    try {
        existingLines = fs.readFileSync(trimmedPath, 'utf-8').split('\n');
    } catch {
        existingLines = [];
    }

    const preservedLines = existingLines.filter(line => !isManagedCcdashExport(line));
    while (preservedLines.length > 0 && preservedLines[preservedLines.length - 1] === '') {
        preservedLines.pop();
    }

    preservedLines.push(`export ${CCDASH_SESSION_ID_ENV_VAR}=${quoteShellValue(values.sessionId)}`);
    preservedLines.push(`export ${CCDASH_TRANSCRIPT_PATH_ENV_VAR}=${quoteShellValue(values.transcriptPath ?? '')}`);
    preservedLines.push(`export ${CCDASH_PROJECT_DIR_ENV_VAR}=${quoteShellValue(values.projectDir ?? '')}`);

    fs.mkdirSync(path.dirname(trimmedPath), { recursive: true });
    fs.writeFileSync(trimmedPath, preservedLines.join('\n') + '\n', 'utf-8');
}