import { z } from 'zod';

import { DASHBOARD_PRESET } from '../utils/dashboard-config';

import { ColorLevelSchema } from './ColorLevel';
import { FlexModeSchema } from './FlexMode';
import { OverflowBehaviorSchema } from './OverflowBehavior';
import { PowerlineConfigSchema } from './PowerlineConfig';
import { WidgetItemSchema } from './Widget';

// Current version - bump this when making breaking changes to the schema
export const CURRENT_VERSION = 9;

// Schema for v1 settings (before version field was added)
export const SettingsSchema_v1 = z.object({
    lines: z.array(z.array(WidgetItemSchema)).optional(),
    flexMode: FlexModeSchema.optional(),
    compactThreshold: z.number().optional(),
    colorLevel: ColorLevelSchema.optional(),
    defaultSeparator: z.string().optional(),
    defaultPadding: z.string().optional(),
    inheritSeparatorColors: z.boolean().optional(),
    overrideBackgroundColor: z.string().optional(),
    overrideForegroundColor: z.string().optional(),
    globalBold: z.boolean().optional(),
    overflowBehavior: OverflowBehaviorSchema.optional()
});

// Main settings schema with defaults
export const SettingsSchema = z.object({
    version: z.number().default(CURRENT_VERSION),
    lines: z.array(z.array(WidgetItemSchema))
        .min(1)
        .default(DASHBOARD_PRESET),
    flexMode: FlexModeSchema.default('responsive-stable'),
    compactThreshold: z.number().min(1).max(99).default(60),
    fallbackTerminalWidth: z.number().int().positive().default(80),
    colorLevel: ColorLevelSchema.default(2),
    defaultSeparator: z.string().optional(),
    defaultPadding: z.string().optional(),
    inheritSeparatorColors: z.boolean().default(false),
    overrideBackgroundColor: z.string().optional(),
    overrideForegroundColor: z.string().optional(),
    globalBold: z.boolean().default(false),
    overflowBehavior: OverflowBehaviorSchema.default('wrap'),
    linePriority: z.array(z.number().int().min(1).max(3)).default([1, 2, 1, 1]),
    powerline: PowerlineConfigSchema.default({
        enabled: false,
        separators: ['\uE0B0'],
        separatorInvertBackground: [false],
        startCaps: [],
        endCaps: [],
        theme: undefined,
        autoAlign: false
    }),
    updatemessage: z.object({
        message: z.string().nullable().optional(),
        remaining: z.number().nullable().optional()
    }).optional()
});

// Inferred type from schema
export type Settings = z.infer<typeof SettingsSchema>;

// Export a default settings constant for reference
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({
    lines: DASHBOARD_PRESET,
    defaultSeparator: '·',
    defaultPadding: '',
    flexMode: 'responsive-stable',
    overflowBehavior: 'wrap'
});