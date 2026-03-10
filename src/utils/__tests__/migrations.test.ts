import {
    describe,
    expect,
    it
} from 'vitest';

import {
    DASHBOARD_PRESET,
    LEGACY_DASHBOARD_PRESET
} from '../dashboard-config';
import {
    detectVersion,
    migrateConfig,
    needsMigration
} from '../migrations';

describe('migrations', () => {
    it('detects version for unknown data and versioned objects', () => {
        expect(detectVersion(null)).toBe(1);
        expect(detectVersion('invalid')).toBe(1);
        expect(detectVersion({})).toBe(1);
        expect(detectVersion({ version: 2 })).toBe(2);
    });

    it('reports whether migration is needed', () => {
        expect(needsMigration({ version: 2 }, 3)).toBe(true);
        expect(needsMigration({ version: 3 }, 3)).toBe(false);
        expect(needsMigration({}, 3)).toBe(true);
    });

    it('returns original value for non-record migration input', () => {
        expect(migrateConfig('invalid', 3)).toBe('invalid');
        expect(migrateConfig(123, 3)).toBe(123);
    });

    it('migrates v1 to v2 by copying known fields and assigning ids', () => {
        const migrated = migrateConfig({
            lines: [[
                { type: 'model', color: 'cyan' },
                { type: 'separator' },
                { type: 'git-branch' }
            ]],
            flexMode: 'full',
            compactThreshold: 70,
            colorLevel: 3,
            defaultSeparator: '|',
            defaultPadding: ' ',
            inheritSeparatorColors: true,
            overrideBackgroundColor: 'black',
            overrideForegroundColor: 'white',
            globalBold: true,
            unknownField: 'ignored'
        }, 2) as Record<string, unknown>;

        expect(migrated.version).toBe(2);
        expect(migrated.flexMode).toBe('full');
        expect(migrated.compactThreshold).toBe(70);
        expect(migrated.colorLevel).toBe(3);
        expect(migrated.defaultSeparator).toBe('|');
        expect(migrated.defaultPadding).toBe(' ');
        expect(migrated.inheritSeparatorColors).toBe(true);
        expect(migrated.overrideBackgroundColor).toBe('black');
        expect(migrated.overrideForegroundColor).toBe('white');
        expect(migrated.globalBold).toBe(true);
        expect(migrated.unknownField).toBeUndefined();

        const lines = migrated.lines as Record<string, unknown>[][];
        const firstLine = lines[0];
        expect(Array.isArray(firstLine)).toBe(true);
        expect(firstLine?.map(item => item.type)).toEqual(['model', 'git-branch']);
        expect(typeof firstLine?.[0]?.id).toBe('string');
        expect(typeof firstLine?.[1]?.id).toBe('string');

        const updateMessage = migrated.updatemessage as { message?: string; remaining?: number };
        expect(updateMessage.message).toContain('v2.0.0');
        expect(updateMessage.remaining).toBe(12);
    });

    it('applies sequential migrations to reach target version', () => {
        const migrated = migrateConfig({
            lines: [[
                { type: 'model' }
            ]]
        }, 3) as Record<string, unknown>;

        expect(migrated.version).toBe(3);
        const updateMessage = migrated.updatemessage as { message?: string; remaining?: number };
        expect(updateMessage.message).toContain('v2.0.2');
        expect(updateMessage.remaining).toBe(12);
    });

    it('upgrades the legacy dashboard preset to the new wrap-aware dashboard', () => {
        const migrated = migrateConfig({
            version: 6,
            lines: LEGACY_DASHBOARD_PRESET.map(line => line.map(item => ({
                ...item,
                metadata: item.metadata ? { ...item.metadata } : undefined
            })))
        }, 7) as Record<string, unknown>;

        expect(migrated.version).toBe(7);
        expect(migrated.defaultSeparator).toBe('·');
        expect(migrated.defaultPadding).toBe('');
        expect(migrated.overflowBehavior).toBe('wrap');

        const lines = migrated.lines as Record<string, unknown>[][];
        expect(lines[2]?.[0]?.type).toBe('git-root-dir');
        expect(lines[2]?.[1]?.metadata).toEqual({ source: 'goal' });
        expect(lines[3]?.[0]?.metadata).toEqual({ source: 'last-conclusion' });
    });

    it('defaults missing overflow behavior to wrap for migrated custom layouts', () => {
        const migrated = migrateConfig({
            version: 6,
            lines: [[{ id: 'custom-1', type: 'custom-text', customText: 'hello' }]]
        }, 7) as Record<string, unknown>;

        expect(migrated.version).toBe(7);
        expect(migrated.overflowBehavior).toBe('wrap');
    });

    it('migrates the default dashboard from fixed reserve to responsive-stable', () => {
        const migrated = migrateConfig({
            version: 7,
            flexMode: 'full-minus-40',
            lines: DASHBOARD_PRESET.map(line => line.map(item => ({
                ...item,
                metadata: item.metadata ? { ...item.metadata } : undefined
            })))
        }, 8) as Record<string, unknown>;

        expect(migrated.version).toBe(8);
        expect(migrated.flexMode).toBe('responsive-stable');
        const updateMessage = migrated.updatemessage as { message?: string; remaining?: number };
        expect(updateMessage.message).toContain('stable terminal width tiers');
        expect(updateMessage.remaining).toBe(12);
    });

    it('preserves explicit legacy width modes on custom layouts', () => {
        const migrated = migrateConfig({
            version: 7,
            flexMode: 'full-minus-40',
            lines: [[{ id: 'custom-1', type: 'custom-text', customText: 'hello' }]]
        }, 8) as Record<string, unknown>;

        expect(migrated.version).toBe(8);
        expect(migrated.flexMode).toBe('full-minus-40');
    });
});