import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import {
    DEFAULT_SETTINGS,
    type Settings
} from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import {
    getVisibleText,
    getVisibleWidth
} from '../ansi';
import {
    calculateMaxWidthsFromPreRendered,
    getResponsiveTier,
    preRenderAllWidgets,
    renderStatusLine
} from '../renderer';
import * as terminalUtils from '../terminal';

function createSettings(overrides: Partial<Settings> = {}): Settings {
    return {
        ...DEFAULT_SETTINGS,
        defaultPadding: '',
        defaultSeparator: undefined,
        overflowBehavior: 'hide',
        ...overrides,
        powerline: {
            ...DEFAULT_SETTINGS.powerline,
            ...(overrides.powerline ?? {})
        }
    };
}

function renderLine(
    widgets: WidgetItem[],
    settingsOverrides: Partial<Settings>,
    contextOverrides: Partial<RenderContext> = {}
): string {
    const settings = createSettings(settingsOverrides);
    const context: RenderContext = {
        isPreview: false,
        terminalWidth: 50,
        ...contextOverrides
    };

    const preRenderedLines = preRenderAllWidgets([widgets], settings, context);
    const preCalculatedMaxWidths = calculateMaxWidthsFromPreRendered(preRenderedLines, settings);
    const preRenderedWidgets = preRenderedLines[0] ?? [];

    return renderStatusLine(widgets, settings, context, preRenderedWidgets, preCalculatedMaxWidths);
}

describe('renderer flex width behavior', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    const longTextWidget: WidgetItem = {
        id: 'text',
        type: 'custom-text',
        customText: 'abcdefghijklmnopqrstuvwxyz1234567890'
    };

    it('uses full-minus-40 width in normal mode', () => {
        const line = renderLine([longTextWidget], { flexMode: 'full-minus-40' });

        expect(getVisibleWidth(line)).toBe(10);
        expect(line.endsWith('...')).toBe(true);
    });

    it('uses full width in full-until-compact when under threshold', () => {
        const line = renderLine([longTextWidget], {
            flexMode: 'full-until-compact',
            compactThreshold: 60
        }, { data: { context_window: { used_percentage: 20 } } });

        expect(getVisibleWidth(line)).toBe(longTextWidget.customText?.length);
        expect(line.endsWith('...')).toBe(false);
    });

    it('uses compact width in full-until-compact when above threshold', () => {
        const line = renderLine([longTextWidget], {
            flexMode: 'full-until-compact',
            compactThreshold: 60
        }, { data: { context_window: { used_percentage: 80 } } });

        expect(getVisibleWidth(line)).toBe(10);
        expect(line.endsWith('...')).toBe(true);
    });

    it('uses the compact threshold in preview mode for full-until-compact', () => {
        const line = renderLine([longTextWidget], {
            flexMode: 'full-until-compact',
            compactThreshold: 60
        }, {
            isPreview: true,
            data: { context_window: { used_percentage: 99 } }
        });

        expect(getVisibleWidth(line)).toBe(10);
        expect(line.endsWith('...')).toBe(true);
    });

    it('uses stable responsive tiers based on the current terminal width', () => {
        const oversizedWidget: WidgetItem = {
            id: 'oversized',
            type: 'custom-text',
            customText: 'x'.repeat(220)
        };

        const narrowLine = renderLine([oversizedWidget], { flexMode: 'responsive-stable' }, { terminalWidth: 80 });
        const mediumLine = renderLine([oversizedWidget], { flexMode: 'responsive-stable' }, { terminalWidth: 120 });
        const wideLine = renderLine([oversizedWidget], { flexMode: 'responsive-stable' }, { terminalWidth: 200 });

        expect(getResponsiveTier(80)).toBe('narrow');
        expect(getResponsiveTier(120)).toBe('medium');
        expect(getResponsiveTier(200)).toBe('wide');
        expect(getVisibleWidth(narrowLine)).toBe(36);
        expect(getVisibleWidth(mediumLine)).toBe(78);
        expect(getVisibleWidth(wideLine)).toBe(150);
    });

    it('recomputes responsive-stable widths when the terminal grows again', () => {
        const oversizedWidget: WidgetItem = {
            id: 'oversized',
            type: 'custom-text',
            customText: 'x'.repeat(220)
        };

        const renderedWidths = [80, 120, 200, 120, 80].map(width => getVisibleWidth(renderLine(
            [oversizedWidget],
            { flexMode: 'responsive-stable' },
            { terminalWidth: width }
        )));

        expect(renderedWidths).toEqual([36, 78, 150, 78, 36]);
    });

    it('applies the same width behavior in powerline mode', () => {
        const line = renderLine([{
            ...longTextWidget,
            backgroundColor: 'bgBlue',
            color: 'white'
        }], {
            flexMode: 'full-minus-40',
            powerline: {
                ...DEFAULT_SETTINGS.powerline,
                enabled: true
            }
        });

        expect(getVisibleWidth(line)).toBe(10);
        expect(line.endsWith('...')).toBe(true);
    });

    it('wraps regular widgets instead of hiding them when overflowBehavior is wrap', () => {
        const line = renderLine([
            { id: 'session', type: 'custom-text', customText: 'Session: 23.0% · 0h16m left' },
            { id: 'weekly', type: 'custom-text', customText: 'Weekly: 23.0% · resets Thu 10pm' }
        ], {
            flexMode: 'full-minus-40',
            defaultSeparator: '·',
            defaultPadding: ' ',
            overflowBehavior: 'wrap'
        });

        const wrappedLines = line.split('\n');
        expect(wrappedLines.length).toBeGreaterThan(1);
        expect(getVisibleWidth(wrappedLines[0] ?? '')).toBeLessThanOrEqual(10);
        expect(wrappedLines.every(wrappedLine => getVisibleWidth(wrappedLine) <= 10)).toBe(true);
        expect(wrappedLines.some(wrappedLine => wrappedLine.includes('Sessio'))).toBe(true);
        expect(wrappedLines.some(wrappedLine => wrappedLine.includes('Weekly'))).toBe(true);
    });

    it('does not duplicate the default separator around manual separator widgets', () => {
        const line = renderLine([
            { id: 'left', type: 'custom-text', customText: 'Alpha' },
            { id: 'sep', type: 'separator' },
            { id: 'right', type: 'custom-text', customText: 'Beta' }
        ], { defaultSeparator: '·', flexMode: 'full' });

        expect(getVisibleText(line)).toBe('Alpha · Beta');
    });

    it('collapses adjacent manual separators when a widget between them is hidden', () => {
        const line = renderLine([
            { id: 'left', type: 'custom-text', customText: 'Alpha' },
            { id: 'sep-a', type: 'separator' },
            { id: 'style', type: 'output-style', metadata: { hideWhenDefault: 'true' } },
            { id: 'sep-b', type: 'separator' },
            { id: 'right', type: 'custom-text', customText: 'Beta' }
        ], { flexMode: 'full', defaultSeparator: undefined }, { data: { output_style: { name: 'default' } } });

        expect(getVisibleText(line)).toBe('Alpha | Beta');
    });

    it('uses fallback terminal width when hook width is unreliable', () => {
        vi.spyOn(terminalUtils, 'getTerminalWidth').mockReturnValue(84);

        const line = renderLine([longTextWidget], {
            flexMode: 'full-minus-40',
            fallbackTerminalWidth: 84
        }, { terminalWidth: undefined });

        expect(getVisibleWidth(line)).toBe(longTextWidget.customText?.length);
        expect(line.endsWith('...')).toBe(false);
    });

    it('produces stable wrap points at common hook widths', () => {
        const widgets: WidgetItem[] = [
            { id: 'session', type: 'custom-text', customText: 'Session: [██░░░░░░░░░░░░░░] 15.0% · 1h44m left' },
            { id: 'weekly', type: 'custom-text', customText: 'Weekly: [████░░░░░░░░░░░░] 26.0% · resets Thu 10pm' }
        ];
        const settingsOverrides: Partial<Settings> = {
            flexMode: 'full-minus-40',
            defaultSeparator: '·',
            defaultPadding: '',
            overflowBehavior: 'wrap'
        };

        const widths = [80, 100, 120, 140];
        const lineCounts = widths.map(width => renderLine(widgets, settingsOverrides, { terminalWidth: width }).split('\n').length);

        expect(lineCounts).toEqual([4, 2, 2, 1]);
    });

    it('wraps a single oversized widget within the available width', () => {
        const line = renderLine([
            {
                id: 'summary',
                type: 'custom-text',
                customText: 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda'
            }
        ], {
            flexMode: 'full-minus-40',
            overflowBehavior: 'wrap'
        }, { terminalWidth: 80 });

        const wrappedLines = line.split('\n');
        expect(wrappedLines.length).toBeGreaterThan(1);
        expect(wrappedLines.every(wrappedLine => getVisibleWidth(wrappedLine) <= 40)).toBe(true);
        expect(getVisibleText(wrappedLines.join(' '))).toContain('alpha beta gamma');
        expect(getVisibleText(wrappedLines.join(' '))).toContain('iota kappa lambda');
    });

    it('wraps mixed CJK and ASCII text by visible width', () => {
        const line = renderLine([
            {
                id: 'summary',
                type: 'custom-text',
                customText: '最新发布状态还没确认 complete npm publish and GitHub release before announcing success'
            }
        ], {
            flexMode: 'full-minus-40',
            overflowBehavior: 'wrap'
        }, { terminalWidth: 70 });

        const wrappedLines = line.split('\n');
        expect(wrappedLines.length).toBeGreaterThan(1);
        expect(wrappedLines.every(wrappedLine => getVisibleWidth(wrappedLine) <= 30)).toBe(true);
    });

    it('wraps long widgets with responsive-stable reserve widths', () => {
        const line = renderLine([
            {
                id: 'summary',
                type: 'custom-text',
                customText: 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron'
            }
        ], {
            flexMode: 'responsive-stable',
            overflowBehavior: 'wrap'
        }, { terminalWidth: 80 });

        const wrappedLines = line.split('\n');
        expect(wrappedLines.length).toBeGreaterThan(1);
        expect(wrappedLines.every(wrappedLine => getVisibleWidth(wrappedLine) <= 36)).toBe(true);
    });

    it('does not repeat separators or padding on wrapped continuation lines', () => {
        const line = renderLine([
            { id: 'project', type: 'custom-text', customText: 'ccdash' },
            { id: 'goal', type: 'status-summary', rawValue: false, metadata: { source: 'goal' } }
        ], {
            flexMode: 'full-minus-40',
            defaultSeparator: '·',
            defaultPadding: ' ',
            overflowBehavior: 'wrap'
        }, {
            terminalWidth: 60,
            dashboardState: {
                goalSummary: 'Make the install and uninstall hints much more obvious before publishing the release',
                lastConclusion: null
            }
        });

        const wrappedLines = line.split('\n').map(getVisibleText);
        expect(wrappedLines.length).toBeGreaterThan(1);
        expect(wrappedLines.slice(1).every(wrappedLine => !wrappedLine.startsWith('·') && !wrappedLine.startsWith(' '))).toBe(true);
    });

    it('clamps the update message helper line to two wrapped lines', () => {
        const line = renderLine([
            {
                id: 'updatemessage',
                type: 'custom-text',
                customText: 'Update available right now. Run brew upgrade claude-code and restart your shell before continuing with the release workflow.'
            }
        ], {
            flexMode: 'responsive-stable',
            overflowBehavior: 'wrap'
        }, { terminalWidth: 80 });

        const wrappedLines = line.split('\n');
        expect(wrappedLines.length).toBe(2);
        expect(wrappedLines.every(wrappedLine => getVisibleWidth(wrappedLine) <= 36)).toBe(true);
        expect(wrappedLines[1]).toContain('...');
    });

    it('clamps goal-style status summaries to two wrapped lines', () => {
        const line = renderLine([
            { id: 'goal', type: 'status-summary', rawValue: false, metadata: { source: 'goal' } }
        ], {
            flexMode: 'full-minus-40',
            overflowBehavior: 'wrap'
        }, {
            terminalWidth: 80,
            dashboardState: {
                goalSummary: 'Ship the install UX refresh, publish to npm, push the GitHub release, and verify the messaging is obvious in both narrow and wide terminals for bilingual prompts',
                lastConclusion: null
            }
        });

        const wrappedLines = line.split('\n');
        expect(wrappedLines).toHaveLength(2);
        expect(getVisibleWidth(wrappedLines[0] ?? '')).toBeLessThanOrEqual(40);
        expect(getVisibleWidth(wrappedLines[1] ?? '')).toBeLessThanOrEqual(40);
        expect((wrappedLines[1] ?? '').endsWith('...')).toBe(true);
    });
});