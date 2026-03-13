import { UsageCacheStore } from './cache';
import { withClaudeUsage } from './sources/claude';
import { withCodexUsage } from './sources/codex';
import { withOpenClawUsage } from './sources/openclaw';
import type {
    ClaudeUsageOptions,
    ParsedUsageData,
    SourceSelection
} from './types';

interface LoadUsageOptions {
    claudeHome?: string;
    codexHome?: string;
    openclawHome?: string;
    mainThreadOnly?: boolean;
    source: SourceSelection;
}

export function loadUsageData(options: LoadUsageOptions): ParsedUsageData {
    const cache = new UsageCacheStore();
    let data: ParsedUsageData = {
        selectedSource: options.source,
        records: [],
        sources: {}
    };

    if (options.source === 'all' || options.source === 'claude') {
        const claudeOptions: ClaudeUsageOptions = {
            mainThreadOnly: options.mainThreadOnly
        };
        data = withClaudeUsage(data, options.claudeHome, cache, claudeOptions);
    }

    if (options.source === 'all' || options.source === 'codex') {
        data = withCodexUsage(data, options.codexHome, cache);
    }

    if (options.source === 'all' || options.source === 'openclaw') {
        data = withOpenClawUsage(data, options.openclawHome, cache);
    }

    data.records.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    cache.save();
    return data;
}
