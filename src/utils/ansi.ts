import stringWidth from 'string-width';

const ESC = '\x1b';
const BEL = '\x07';
const C1_CSI = '\x9b';
const C1_OSC = '\x9d';
const ST = '\x9c';

const SGR_REGEX = /\x1b\[[0-9;]*m/g;

type Osc8Action = 'open' | 'close';
type OscTerminator = 'bel' | 'st';

interface ParsedEscapeSequence {
    nextIndex: number;
    sequence: string;
    osc8Action?: Osc8Action;
    osc8Terminator?: OscTerminator;
}

function isCsiFinalByte(codePoint: number): boolean {
    return codePoint >= 0x40 && codePoint <= 0x7e;
}

function parseCsi(input: string, start: number, bodyStart: number): ParsedEscapeSequence {
    let index = bodyStart;
    while (index < input.length) {
        const codePoint = input.charCodeAt(index);
        if (isCsiFinalByte(codePoint)) {
            const end = index + 1;
            return {
                nextIndex: end,
                sequence: input.slice(start, end)
            };
        }
        index++;
    }

    return {
        nextIndex: input.length,
        sequence: input.slice(start)
    };
}

function getOsc8Action(body: string): Osc8Action | undefined {
    if (!body.startsWith('8;')) {
        return undefined;
    }

    const urlStart = body.indexOf(';', 2);
    if (urlStart === -1) {
        return undefined;
    }

    const url = body.slice(urlStart + 1);
    return url.length > 0 ? 'open' : 'close';
}

function parseOsc(
    input: string,
    start: number,
    bodyStart: number
): ParsedEscapeSequence {
    let index = bodyStart;

    while (index < input.length) {
        const current = input[index];
        if (!current) {
            break;
        }

        if (current === BEL) {
            const end = index + 1;
            const body = input.slice(bodyStart, index);
            return {
                nextIndex: end,
                sequence: input.slice(start, end),
                osc8Action: getOsc8Action(body),
                osc8Terminator: 'bel'
            };
        }

        if (current === ST) {
            const end = index + 1;
            const body = input.slice(bodyStart, index);
            return {
                nextIndex: end,
                sequence: input.slice(start, end),
                osc8Action: getOsc8Action(body),
                osc8Terminator: 'st'
            };
        }

        if (current === ESC && input[index + 1] === '\\') {
            const end = index + 2;
            const body = input.slice(bodyStart, index);
            return {
                nextIndex: end,
                sequence: input.slice(start, end),
                osc8Action: getOsc8Action(body),
                osc8Terminator: 'st'
            };
        }

        index++;
    }

    return {
        nextIndex: input.length,
        sequence: input.slice(start)
    };
}

function parseEscapeSequence(input: string, index: number): ParsedEscapeSequence | null {
    const current = input[index];
    if (!current) {
        return null;
    }

    if (current === ESC) {
        const next = input[index + 1];
        if (next === '[') {
            return parseCsi(input, index, index + 2);
        }
        if (next === ']') {
            return parseOsc(input, index, index + 2);
        }
        if (next) {
            return {
                nextIndex: index + 2,
                sequence: input.slice(index, index + 2)
            };
        }
        return {
            nextIndex: input.length,
            sequence: current
        };
    }

    if (current === C1_CSI) {
        return parseCsi(input, index, index + 1);
    }

    if (current === C1_OSC) {
        return parseOsc(input, index, index + 1);
    }

    return null;
}

function getOsc8CloseSequence(terminator: OscTerminator): string {
    if (terminator === 'bel') {
        return `${ESC}]8;;${BEL}`;
    }
    return `${ESC}]8;;${ESC}\\`;
}

export function stripSgrCodes(text: string): string {
    return text.replace(SGR_REGEX, '');
}

export function getVisibleText(text: string): string {
    let result = '';
    let index = 0;

    while (index < text.length) {
        const escape = parseEscapeSequence(text, index);
        if (escape) {
            index = escape.nextIndex;
            continue;
        }

        const codePoint = text.codePointAt(index);
        if (codePoint === undefined) {
            break;
        }

        const character = String.fromCodePoint(codePoint);
        result += character;
        index += character.length;
    }

    return result;
}

export function getVisibleWidth(text: string): number {
    return stringWidth(getVisibleText(text));
}

interface TruncateOptions { ellipsis?: boolean }

interface StyledGlyph {
    char: string;
    width: number;
    immediateEscapes: string;
    cumulativeEscapesBefore: string;
    osc8Before: OscTerminator | null;
}

interface ParsedStyledText {
    glyphs: StyledGlyph[];
    trailingEscapes: string;
    finalOsc8Terminator: OscTerminator | null;
}

interface WrapBreakpoint {
    breakEnd: number;
    nextStart: number;
}

interface WrapStyledTextOptions {
    maxLines?: number;
    ellipsis?: boolean;
}

const PREFERRED_WRAP_BREAKS = new Set([
    ' ',
    '\t',
    '-',
    '/',
    '\\',
    ',',
    '.',
    ':',
    ';',
    '!',
    '?',
    ')',
    ']',
    '}',
    '，',
    '。',
    '：',
    '；',
    '！',
    '？',
    '、',
    '）',
    '】',
    '」',
    '』'
]);

function parseStyledText(text: string): ParsedStyledText {
    const glyphs: StyledGlyph[] = [];
    let index = 0;
    let pendingEscapes = '';
    let cumulativeEscapes = '';
    let openOsc8Terminator: OscTerminator | null = null;

    while (index < text.length) {
        const escape = parseEscapeSequence(text, index);
        if (escape) {
            pendingEscapes += escape.sequence;
            cumulativeEscapes += escape.sequence;
            index = escape.nextIndex;

            if (escape.osc8Action === 'open') {
                openOsc8Terminator = escape.osc8Terminator ?? 'st';
            } else if (escape.osc8Action === 'close') {
                openOsc8Terminator = null;
            }
            continue;
        }

        const codePoint = text.codePointAt(index);
        if (codePoint === undefined) {
            break;
        }

        const char = String.fromCodePoint(codePoint);
        glyphs.push({
            char,
            width: stringWidth(char),
            immediateEscapes: pendingEscapes,
            cumulativeEscapesBefore: cumulativeEscapes,
            osc8Before: openOsc8Terminator
        });
        pendingEscapes = '';
        index += char.length;
    }

    return {
        glyphs,
        trailingEscapes: pendingEscapes,
        finalOsc8Terminator: openOsc8Terminator
    };
}

function isWhitespaceCharacter(char: string): boolean {
    return /^\s$/u.test(char);
}

function isPreferredWrapBreak(char: string): boolean {
    return isWhitespaceCharacter(char) || PREFERRED_WRAP_BREAKS.has(char);
}

function trimTrailingWhitespaceEnd(glyphs: StyledGlyph[], start: number, end: number): number {
    let trimmedEnd = end;
    while (trimmedEnd > start && isWhitespaceCharacter(glyphs[trimmedEnd - 1]?.char ?? '')) {
        trimmedEnd--;
    }
    return trimmedEnd;
}

function skipLeadingWhitespace(glyphs: StyledGlyph[], start: number): number {
    let nextStart = start;
    while (nextStart < glyphs.length && isWhitespaceCharacter(glyphs[nextStart]?.char ?? '')) {
        nextStart++;
    }
    return nextStart;
}

function buildStyledSlice(parsed: ParsedStyledText, start: number, end: number): string {
    if (start >= end) {
        return '';
    }

    const firstGlyph = parsed.glyphs[start];
    if (!firstGlyph) {
        return '';
    }

    let output = firstGlyph.cumulativeEscapesBefore + firstGlyph.char;
    for (let index = start + 1; index < end; index++) {
        const glyph = parsed.glyphs[index];
        if (!glyph) {
            continue;
        }
        output += glyph.immediateEscapes + glyph.char;
    }

    if (end === parsed.glyphs.length && parsed.trailingEscapes) {
        output += parsed.trailingEscapes;
    }

    const openOsc8Terminator = end < parsed.glyphs.length
        ? parsed.glyphs[end]?.osc8Before ?? null
        : parsed.finalOsc8Terminator;

    if (openOsc8Terminator) {
        output += getOsc8CloseSequence(openOsc8Terminator);
    }

    return output;
}

export function truncateStyledText(
    text: string,
    maxWidth: number,
    options: TruncateOptions = {}
): string {
    if (maxWidth <= 0) {
        return '';
    }

    if (getVisibleWidth(text) <= maxWidth) {
        return text;
    }

    const addEllipsis = options.ellipsis ?? true;
    const ellipsis = addEllipsis ? '...' : '';
    const ellipsisWidth = addEllipsis ? stringWidth(ellipsis) : 0;

    if (addEllipsis && maxWidth <= ellipsisWidth) {
        return '.'.repeat(maxWidth);
    }

    const targetWidth = Math.max(0, maxWidth - ellipsisWidth);
    let output = '';
    let currentWidth = 0;
    let index = 0;
    let didTruncate = false;
    let openOsc8Terminator: OscTerminator | null = null;

    while (index < text.length) {
        const escape = parseEscapeSequence(text, index);
        if (escape) {
            output += escape.sequence;
            index = escape.nextIndex;

            if (escape.osc8Action === 'open') {
                openOsc8Terminator = escape.osc8Terminator ?? 'st';
            } else if (escape.osc8Action === 'close') {
                openOsc8Terminator = null;
            }
            continue;
        }

        const codePoint = text.codePointAt(index);
        if (codePoint === undefined) {
            break;
        }

        const character = String.fromCodePoint(codePoint);
        const charWidth = stringWidth(character);

        if (currentWidth + charWidth > targetWidth) {
            didTruncate = true;
            break;
        }

        output += character;
        currentWidth += charWidth;
        index += character.length;
    }

    if (!didTruncate) {
        return text;
    }

    if (openOsc8Terminator) {
        output += getOsc8CloseSequence(openOsc8Terminator);
    }

    return output + ellipsis;
}

export function wrapStyledText(
    text: string,
    maxWidth: number,
    options: WrapStyledTextOptions = {}
): string[] {
    if (maxWidth <= 0) {
        return [];
    }

    if (getVisibleWidth(text) <= maxWidth) {
        return [text];
    }

    const parsed = parseStyledText(text);
    if (parsed.glyphs.length === 0) {
        return text.length > 0 ? [text] : [];
    }

    const lines: string[] = [];
    const maxLines = options.maxLines;
    let start = 0;

    while (start < parsed.glyphs.length) {
        if (maxLines && lines.length === maxLines - 1) {
            const remaining = buildStyledSlice(parsed, start, parsed.glyphs.length);
            lines.push(truncateStyledText(remaining, maxWidth, { ellipsis: options.ellipsis ?? true }));
            return lines;
        }

        let width = 0;
        let index = start;
        let farthestEnd = start;
        let lastBreakpoint: WrapBreakpoint | null = null;

        while (index < parsed.glyphs.length) {
            const glyph = parsed.glyphs[index];
            if (!glyph || (width + glyph.width) > maxWidth) {
                break;
            }

            width += glyph.width;
            index++;
            farthestEnd = index;

            if (isWhitespaceCharacter(glyph.char)) {
                const breakEnd = trimTrailingWhitespaceEnd(parsed.glyphs, start, index);
                lastBreakpoint = {
                    breakEnd,
                    nextStart: skipLeadingWhitespace(parsed.glyphs, index)
                };
            } else if (isPreferredWrapBreak(glyph.char)) {
                lastBreakpoint = {
                    breakEnd: index,
                    nextStart: skipLeadingWhitespace(parsed.glyphs, index)
                };
            }
        }

        if (farthestEnd === start) {
            farthestEnd = Math.min(start + 1, parsed.glyphs.length);
        }

        let end = farthestEnd;
        let nextStart = skipLeadingWhitespace(parsed.glyphs, farthestEnd);

        if (index < parsed.glyphs.length && lastBreakpoint && lastBreakpoint.breakEnd > start) {
            end = lastBreakpoint.breakEnd;
            nextStart = lastBreakpoint.nextStart;
        }

        const line = buildStyledSlice(parsed, start, end);
        if (line.length > 0) {
            lines.push(line);
        }

        start = nextStart;
    }

    return lines;
}

export function trimStyledWhitespace(text: string): string {
    const parsed = parseStyledText(text);
    if (parsed.glyphs.length === 0) {
        return '';
    }

    let start = 0;
    while (start < parsed.glyphs.length && isWhitespaceCharacter(parsed.glyphs[start]?.char ?? '')) {
        start++;
    }

    let end = parsed.glyphs.length;
    while (end > start && isWhitespaceCharacter(parsed.glyphs[end - 1]?.char ?? '')) {
        end--;
    }

    if (start === 0 && end === parsed.glyphs.length) {
        return text;
    }

    return buildStyledSlice(parsed, start, end);
}