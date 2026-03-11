import * as fs from 'fs';

const TAIL_BYTES = 50 * 1024; // Read last 50KB of transcript
const HEAD_BYTES = 10 * 1024; // Read first 10KB for initial user message

interface TranscriptEntry {
    type?: string;
    isSidechain?: boolean;
    message?: {
        role?: string;
        content?: { type?: string; text?: string }[] | string;
    };
}

const SYSTEM_MARKER_RE = /^\[(?:Request interrupted|Tool interrupted|Interrupted|Error)/;

function isSystemMarker(text: string): boolean {
    return SYSTEM_MARKER_RE.test(text.trim());
}

function extractTextFromContent(content: { type?: string; text?: string }[] | string | undefined): string | null {
    if (typeof content === 'string') {
        return content.trim() || null;
    }
    if (!Array.isArray(content)) {
        return null;
    }
    for (const block of content) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            return block.text.trim();
        }
    }
    return null;
}

function extractFirstSentence(text: string, maxLength: number): string {
    // Strip markdown-style headers, bullet points, and leading whitespace
    let cleaned = text.replace(/^#+\s+/gm, '').replace(/^\s*[-*]\s+/gm, '').trim();

    // Take the first non-empty line
    const lines = cleaned.split('\n').filter(l => l.trim().length > 0);
    cleaned = lines[0] ?? cleaned;

    // Find the first sentence boundary
    const sentenceEnd = cleaned.search(/[.!?]\s/);
    if (sentenceEnd !== -1 && sentenceEnd < maxLength) {
        return cleaned.substring(0, sentenceEnd + 1);
    }

    // No sentence boundary found or it's too far — truncate
    if (cleaned.length <= maxLength) {
        return cleaned;
    }
    return cleaned.substring(0, maxLength - 1) + '\u2026';
}

const PREAMBLE_REGEX = /^(?:(?:please\s+)?(?:implement|design|create|build|add|fix|update|refactor)\s+(?:the\s+following\s+(?:plan|feature|change|fix)\s*:?\s*|a\s+|support\s+for\s+|the\s+)?)/i;

function truncateWithEllipsis(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
        return text;
    }
    return text.substring(0, maxLength - 1) + '\u2026';
}

/**
 * Extract a high-level session goal from user text.
 * Looks for markdown headings with plan/goal/task keywords first, then any heading,
 * then strips common preamble prefixes, falling back to extractFirstSentence.
 */
export function extractSessionGoal(text: string, maxLength: number): string {
    const lines = text.split('\n');

    // Step 1: Scan for headings with plan/goal/task keywords
    const keywordHeadingRegex = /^#{1,3}\s+(?:Plan:|Goal:|Task:|Feature:|Bug:|Fix:)\s*(.+)/i;
    for (const line of lines) {
        const match = keywordHeadingRegex.exec(line.trim());
        if (match?.[1]) {
            return truncateWithEllipsis(match[1].trim(), maxLength);
        }
    }

    // Step 2: Any markdown heading
    const anyHeadingRegex = /^#{1,3}\s+(.+)/;
    for (const line of lines) {
        const match = anyHeadingRegex.exec(line.trim());
        if (match?.[1]) {
            return truncateWithEllipsis(match[1].trim(), maxLength);
        }
    }

    // Step 3: Strip common preamble from first non-empty line
    const firstLine = lines.find(l => l.trim().length > 0)?.trim() ?? '';
    if (firstLine) {
        const stripped = firstLine.replace(PREAMBLE_REGEX, '').trim();
        if (stripped.length > 0) {
            // Remove trailing colon if the stripping left one
            const cleaned = stripped.replace(/:$/, '').trim();
            if (cleaned.length > 0) {
                return truncateWithEllipsis(cleaned, maxLength);
            }
        }
    }

    // Step 4: Fallback to extractFirstSentence
    return extractFirstSentence(text, maxLength);
}

/**
 * Extract the last assistant message summary from a transcript JSONL file.
 * Only reads the tail of the file for performance.
 */
export function getLastAssistantSummary(transcriptPath: string, maxLength: number): string | null {
    let fd: number | null = null;
    try {
        fd = fs.openSync(transcriptPath, 'r');
        const stat = fs.fstatSync(fd);
        const fileSize = stat.size;
        if (fileSize === 0) {
            return null;
        }

        const readSize = Math.min(TAIL_BYTES, fileSize);
        const startPos = fileSize - readSize;
        const buffer = Buffer.alloc(readSize);
        fs.readSync(fd, buffer, 0, readSize, startPos);

        const tail = buffer.toString('utf-8');
        const lines = tail.split('\n').filter(l => l.trim().length > 0);

        // Scan backwards for the most recent assistant message
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            if (!line)
                continue;

            try {
                const entry = JSON.parse(line) as TranscriptEntry;

                // Skip sidechain entries
                if (entry.isSidechain === true)
                    continue;

                // Look for assistant messages
                if (entry.type === 'assistant' || entry.message?.role === 'assistant') {
                    const text = extractTextFromContent(entry.message?.content);
                    if (text) {
                        return extractFirstSentence(text, maxLength);
                    }
                }
            } catch {
                // Invalid JSON line (possibly partial from tail read) — skip
                continue;
            }
        }

        // No assistant text found — try last user message
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            if (!line)
                continue;

            try {
                const entry = JSON.parse(line) as TranscriptEntry;
                if (entry.isSidechain === true)
                    continue;

                if (entry.type === 'human' || entry.message?.role === 'user') {
                    const text = extractTextFromContent(entry.message?.content);
                    if (text && !isSystemMarker(text)) {
                        return extractFirstSentence(text, maxLength);
                    }
                }
            } catch {
                continue;
            }
        }

        return null;
    } catch {
        return null;
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch { /* ignore */ }
        }
    }
}

/**
 * Extract the first user message summary from a transcript JSONL file.
 * Reads the head of the file to find the initial task description (high-level goal).
 */
const OVERVIEW_BYTES = 200 * 1024; // Read up to 200KB for session overview

/**
 * Extract a session overview from a transcript JSONL file.
 * Counts human turns and shows the last assistant action with turn context.
 * Format: "Turn N · last action" for multi-turn sessions, or just the action for single-turn.
 */
export function getSessionOverview(transcriptPath: string, maxLength: number): string | null {
    let fd: number | null = null;
    try {
        fd = fs.openSync(transcriptPath, 'r');
        const stat = fs.fstatSync(fd);
        const fileSize = stat.size;
        if (fileSize === 0) {
            return null;
        }

        const readSize = Math.min(OVERVIEW_BYTES, fileSize);
        const startPos = fileSize <= OVERVIEW_BYTES ? 0 : fileSize - readSize;
        const buffer = Buffer.alloc(readSize);
        fs.readSync(fd, buffer, 0, readSize, startPos);

        const content = buffer.toString('utf-8');
        const jsonLines = content.split('\n').filter(l => l.trim().length > 0);

        let humanCount = 0;
        let lastAssistantText: string | null = null;

        for (const jsonLine of jsonLines) {
            try {
                const entry = JSON.parse(jsonLine) as TranscriptEntry;
                if (entry.isSidechain === true)
                    continue;

                if (entry.type === 'human' || entry.message?.role === 'user') {
                    humanCount++;
                } else if (entry.type === 'assistant' || entry.message?.role === 'assistant') {
                    const text = extractTextFromContent(entry.message?.content);
                    if (text) {
                        lastAssistantText = text;
                    }
                }
            } catch {
                continue;
            }
        }

        if (!lastAssistantText) {
            return null;
        }

        const action = extractFirstSentence(lastAssistantText, maxLength);
        if (humanCount <= 1) {
            return truncateWithEllipsis(action, maxLength);
        }

        const prefix = `Turn ${humanCount} · `;
        const available = maxLength - prefix.length;
        if (available < 10) {
            return truncateWithEllipsis(action, maxLength);
        }

        return prefix + truncateWithEllipsis(action, available);
    } catch {
        return null;
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch { /* ignore */ }
        }
    }
}

/**
 * Extract the first user message summary from a transcript JSONL file.
 * Reads the head of the file to find the initial task description (high-level goal).
 */
export function getFirstUserSummary(transcriptPath: string, maxLength: number): string | null {
    let fd: number | null = null;
    try {
        fd = fs.openSync(transcriptPath, 'r');
        const stat = fs.fstatSync(fd);
        const fileSize = stat.size;
        if (fileSize === 0) {
            return null;
        }

        const readSize = Math.min(HEAD_BYTES, fileSize);
        const buffer = Buffer.alloc(readSize);
        fs.readSync(fd, buffer, 0, readSize, 0);

        const head = buffer.toString('utf-8');
        const lines = head.split('\n').filter(l => l.trim().length > 0);

        // Scan forward for the first user message
        for (const line of lines) {
            try {
                const entry = JSON.parse(line) as TranscriptEntry;

                if (entry.isSidechain === true)
                    continue;

                if (entry.type === 'human' || entry.message?.role === 'user') {
                    const text = extractTextFromContent(entry.message?.content);
                    if (text && !isSystemMarker(text)) {
                        return extractSessionGoal(text, maxLength);
                    }
                }
            } catch {
                continue;
            }
        }

        return null;
    } catch {
        return null;
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch { /* ignore */ }
        }
    }
}