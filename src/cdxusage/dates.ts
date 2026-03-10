function getFormatterPart(
    timestamp: string,
    timezone: string,
    partType: 'year' | 'month' | 'day'
): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    const parts = formatter.formatToParts(new Date(timestamp));
    return parts.find(part => part.type === partType)?.value ?? '';
}

export function getDateKey(timestamp: string, timezone: string): string {
    const year = getFormatterPart(timestamp, timezone, 'year');
    const month = getFormatterPart(timestamp, timezone, 'month');
    const day = getFormatterPart(timestamp, timezone, 'day');
    return `${year}-${month}-${day}`;
}

export function getMonthKey(timestamp: string, timezone: string): string {
    const year = getFormatterPart(timestamp, timezone, 'year');
    const month = getFormatterPart(timestamp, timezone, 'month');
    return `${year}-${month}`;
}

export function formatTimestamp(
    timestamp: string,
    timezone: string,
    locale?: string
): string {
    return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone
    }).format(new Date(timestamp));
}

export function normalizeDayInput(input: string): string | null {
    const trimmed = input.trim();
    const compactMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(trimmed);
    if (compactMatch) {
        return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
    }

    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

export function normalizeMonthInput(input: string): string | null {
    const trimmed = input.trim();
    const compactMatch = /^(\d{4})(\d{2})$/.exec(trimmed);
    if (compactMatch) {
        return `${compactMatch[1]}-${compactMatch[2]}`;
    }

    return /^\d{4}-\d{2}$/.test(trimmed) ? trimmed : null;
}

export function getMonthBounds(monthKey: string): { since: string; until: string } {
    const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
    if (!match) {
        throw new Error(`Invalid month key: ${monthKey}`);
    }

    const yearPart = match[1];
    const monthPart = match[2];
    if (!yearPart || !monthPart) {
        throw new Error(`Invalid month key: ${monthKey}`);
    }

    const year = Number.parseInt(yearPart, 10);
    const month = Number.parseInt(monthPart, 10);
    const nextMonth = new Date(Date.UTC(year, month, 1));
    const lastDay = new Date(nextMonth.getTime() - (24 * 60 * 60 * 1000));
    const until = lastDay.toISOString().slice(0, 10);

    return {
        since: `${yearPart}-${monthPart}-01`,
        until
    };
}