import { withClaudeUsage } from './sources/claude';
import { withCodexUsage } from './sources/codex';
import type {
    ParsedUsageData,
    SourceSelection
} from './types';

interface LoadUsageOptions {
    claudeHome?: string;
    codexHome?: string;
    source: SourceSelection;
}

export function loadUsageData(options: LoadUsageOptions): ParsedUsageData {
    let data: ParsedUsageData = {
        selectedSource: options.source,
        records: [],
        sources: {}
    };

    if (options.source === 'all' || options.source === 'claude') {
        data = withClaudeUsage(data, options.claudeHome);
    }

    if (options.source === 'all' || options.source === 'codex') {
        data = withCodexUsage(data, options.codexHome);
    }

    data.records.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    return data;
}