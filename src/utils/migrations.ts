import type { WidgetItem } from '../types/Widget';

import {
    DASHBOARD_PRESET,
    LEGACY_DASHBOARD_PRESET
} from './dashboard-config';
import { generateGuid } from './guid';

// Type for migration functions
interface Migration {
    fromVersion: number;
    toVersion: number;
    description: string;
    migrate: (data: Record<string, unknown>) => Record<string, unknown>;
}

type V1MigratedField
    = | 'flexMode'
        | 'compactThreshold'
        | 'colorLevel'
        | 'defaultSeparator'
        | 'defaultPadding'
        | 'inheritSeparatorColors'
        | 'overrideBackgroundColor'
        | 'overrideForegroundColor'
        | 'globalBold';

interface V1FieldRule {
    key: V1MigratedField;
    isValid: (value: unknown) => boolean;
}

// Type guards for checking data structure
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const V1_FIELD_RULES: V1FieldRule[] = [
    {
        key: 'flexMode',
        isValid: value => typeof value === 'string'
    },
    {
        key: 'compactThreshold',
        isValid: value => typeof value === 'number'
    },
    {
        key: 'colorLevel',
        isValid: value => typeof value === 'number'
    },
    {
        key: 'defaultSeparator',
        isValid: value => typeof value === 'string'
    },
    {
        key: 'defaultPadding',
        isValid: value => typeof value === 'string'
    },
    {
        key: 'inheritSeparatorColors',
        isValid: value => typeof value === 'boolean'
    },
    {
        key: 'overrideBackgroundColor',
        isValid: value => typeof value === 'string'
    },
    {
        key: 'overrideForegroundColor',
        isValid: value => typeof value === 'string'
    },
    {
        key: 'globalBold',
        isValid: value => typeof value === 'boolean'
    }
];

function toWidgetLine(line: unknown[], stripSeparators: boolean): WidgetItem[] {
    const lineToProcess = stripSeparators
        ? line.filter((item) => {
            if (isRecord(item)) {
                return item.type !== 'separator';
            }
            return true;
        })
        : line;

    const typedLine: WidgetItem[] = [];
    for (const item of lineToProcess) {
        if (isRecord(item) && typeof item.type === 'string') {
            typedLine.push({
                ...item,
                id: generateGuid(),
                type: item.type
            } as WidgetItem);
        }
    }

    return typedLine;
}

function migrateV1Lines(data: Record<string, unknown>): WidgetItem[][] | undefined {
    if (!Array.isArray(data.lines)) {
        return undefined;
    }

    const stripSeparators = Boolean(data.defaultSeparator);
    const processedLines: WidgetItem[][] = [];

    for (const line of data.lines) {
        if (Array.isArray(line)) {
            processedLines.push(toWidgetLine(line, stripSeparators));
        }
    }

    return processedLines;
}

function copyV1Fields(data: Record<string, unknown>, target: Record<string, unknown>): void {
    for (const rule of V1_FIELD_RULES) {
        const value = data[rule.key];
        if (rule.isValid(value)) {
            target[rule.key] = value;
        }
    }
}

function normalizeWidgetForComparison(item: unknown): Record<string, unknown> | null {
    if (!isRecord(item) || typeof item.type !== 'string') {
        return null;
    }

    const normalized: Record<string, unknown> = { type: item.type };
    const copiedKeys = [
        'rawValue',
        'color',
        'backgroundColor',
        'bold',
        'character',
        'maxWidth',
        'preserveColors',
        'timeout',
        'merge'
    ] as const;

    for (const key of copiedKeys) {
        if (key in item) {
            normalized[key] = item[key];
        }
    }

    if (isRecord(item.metadata)) {
        normalized.metadata = Object.fromEntries(
            Object.entries(item.metadata).sort(([left], [right]) => left.localeCompare(right))
        );
    }

    return normalized;
}

function matchesPreset(lines: unknown[][], preset: WidgetItem[][]): boolean {
    if (lines.length !== preset.length) {
        return false;
    }

    for (const [lineIndex, presetLine] of preset.entries()) {
        const line = lines[lineIndex];
        if (!Array.isArray(line) || line.length !== presetLine.length) {
            return false;
        }

        for (let itemIndex = 0; itemIndex < presetLine.length; itemIndex++) {
            const actual = normalizeWidgetForComparison(line[itemIndex]);
            const expected = normalizeWidgetForComparison(presetLine[itemIndex]);
            if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                return false;
            }
        }
    }

    return true;
}

function clonePreset(preset: WidgetItem[][]): WidgetItem[][] {
    return preset.map(line => line.map(item => ({
        ...item,
        metadata: item.metadata ? { ...item.metadata } : undefined
    })));
}

// Define all migrations here
export const migrations: Migration[] = [
    {
        fromVersion: 1,
        toVersion: 2,
        description: 'Migrate from v1 to v2',
        migrate: (data) => {
            // Build a new v2 config from v1 data, only copying known fields
            const migrated: Record<string, unknown> = {};

            // Process lines: strip separators if needed and assign GUIDs
            const processedLines = migrateV1Lines(data);
            if (processedLines) {
                migrated.lines = processedLines;
            }

            // Copy all v1 fields that exist
            copyV1Fields(data, migrated);

            // Add version field for v2
            migrated.version = 2;

            // Add update message for v2 migration
            migrated.updatemessage = {
                message: 'ccstatusline updated to v2.0.0, launch tui to use new settings',
                remaining: 12
            };

            return migrated;
        }
    },
    {
        fromVersion: 2,
        toVersion: 3,
        description: 'Migrate from v2 to v3',
        migrate: (data) => {
            // Copy all existing data to v3
            const migrated: Record<string, unknown> = { ...data };

            // Update version to 3
            migrated.version = 3;

            // Add update message for v3 migration
            migrated.updatemessage = {
                message: 'ccstatusline updated to v2.0.2, 5hr block timer widget added',
                remaining: 12
            };

            return migrated;
        }
    },
    {
        fromVersion: 3,
        toVersion: 4,
        description: 'Migrate from v3 to v4 - add quota widgets and increase status-summary maxWidth',
        migrate: (data) => {
            const migrated: Record<string, unknown> = { ...data };

            // Process lines to inject quota widgets before status-summary
            if (Array.isArray(migrated.lines)) {
                const lines = migrated.lines as unknown[][];
                for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                    const line = lines[lineIdx];
                    if (!Array.isArray(line))
                        continue;

                    // Find status-summary widget in this line
                    const summaryIndex = line.findIndex((item) => {
                        if (isRecord(item)) {
                            return item.type === 'status-summary';
                        }
                        return false;
                    });

                    if (summaryIndex !== -1) {
                        // Update status-summary maxWidth from 40 to 60
                        const summaryItem = line[summaryIndex];
                        if (isRecord(summaryItem)) {
                            summaryItem.maxWidth = 60;
                        }

                        // Insert quota widgets + separators before status-summary
                        const quotaWidgets: WidgetItem[] = [
                            { id: generateGuid(), type: 'separator' },
                            { id: generateGuid(), type: 'session-usage', rawValue: true, color: 'brightBlue' },
                            { id: generateGuid(), type: 'separator' },
                            { id: generateGuid(), type: 'weekly-usage', rawValue: true, color: 'magenta' },
                            { id: generateGuid(), type: 'separator' }
                        ];
                        line.splice(summaryIndex, 0, ...quotaWidgets);
                        // Done with this line — quota widgets added
                        break;
                    }

                    // If this is the first line and no status-summary was found, append quota widgets
                    if (lineIdx === 0) {
                        const quotaWidgets: WidgetItem[] = [
                            { id: generateGuid(), type: 'separator' },
                            { id: generateGuid(), type: 'session-usage', rawValue: true, color: 'brightBlue' },
                            { id: generateGuid(), type: 'separator' },
                            { id: generateGuid(), type: 'weekly-usage', rawValue: true, color: 'magenta' },
                            { id: generateGuid(), type: 'separator' }
                        ];
                        line.push(...quotaWidgets);
                        break;
                    }
                }
            }

            migrated.version = 4;

            migrated.updatemessage = {
                message: 'ccstatusline updated - quota usage widgets added, wider status summary',
                remaining: 12
            };

            return migrated;
        }
    },
    {
        fromVersion: 4,
        toVersion: 5,
        description: 'Migrate from v4 to v5 - three-line layout with rich quota display',
        migrate: (data) => {
            const migrated: Record<string, unknown> = { ...data };

            if (Array.isArray(migrated.lines)) {
                const lines = migrated.lines as unknown[][];
                const targetTypes = new Set(['session-usage', 'weekly-usage', 'status-summary']);

                // Extract target widgets from all lines (preserve user customizations)
                let sessionUsageWidget: Record<string, unknown> | null = null;
                let weeklyUsageWidget: Record<string, unknown> | null = null;
                let statusSummaryWidget: Record<string, unknown> | null = null;

                for (const line of lines) {
                    if (!Array.isArray(line))
                        continue;
                    for (const item of line) {
                        if (!isRecord(item))
                            continue;
                        if (item.type === 'session-usage' && !sessionUsageWidget) {
                            sessionUsageWidget = { ...item };
                        } else if (item.type === 'weekly-usage' && !weeklyUsageWidget) {
                            weeklyUsageWidget = { ...item };
                        } else if (item.type === 'status-summary' && !statusSummaryWidget) {
                            statusSummaryWidget = { ...item };
                        }
                    }
                }

                // Remove target widgets from all lines and clean up separators
                for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                    const line = lines[lineIdx];
                    if (!Array.isArray(line))
                        continue;

                    // Filter out target widgets
                    const filtered = line.filter((item) => {
                        if (isRecord(item) && targetTypes.has(item.type as string))
                            return false;
                        return true;
                    });

                    // Clean up double separators
                    for (let i = filtered.length - 1; i > 0; i--) {
                        const curr = filtered[i];
                        const prev = filtered[i - 1];
                        if (isRecord(curr) && curr.type === 'separator'
                            && isRecord(prev) && prev.type === 'separator') {
                            filtered.splice(i, 1);
                        }
                    }

                    // Remove leading separators
                    while (filtered.length > 0) {
                        const first = filtered[0];
                        if (isRecord(first) && first.type === 'separator') {
                            filtered.shift();
                        } else {
                            break;
                        }
                    }

                    // Remove trailing separators
                    while (filtered.length > 0) {
                        const last = filtered[filtered.length - 1];
                        if (isRecord(last) && last.type === 'separator') {
                            filtered.pop();
                        } else {
                            break;
                        }
                    }

                    lines[lineIdx] = filtered;
                }

                // Build L2: session-usage + separator + weekly-usage
                const suId = sessionUsageWidget ? String(sessionUsageWidget.id) : generateGuid();
                const suColor = sessionUsageWidget ? String(sessionUsageWidget.color) : 'brightBlue';
                const sessionUsage: WidgetItem = {
                    id: suId,
                    type: 'session-usage',
                    color: suColor,
                    rawValue: false,
                    metadata: { display: 'progress-short', colorCoded: 'true', showReset: 'true' }
                };
                const wuId = weeklyUsageWidget ? String(weeklyUsageWidget.id) : generateGuid();
                const wuColor = weeklyUsageWidget ? String(weeklyUsageWidget.color) : 'magenta';
                const weeklyUsage: WidgetItem = {
                    id: wuId,
                    type: 'weekly-usage',
                    color: wuColor,
                    rawValue: false,
                    metadata: { display: 'progress-short', showReset: 'true' }
                };
                const line2: WidgetItem[] = [
                    sessionUsage,
                    { id: generateGuid(), type: 'separator' },
                    weeklyUsage
                ];

                // Build L3: current-working-dir + status-summary
                const cwdWidget: WidgetItem = {
                    id: generateGuid(),
                    type: 'current-working-dir',
                    rawValue: true,
                    color: 'blue',
                    metadata: { segments: '1' }
                };
                const ssId = statusSummaryWidget ? String(statusSummaryWidget.id) : generateGuid();
                const ssColor = statusSummaryWidget ? String(statusSummaryWidget.color) : 'white';
                const ssRawValue = statusSummaryWidget ? Boolean(statusSummaryWidget.rawValue) : true;
                const statusSummary: WidgetItem = {
                    id: ssId,
                    type: 'status-summary',
                    rawValue: ssRawValue,
                    color: ssColor,
                    maxWidth: 120,
                    metadata: { source: 'first-human' }
                };
                const line3: WidgetItem[] = [
                    cwdWidget,
                    { id: generateGuid(), type: 'separator' },
                    statusSummary
                ];

                // Enhance L1: inject output-style after model, set session-cost label
                const firstLine = (lines.find(line => Array.isArray(line) && line.length > 0) ?? []) as Record<string, unknown>[];

                // Add output-style after model if not already present
                const hasOutputStyle = firstLine.some(item => isRecord(item) && item.type === 'output-style');
                if (!hasOutputStyle) {
                    const modelIndex = firstLine.findIndex(item => isRecord(item) && item.type === 'model');
                    if (modelIndex !== -1) {
                        const outputStyleWidgets: WidgetItem[] = [
                            { id: generateGuid(), type: 'separator' },
                            { id: generateGuid(), type: 'output-style', rawValue: true, color: 'gray' }
                        ];
                        firstLine.splice(modelIndex + 1, 0, ...outputStyleWidgets);
                    }
                }

                // Set session-cost rawValue to false for label display
                for (const item of firstLine) {
                    if (isRecord(item) && item.type === 'session-cost') {
                        item.rawValue = false;
                    }
                }

                migrated.lines = [firstLine, line2, line3];
            }

            migrated.version = 5;
            migrated.updatemessage = {
                message: 'ccstatusline updated - three-line layout with rich quota display',
                remaining: 12
            };

            return migrated;
        }
    },
    {
        fromVersion: 5,
        toVersion: 6,
        description: 'Migrate from v5 to v6 - add L4 current step summary',
        migrate: (data) => {
            const migrated: Record<string, unknown> = { ...data };

            if (Array.isArray(migrated.lines)) {
                const lines = migrated.lines as unknown[][];

                // Fix existing widgets: session-cost label and status-summary source metadata
                for (const line of lines) {
                    if (!Array.isArray(line))
                        continue;
                    for (const item of line) {
                        if (!isRecord(item))
                            continue;
                        // Ensure session-cost shows "Spending:" label
                        if (item.type === 'session-cost') {
                            item.rawValue = false;
                        }
                        // Ensure existing status-summary gets first-human source if missing
                        if (item.type === 'status-summary' && !isRecord(item.metadata)) {
                            item.metadata = { source: 'first-human' };
                        }
                    }
                }

                // Append L4: session-overview status-summary
                lines.push([
                    { id: generateGuid(), type: 'status-summary', rawValue: true, color: 'gray', maxWidth: 120, metadata: { source: 'session-overview' } }
                ]);
                migrated.lines = lines;
            }

            migrated.version = 6;
            migrated.updatemessage = {
                message: 'ccstatusline updated - four-line layout with session goal + current step',
                remaining: 12
            };

            return migrated;
        }
    },
    {
        fromVersion: 6,
        toVersion: 7,
        description: 'Migrate from v6 to v7 - session dashboard defaults and wrap-aware overflow',
        migrate: (data) => {
            const migrated: Record<string, unknown> = { ...data };

            if (Array.isArray(migrated.lines)) {
                const lines = migrated.lines as unknown[][];
                if (matchesPreset(lines, LEGACY_DASHBOARD_PRESET)) {
                    migrated.lines = clonePreset(DASHBOARD_PRESET);
                    migrated.defaultSeparator = '·';
                    migrated.defaultPadding = '';
                    migrated.overflowBehavior = 'wrap';
                } else if (!('overflowBehavior' in migrated)) {
                    migrated.overflowBehavior = 'hide';
                }
            }

            migrated.version = 7;
            migrated.updatemessage = {
                message: 'ccdash updated - dashboard layout refreshed with responsive wrapping',
                remaining: 12
            };

            return migrated;
        }
    }
];

/**
 * Detect the version of the config data
 */
export function detectVersion(data: unknown): number {
    if (!isRecord(data))
        return 1;

    // If it has a version field, use it
    if (typeof data.version === 'number')
        return data.version;

    // No version field means it's the old v1 format
    return 1;
}

/**
 * Migrate config data from its current version to the target version
 */
export function migrateConfig(data: unknown, targetVersion: number): unknown {
    if (!isRecord(data))
        return data;

    let currentVersion = detectVersion(data);
    let migrated: Record<string, unknown> = { ...data };

    // Apply migrations sequentially
    while (currentVersion < targetVersion) {
        const migration = migrations.find(m => m.fromVersion === currentVersion);

        if (!migration)
            break;

        migrated = migration.migrate(migrated);
        currentVersion = migration.toVersion;
    }

    return migrated;
}

/**
 * Check if a migration is needed
 */
export function needsMigration(data: unknown, targetVersion: number): boolean {
    return detectVersion(data) < targetVersion;
}