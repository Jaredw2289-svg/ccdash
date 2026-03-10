import chalk from 'chalk';

import type {
    RenderContext,
    ResponsiveTier,
    WidgetItem
} from '../types';
import { getColorLevelString } from '../types/ColorLevel';
import type { Settings } from '../types/Settings';

import {
    getVisibleWidth,
    stripSgrCodes,
    trimStyledWhitespace,
    truncateStyledText,
    wrapStyledText
} from './ansi';
import {
    applyColors,
    bgToFg,
    getColorAnsiCode,
    getPowerlineTheme
} from './colors';
import { calculateContextPercentage } from './context-percentage';
import { getTerminalWidth } from './terminal';
import { getWidget } from './widgets';

export const TERMINAL_WIDTH_BASE_RESERVE = 6;
export const TERMINAL_WIDTH_COMPACT_RESERVE = 40;
export const RESPONSIVE_TIER_NARROW_MAX_WIDTH = 100;
export const RESPONSIVE_TIER_MEDIUM_MAX_WIDTH = 160;

const RESPONSIVE_TIER_RESERVE_RATIO: Record<ResponsiveTier, number> = {
    narrow: 0.55,
    medium: 0.35,
    wide: 0.25
};

// Helper function to format token counts
export function formatTokens(count: number): string {
    if (count >= 1000000)
        return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000)
        return `${(count / 1000).toFixed(1)}k`;
    return count.toString();
}

interface ResolvedTerminalWidths {
    baseWidth: number | null;
    effectiveWidth: number | null;
    responsiveTier?: ResponsiveTier;
}

function clampTerminalWidth(width: number): number {
    return Math.max(1, width);
}

export function getResponsiveTier(baseWidth: number): ResponsiveTier {
    if (baseWidth <= RESPONSIVE_TIER_NARROW_MAX_WIDTH) {
        return 'narrow';
    }

    if (baseWidth <= RESPONSIVE_TIER_MEDIUM_MAX_WIDTH) {
        return 'medium';
    }

    return 'wide';
}

function getResponsiveReserveWidth(baseWidth: number, responsiveTier: ResponsiveTier): number {
    return Math.max(1, Math.ceil(baseWidth * RESPONSIVE_TIER_RESERVE_RATIO[responsiveTier]));
}

function resolveTerminalWidths(
    settings: Settings,
    context: RenderContext
): ResolvedTerminalWidths {
    const baseWidth = context.terminalWidth ?? getTerminalWidth('statusline', settings.fallbackTerminalWidth);

    const flexMode = settings.flexMode as string;
    if (!baseWidth) {
        return {
            baseWidth: null,
            effectiveWidth: null
        };
    }

    let effectiveWidth = baseWidth;
    let responsiveTier: ResponsiveTier | undefined;
    if (flexMode === 'full') {
        effectiveWidth = baseWidth - TERMINAL_WIDTH_BASE_RESERVE;
    } else if (flexMode === 'full-minus-40') {
        effectiveWidth = baseWidth - TERMINAL_WIDTH_COMPACT_RESERVE;
    } else if (flexMode === 'full-until-compact') {
        const threshold = settings.compactThreshold;
        const contextPercentage = calculateContextPercentage(context);
        effectiveWidth = contextPercentage >= threshold
            ? baseWidth - TERMINAL_WIDTH_COMPACT_RESERVE
            : baseWidth - TERMINAL_WIDTH_BASE_RESERVE;
    } else if (flexMode === 'responsive-stable') {
        responsiveTier = getResponsiveTier(baseWidth);
        effectiveWidth = baseWidth - getResponsiveReserveWidth(baseWidth, responsiveTier);
    }

    return {
        baseWidth,
        effectiveWidth: clampTerminalWidth(effectiveWidth),
        responsiveTier
    };
}

export function normalizeRenderContext(
    settings: Settings,
    context: RenderContext
): RenderContext {
    const { baseWidth, responsiveTier } = resolveTerminalWidths(settings, context);

    if (baseWidth === null && responsiveTier === context.responsiveTier) {
        return context;
    }

    if (baseWidth === context.terminalWidth && responsiveTier === context.responsiveTier) {
        return context;
    }

    return {
        ...context,
        terminalWidth: baseWidth ?? context.terminalWidth,
        responsiveTier
    };
}

function renderPowerlineStatusLine(
    widgets: WidgetItem[],
    settings: Settings,
    context: RenderContext,
    lineIndex = 0,  // Which line we're rendering (for theme color cycling)
    globalSeparatorOffset = 0,  // Starting separator index for this line
    preRenderedWidgets: PreRenderedWidget[],  // Pre-rendered widgets for this line
    preCalculatedMaxWidths: number[]  // Pre-calculated max widths for alignment
): string {
    const powerlineConfig = settings.powerline as Record<string, unknown> | undefined;
    const config = powerlineConfig ?? {};

    // Get separator configuration
    const separators = (config.separators as string[] | undefined) ?? ['\uE0B0'];
    const invertBgs = (config.separatorInvertBackground as boolean[] | undefined) ?? separators.map(() => false);

    // Get caps arrays or fallback to empty arrays
    const startCaps = (config.startCaps as string[] | undefined) ?? [];
    const endCaps = (config.endCaps as string[] | undefined) ?? [];

    // Get the cap for this line (cycle through if more lines than caps)
    const capLineIndex = context.lineIndex ?? lineIndex;
    const startCap = startCaps.length > 0 ? startCaps[capLineIndex % startCaps.length] : '';
    const endCap = endCaps.length > 0 ? endCaps[capLineIndex % endCaps.length] : '';

    // Get theme colors if a theme is set and not 'custom'
    const themeName = config.theme as string | undefined;
    let themeColors: { fg: string[]; bg: string[] } | undefined;

    if (themeName && themeName !== 'custom') {
        const theme = getPowerlineTheme(themeName);
        if (theme) {
            const colorLevel = getColorLevelString((settings.colorLevel as number) as (0 | 1 | 2 | 3));
            const colorLevelKey = colorLevel === 'ansi16' ? '1' : colorLevel === 'ansi256' ? '2' : '3';
            themeColors = theme[colorLevelKey];
        }
    }

    // Get color level from settings
    const colorLevel = getColorLevelString((settings.colorLevel as number) as (0 | 1 | 2 | 3));

    // Filter out separator and flex-separator widgets in powerline mode
    const filteredWidgets = widgets.filter(widget => widget.type !== 'separator' && widget.type !== 'flex-separator'
    );

    if (filteredWidgets.length === 0)
        return '';

    const { effectiveWidth: terminalWidth } = resolveTerminalWidths(settings, context);

    // Build widget elements (similar to regular mode but without separators)
    const widgetElements: { content: string; bgColor?: string; fgColor?: string; widget: WidgetItem }[] = [];
    let widgetColorIndex = 0;  // Track widget index for theme colors

    // Create a mapping from filteredWidgets to preRenderedWidgets indices
    // This is needed because filteredWidgets excludes separators but preRenderedWidgets includes all widgets
    const preRenderedIndices: number[] = [];
    for (let i = 0; i < widgets.length; i++) {
        const widget = widgets[i];
        if (widget && widget.type !== 'separator' && widget.type !== 'flex-separator') {
            preRenderedIndices.push(i);
        }
    }

    for (let i = 0; i < filteredWidgets.length; i++) {
        const widget = filteredWidgets[i];
        if (!widget)
            continue;
        let widgetText = '';
        let defaultColor = 'white';

        // Handle separators specially (they're not widgets)
        if (widget.type === 'separator' || widget.type === 'flex-separator') {
            // These are filtered out in powerline mode
            continue;
        }

        // Use pre-rendered content - use the correct index from the mapping
        const actualPreRenderedIndex = preRenderedIndices[i];
        const preRendered = actualPreRenderedIndex !== undefined ? preRenderedWidgets[actualPreRenderedIndex] : undefined;
        if (preRendered?.content) {
            widgetText = preRendered.content;
            // Get default color from widget impl for consistency
            const widgetImpl = getWidget(widget.type);
            if (widgetImpl) {
                defaultColor = widgetImpl.getDefaultColor();
            }
        }

        if (widgetText) {
            // Apply default padding from settings
            const padding = settings.defaultPadding ?? '';

            // If override FG color is set and this is a custom command with preserveColors,
            // we need to strip the ANSI codes from the widget text
            if (settings.overrideForegroundColor && settings.overrideForegroundColor !== 'none'
                && widget.type === 'custom-command' && widget.preserveColors) {
                // Strip ANSI color codes when override is active
                widgetText = stripSgrCodes(widgetText);
            }

            // Check if padding should be omitted due to no-padding merge
            const prevItem = i > 0 ? filteredWidgets[i - 1] : null;
            const nextItem = i < filteredWidgets.length - 1 ? filteredWidgets[i + 1] : null;
            const omitLeadingPadding = prevItem?.merge === 'no-padding';
            const omitTrailingPadding = widget.merge === 'no-padding' && nextItem;

            const leadingPadding = omitLeadingPadding ? '' : padding;
            const trailingPadding = omitTrailingPadding ? '' : padding;
            const paddedText = `${leadingPadding}${widgetText}${trailingPadding}`;

            // Determine colors
            let fgColor = widget.color ?? defaultColor;
            let bgColor = widget.backgroundColor;

            // Apply theme colors if a theme is set (and not 'custom')
            // For custom commands with preserveColors, only skip foreground theme colors
            const skipFgTheme = widget.type === 'custom-command' && widget.preserveColors;

            if (themeColors) {
                if (!skipFgTheme) {
                    fgColor = themeColors.fg[widgetColorIndex % themeColors.fg.length] ?? fgColor;
                }
                bgColor = themeColors.bg[widgetColorIndex % themeColors.bg.length] ?? bgColor;

                // Only increment color index if this widget is not merged with the next one
                // This ensures merged widgets share the same color
                if (!widget.merge) {
                    widgetColorIndex++;
                }
            }

            // Apply override FG color if set (overrides theme)
            if (settings.overrideForegroundColor && settings.overrideForegroundColor !== 'none') {
                fgColor = settings.overrideForegroundColor;
            }

            widgetElements.push({
                content: paddedText,
                bgColor: bgColor ?? undefined,  // Make sure undefined, not empty string
                fgColor: fgColor,
                widget: widget
            });
        }
    }

    if (widgetElements.length === 0)
        return '';

    // Apply auto-alignment if enabled
    const autoAlign = config.autoAlign as boolean | undefined;
    if (autoAlign) {
        // Apply padding to current line's widgets based on pre-calculated max widths
        let alignmentPos = 0;
        for (let i = 0; i < widgetElements.length; i++) {
            const element = widgetElements[i];
            if (!element)
                continue;

            // Check if previous widget was merged with this one
            const prevWidget = i > 0 ? widgetElements[i - 1] : null;
            const isPreviousMerged = prevWidget?.widget.merge;

            // Only apply alignment to non-merged widgets (widgets that follow a merge are excluded)
            if (!isPreviousMerged) {
                const maxWidth = preCalculatedMaxWidths[alignmentPos];
                if (maxWidth !== undefined) {
                    // Calculate combined width if this widget merges with following ones
                    let combinedLength = getVisibleWidth(element.content);
                    let j = i;
                    while (j < widgetElements.length - 1 && widgetElements[j]?.widget.merge) {
                        j++;
                        const nextElement = widgetElements[j];
                        if (nextElement) {
                            combinedLength += getVisibleWidth(nextElement.content);
                        }
                    }

                    const paddingNeeded = maxWidth - combinedLength;
                    if (paddingNeeded > 0) {
                        // Add padding to the last widget in the merge group
                        const lastElement = widgetElements[j];
                        if (lastElement) {
                            lastElement.content += ' '.repeat(paddingNeeded);
                        }
                    }

                    // Skip over merged widgets
                    i = j;
                }
                alignmentPos++;
            }
        }
    }

    // Responsive widget hiding for powerline mode
    if (terminalWidth && terminalWidth > 0) {
        // Estimate total width and progressively remove rightmost widgets
        let totalWidth = widgetElements.reduce((sum, elem) => sum + getVisibleWidth(elem.content), 0);
        // Add separator width estimates
        const separatorCount = Math.max(0, widgetElements.length - 1);
        totalWidth += separatorCount * getVisibleWidth(separators[0] ?? '');
        // Add caps width
        totalWidth += getVisibleWidth(startCap ?? '') + getVisibleWidth(endCap ?? '');

        while (widgetElements.length > 1 && totalWidth > terminalWidth) {
            const removed = widgetElements.pop();
            if (removed) {
                totalWidth -= getVisibleWidth(removed.content) + 1; // +1 for separator
            }
        }
    }

    // Build the final powerline string
    let result = '';

    // Add start cap if specified
    if (startCap && widgetElements.length > 0) {
        const firstWidget = widgetElements[0];
        if (firstWidget?.bgColor) {
            // Start cap uses first widget's background as foreground (converted)
            const capFg = bgToFg(firstWidget.bgColor);
            const fgCode = getColorAnsiCode(capFg, colorLevel, false);
            result += fgCode + startCap + '\x1b[39m';
        } else {
            result += startCap;
        }
    }

    // Render widgets with powerline separators
    for (let i = 0; i < widgetElements.length; i++) {
        const widget = widgetElements[i];
        const nextWidget = widgetElements[i + 1];

        if (!widget)
            continue;

        // Apply colors to widget content using raw ANSI codes for powerline mode
        // This avoids reset codes that interfere with separator rendering
        const shouldBold = (settings.globalBold) || widget.widget.bold;

        // Check if we need a separator after this widget
        const needsSeparator = i < widgetElements.length - 1 && separators.length > 0 && nextWidget && !widget.widget.merge;

        let widgetContent = '';

        // For custom commands with preserveColors, only skip foreground color/bold
        const isPreserveColors = widget.widget.type === 'custom-command' && widget.widget.preserveColors;

        if (shouldBold && !isPreserveColors) {
            widgetContent += '\x1b[1m';
        }
        if (widget.fgColor && !isPreserveColors) {
            widgetContent += getColorAnsiCode(widget.fgColor, colorLevel, false);
        }
        // Always apply background for consistency in powerline mode
        if (widget.bgColor) {
            widgetContent += getColorAnsiCode(widget.bgColor, colorLevel, true);
        }
        widgetContent += widget.content;
        // Reset colors after content
        // For custom commands with preserveColors, also reset text attributes like dim
        if (isPreserveColors) {
            // Full reset to clear any attributes from command (including dim from Claude Code)
            widgetContent += '\x1b[0m';
        } else {
            widgetContent += '\x1b[49m\x1b[39m';
            // Only reset bold if there's no separator following AND no end cap
            const isLastWidget = i === widgetElements.length - 1;
            const hasEndCap = endCaps.length > 0 && endCaps[capLineIndex % endCaps.length];
            if (shouldBold && !needsSeparator && !(isLastWidget && hasEndCap)) {
                widgetContent += '\x1b[22m';
            }
        }

        result += widgetContent;

        // Add separator between widgets (not after last one, and not if current widget is merged with next)
        if (needsSeparator) {
            // Determine which separator to use based on global position
            // Use separators in order, using the last one for all remaining positions
            const globalIndex = globalSeparatorOffset + i;
            const separatorIndex = Math.min(globalIndex, separators.length - 1);
            const separator = separators[separatorIndex] ?? '\uE0B0';
            const shouldInvert = invertBgs[separatorIndex] ?? false;

            // Powerline separator coloring:
            // Normal (not inverted):
            //   - Foreground: previous widget's background color (converted to fg)
            //   - Background: next widget's background color
            // Inverted:
            //   - Foreground: next widget's background color (converted to fg)
            //   - Background: previous widget's background color

            // Build separator with raw ANSI codes to avoid reset issues
            let separatorOutput = '';

            // Check if adjacent widgets have the same background color
            const sameBackground = widget.bgColor && nextWidget.bgColor && widget.bgColor === nextWidget.bgColor;

            if (shouldInvert) {
                // Inverted: swap fg/bg logic
                if (widget.bgColor && nextWidget.bgColor) {
                    if (sameBackground) {
                        // Same background: use next widget's foreground color
                        const fgColor = nextWidget.fgColor;
                        const fgCode = getColorAnsiCode(fgColor, colorLevel, false);
                        const bgCode = getColorAnsiCode(widget.bgColor, colorLevel, true);
                        separatorOutput = fgCode + bgCode + separator + '\x1b[39m\x1b[49m';
                    } else {
                        // Different backgrounds: use standard inverted logic
                        const fgColor = bgToFg(nextWidget.bgColor);
                        const fgCode = getColorAnsiCode(fgColor, colorLevel, false);
                        const bgCode = getColorAnsiCode(widget.bgColor, colorLevel, true);
                        separatorOutput = fgCode + bgCode + separator + '\x1b[39m\x1b[49m';
                    }
                } else if (widget.bgColor && !nextWidget.bgColor) {
                    const fgColor = bgToFg(widget.bgColor);
                    const fgCode = getColorAnsiCode(fgColor, colorLevel, false);
                    separatorOutput = fgCode + separator + '\x1b[39m';
                } else if (!widget.bgColor && nextWidget.bgColor) {
                    const fgColor = bgToFg(nextWidget.bgColor);
                    const fgCode = getColorAnsiCode(fgColor, colorLevel, false);
                    separatorOutput = fgCode + separator + '\x1b[39m';
                } else {
                    separatorOutput = separator;
                }
            } else {
                // Normal (not inverted)
                if (widget.bgColor && nextWidget.bgColor) {
                    if (sameBackground) {
                        // Same background: use previous widget's foreground color
                        const fgColor = widget.fgColor;
                        const fgCode = getColorAnsiCode(fgColor, colorLevel, false);
                        const bgCode = getColorAnsiCode(nextWidget.bgColor, colorLevel, true);
                        separatorOutput = fgCode + bgCode + separator + '\x1b[39m\x1b[49m';
                    } else {
                        // Different backgrounds: use standard logic
                        const fgColor = bgToFg(widget.bgColor);
                        const fgCode = getColorAnsiCode(fgColor, colorLevel, false);
                        const bgCode = getColorAnsiCode(nextWidget.bgColor, colorLevel, true);
                        separatorOutput = fgCode + bgCode + separator + '\x1b[39m\x1b[49m';
                    }
                } else if (widget.bgColor && !nextWidget.bgColor) {
                    // Only previous widget has background
                    const fgColor = bgToFg(widget.bgColor);
                    const fgCode = getColorAnsiCode(fgColor, colorLevel, false);
                    separatorOutput = fgCode + separator + '\x1b[39m';
                } else if (!widget.bgColor && nextWidget.bgColor) {
                    // Only next widget has background
                    const fgColor = bgToFg(nextWidget.bgColor);
                    const fgCode = getColorAnsiCode(fgColor, colorLevel, false);
                    separatorOutput = fgCode + separator + '\x1b[39m';
                } else {
                    // Neither has background
                    separatorOutput = separator;
                }
            }

            result += separatorOutput;

            // Reset bold after separator if it was set
            if (shouldBold) {
                result += '\x1b[22m';
            }
        }
    }

    // Add end cap if specified
    if (endCap && widgetElements.length > 0) {
        const lastWidget = widgetElements[widgetElements.length - 1];

        if (lastWidget?.bgColor) {
            // End cap uses last widget's background as foreground (converted)
            const capFg = bgToFg(lastWidget.bgColor);
            const fgCode = getColorAnsiCode(capFg, colorLevel, false);
            result += fgCode + endCap + '\x1b[39m';
        } else {
            result += endCap;
        }

        // Reset bold after end cap if needed
        const lastWidgetBold = (settings.globalBold) || lastWidget?.widget.bold;
        if (lastWidgetBold) {
            result += '\x1b[22m';
        }
    }

    // Reset colors at the end
    result += chalk.reset('');

    // Handle truncation if terminal width is known
    if (terminalWidth && terminalWidth > 0) {
        const plainLength = getVisibleWidth(result);
        if (plainLength > terminalWidth) {
            result = truncateStyledText(result, terminalWidth, { ellipsis: true });
        }
    }

    return result;
}

// Format separator with appropriate spacing
function formatSeparator(sep: string): string {
    if (sep === '|') {
        return ' | ';
    } else if (sep === '·') {
        return ' · ';
    } else if (sep === ' ') {
        return ' ';
    } else if (sep === ',') {
        return ', ';
    } else if (sep === '-') {
        return ' - ';
    }
    return sep;
}

export interface RenderResult {
    line: string;
    wasTruncated: boolean;
}

interface RenderToken {
    content: string;
    type: 'content' | 'separator' | 'flex-separator' | 'line-break';
    widget?: WidgetItem;
}

export interface PreRenderedWidget {
    content: string;      // The rendered widget text (without padding)
    plainLength: number;  // Length without ANSI codes
    widget: WidgetItem;   // Original widget config
}

// Pre-render all widgets once and cache the results
export function preRenderAllWidgets(
    allLinesWidgets: WidgetItem[][],
    settings: Settings,
    context: RenderContext
): PreRenderedWidget[][] {
    const renderContext = normalizeRenderContext(settings, context);
    const preRenderedLines: PreRenderedWidget[][] = [];

    // Process each line
    for (const lineWidgets of allLinesWidgets) {
        const preRenderedLine: PreRenderedWidget[] = [];

        for (const widget of lineWidgets) {
            // Skip separators as they're handled differently
            if (widget.type === 'separator' || widget.type === 'flex-separator') {
                preRenderedLine.push({
                    content: '',  // Separators are handled specially
                    plainLength: 0,
                    widget
                });
                continue;
            }

            const widgetImpl = getWidget(widget.type);
            if (!widgetImpl) {
                // Unknown widget type - skip it entirely
                continue;
            }

            const widgetText = widgetImpl.render(widget, renderContext, settings) ?? '';

            // Store the rendered content without padding (padding is applied later)
            // Use stringWidth to properly calculate Unicode character display width
            const plainLength = getVisibleWidth(widgetText);
            preRenderedLine.push({
                content: widgetText,
                plainLength,
                widget
            });
        }

        preRenderedLines.push(preRenderedLine);
    }

    return preRenderedLines;
}

// Calculate max widths from pre-rendered widgets for alignment
export function calculateMaxWidthsFromPreRendered(
    preRenderedLines: PreRenderedWidget[][],
    settings: Settings
): number[] {
    const maxWidths: number[] = [];
    const defaultPadding = settings.defaultPadding ?? '';
    const paddingLength = defaultPadding.length;

    for (const preRenderedLine of preRenderedLines) {
        const filteredWidgets = preRenderedLine.filter(
            w => w.widget.type !== 'separator' && w.widget.type !== 'flex-separator' && w.content
        );

        let alignmentPos = 0;
        for (let i = 0; i < filteredWidgets.length; i++) {
            const widget = filteredWidgets[i];
            if (!widget)
                continue;

            // Calculate the total width for this alignment position
            // If this widget is merged with the next, accumulate their widths
            let totalWidth = widget.plainLength + (paddingLength * 2);

            // Check if this widget merges with the next one(s)
            let j = i;
            while (j < filteredWidgets.length - 1 && filteredWidgets[j]?.widget.merge) {
                j++;
                const nextWidget = filteredWidgets[j];
                if (nextWidget) {
                    // For merged widgets, add width but account for padding adjustments
                    // When merging with 'no-padding', don't count padding between widgets
                    if (filteredWidgets[j - 1]?.widget.merge === 'no-padding') {
                        totalWidth += nextWidget.plainLength;
                    } else {
                        totalWidth += nextWidget.plainLength + (paddingLength * 2);
                    }
                }
            }

            const currentMax = maxWidths[alignmentPos];
            if (currentMax === undefined) {
                maxWidths[alignmentPos] = totalWidth;
            } else {
                maxWidths[alignmentPos] = Math.max(currentMax, totalWidth);
            }

            // Skip over merged widgets since we've already processed them
            i = j;
            alignmentPos++;
        }
    }

    return maxWidths;
}

// Progressively remove rightmost non-essential widgets until the line fits
function filterWidgetsToFit(
    elements: { content: string; type: string; widget?: WidgetItem }[],
    maxWidth: number,
    paddingWidth = 0
): { content: string; type: string; widget?: WidgetItem }[] {
    const filtered = [...elements];

    while (filtered.length > 1) {
        // Calculate total visible width including padding per non-separator element
        const totalWidth = filtered.reduce((sum, elem) => {
            if (elem.type === 'flex-separator') {
                return sum; // Flex separators compress naturally
            }
            const contentWidth = getVisibleWidth(elem.content);
            const padding = (elem.type !== 'separator') ? paddingWidth * 2 : 0;
            return sum + contentWidth + padding;
        }, 0);

        if (totalWidth <= maxWidth) {
            return filtered;
        }

        // Find the last non-separator, non-flex-separator element to remove
        let removeIndex = -1;
        for (let i = filtered.length - 1; i >= 0; i--) {
            const elem = filtered[i];
            if (elem && elem.type !== 'separator' && elem.type !== 'flex-separator') {
                removeIndex = i;
                break;
            }
        }

        if (removeIndex === -1) {
            break; // Only separators left
        }

        // Remove the widget
        filtered.splice(removeIndex, 1);

        // Remove preceding separator if it exists
        if (removeIndex > 0 && filtered[removeIndex - 1]?.type === 'separator') {
            filtered.splice(removeIndex - 1, 1);
        }

        // Remove trailing separators
        while (filtered.length > 0 && filtered[filtered.length - 1]?.type === 'separator') {
            filtered.pop();
        }
    }

    return filtered;
}

function trimTrailingSeparatorTokens(tokens: RenderToken[]): void {
    while (tokens.length > 0) {
        const lastToken = tokens[tokens.length - 1];
        if (!lastToken || lastToken.type === 'content') {
            return;
        }
        tokens.pop();
    }
}

function getWrapMaxLines(widget?: WidgetItem): number | undefined {
    if (widget?.id === 'updatemessage') {
        return 2;
    }

    if (widget?.type !== 'status-summary') {
        return undefined;
    }

    const source = widget.metadata?.source;
    if (source === 'goal' || source === 'current-focus' || source === 'last-conclusion') {
        return 2;
    }

    return undefined;
}

function expandContentTokensForWrap(tokens: RenderToken[], maxWidth: number): RenderToken[] {
    const expanded: RenderToken[] = [];

    for (const token of tokens) {
        if (token.type !== 'content' || getVisibleWidth(token.content) <= maxWidth) {
            expanded.push(token);
            continue;
        }

        const wrappedSegments = wrapStyledText(token.content, maxWidth, {
            maxLines: getWrapMaxLines(token.widget),
            ellipsis: true
        });

        if (wrappedSegments.length <= 1) {
            expanded.push(token);
            continue;
        }

        wrappedSegments.forEach((segment, index) => {
            if (index > 0) {
                expanded.push({ content: '', type: 'line-break' });
            }

            expanded.push({
                content: segment,
                type: 'content',
                widget: token.widget
            });
        });
    }

    return expanded;
}

function partitionTokensForWrap(tokens: RenderToken[], maxWidth: number): RenderToken[][] {
    if (tokens.length === 0) {
        return [];
    }

    const groups: RenderToken[][] = [];
    let currentGroup: RenderToken[] = [];
    let currentWidth = 0;

    for (const token of tokens) {
        if (token.type === 'line-break') {
            trimTrailingSeparatorTokens(currentGroup);
            if (currentGroup.length > 0) {
                groups.push(currentGroup);
            }

            currentGroup = [];
            currentWidth = 0;
            continue;
        }

        const tokenWidth = getVisibleWidth(token.content);

        if (currentGroup.length === 0) {
            currentGroup.push(token);
            currentWidth = tokenWidth;
            continue;
        }

        if ((currentWidth + tokenWidth) <= maxWidth) {
            currentGroup.push(token);
            currentWidth += tokenWidth;
            continue;
        }

        if (token.type !== 'content') {
            currentGroup.push(token);
            currentWidth += tokenWidth;
            continue;
        }

        trimTrailingSeparatorTokens(currentGroup);
        if (currentGroup.length > 0) {
            groups.push(currentGroup);
        }

        currentGroup = [token];
        currentWidth = tokenWidth;
    }

    trimTrailingSeparatorTokens(currentGroup);
    if (currentGroup.length > 0) {
        groups.push(currentGroup);
    }

    return groups;
}

function buildFlexLine(tokens: RenderToken[], terminalWidth: number): string {
    const parts: string[][] = [[]];
    let currentPart = 0;

    for (const token of tokens) {
        if (token.type === 'flex-separator') {
            currentPart++;
            parts[currentPart] = [];
        } else {
            parts[currentPart]?.push(token.content);
        }
    }

    const partLengths = parts.map(part => getVisibleWidth(part.join('')));
    const totalContentLength = partLengths.reduce((sum, len) => sum + len, 0);
    const flexCount = parts.length - 1;
    const totalSpace = Math.max(0, terminalWidth - totalContentLength);
    const spacePerFlex = flexCount > 0 ? Math.floor(totalSpace / flexCount) : 0;
    const extraSpace = flexCount > 0 ? totalSpace % flexCount : 0;

    let result = '';
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part) {
            result += part.join('');
        }
        if (i < parts.length - 1) {
            const spaces = spacePerFlex + (i < extraSpace ? 1 : 0);
            result += ' '.repeat(spaces);
        }
    }

    return result;
}

export function renderStatusLineWithInfo(
    widgets: WidgetItem[],
    settings: Settings,
    context: RenderContext,
    preRenderedWidgets: PreRenderedWidget[],
    preCalculatedMaxWidths: number[]
): RenderResult {
    const line = renderStatusLine(widgets, settings, context, preRenderedWidgets, preCalculatedMaxWidths);
    // Check if line contains the truncation ellipsis
    const wasTruncated = line.includes('...');
    return { line, wasTruncated };
}

export function renderStatusLine(
    widgets: WidgetItem[],
    settings: Settings,
    context: RenderContext,
    preRenderedWidgets: PreRenderedWidget[],
    preCalculatedMaxWidths: number[]
): string {
    const renderContext = normalizeRenderContext(settings, context);
    // Force 24-bit color for non-preview statusline rendering
    // Chalk level is now set globally in ccstatusline.ts and tui.tsx
    // No need to override here

    // Get color level from settings
    const colorLevel = getColorLevelString((settings.colorLevel as number) as (0 | 1 | 2 | 3));

    // Check if powerline mode is enabled
    const powerlineSettings = settings.powerline as Record<string, unknown> | undefined;
    const isPowerlineMode = Boolean(powerlineSettings?.enabled);

    // If powerline mode is enabled, use powerline renderer
    if (isPowerlineMode)
        return renderPowerlineStatusLine(widgets, settings, renderContext, renderContext.lineIndex ?? 0, renderContext.globalSeparatorIndex ?? 0, preRenderedWidgets, preCalculatedMaxWidths);

    // Helper to apply colors with optional background and bold override
    const applyColorsWithOverride = (text: string, foregroundColor?: string, backgroundColor?: string, bold?: boolean): string => {
        // Override foreground color takes precedence over EVERYTHING, including passed foreground color
        let fgColor = foregroundColor;
        if (settings.overrideForegroundColor && settings.overrideForegroundColor !== 'none') {
            fgColor = settings.overrideForegroundColor;
        }

        // Override background color takes precedence over EVERYTHING, including passed background color
        let bgColor = backgroundColor;
        if (settings.overrideBackgroundColor && settings.overrideBackgroundColor !== 'none') {
            bgColor = settings.overrideBackgroundColor;
        }

        const shouldBold = (settings.globalBold) || bold;
        return applyColors(text, fgColor, bgColor, shouldBold, colorLevel);
    };

    const { baseWidth: detectedWidth, effectiveWidth: terminalWidth } = resolveTerminalWidths(settings, renderContext);
    const overflowBehavior = settings.overflowBehavior;

    const elements: { content: string; type: string; widget?: WidgetItem }[] = [];
    let hasFlexSeparator = false;

    // Build elements based on configured widgets
    for (let i = 0; i < widgets.length; i++) {
        const widget = widgets[i];
        if (!widget)
            continue;

        // Handle separators specially (they're not widgets)
        if (widget.type === 'separator') {
            // Check if there's any widget before this separator that actually rendered content
            // Look backwards to find ANY widget that produced content
            let hasContentBefore = false;
            for (let j = i - 1; j >= 0; j--) {
                const prevWidget = widgets[j];
                if (prevWidget && prevWidget.type !== 'separator' && prevWidget.type !== 'flex-separator') {
                    if (preRenderedWidgets[j]?.content) {
                        hasContentBefore = true;
                        break;
                    }
                    // Continue looking backwards even if this widget didn't render content
                }
            }
            if (!hasContentBefore)
                continue;

            // Check if there's any widget after this separator that actually rendered content
            let hasContentAfter = false;
            for (let j = i + 1; j < widgets.length; j++) {
                const nextWidget = widgets[j];
                if (nextWidget && nextWidget.type !== 'separator' && nextWidget.type !== 'flex-separator') {
                    if (preRenderedWidgets[j]?.content) {
                        hasContentAfter = true;
                        break;
                    }
                }
            }
            if (!hasContentAfter)
                continue;

            const sepChar = widget.character ?? (settings.defaultSeparator ?? '|');
            const formattedSep = formatSeparator(sepChar);

            // Check if we should inherit colors from the previous widget
            let separatorColor = widget.color ?? 'gray';
            let separatorBg = widget.backgroundColor;
            let separatorBold = widget.bold;

            if (settings.inheritSeparatorColors && i > 0 && !widget.color && !widget.backgroundColor) {
                // Only inherit if the separator doesn't have explicit colors set
                const prevWidget = widgets[i - 1];
                if (prevWidget && prevWidget.type !== 'separator' && prevWidget.type !== 'flex-separator') {
                    // Get the previous widget's colors
                    let widgetColor = prevWidget.color;
                    if (!widgetColor) {
                        const widgetImpl = getWidget(prevWidget.type);
                        widgetColor = widgetImpl ? widgetImpl.getDefaultColor() : 'white';
                    }
                    separatorColor = widgetColor;
                    separatorBg = prevWidget.backgroundColor;
                    separatorBold = prevWidget.bold;
                }
            }

            elements.push({ content: applyColorsWithOverride(formattedSep, separatorColor, separatorBg, separatorBold), type: 'separator', widget });
            continue;
        }

        if (widget.type === 'flex-separator') {
            elements.push({ content: 'FLEX', type: 'flex-separator', widget });
            hasFlexSeparator = true;
            continue;
        }

        // Use widget registry for regular widgets
        try {
            let widgetText: string | undefined;
            let defaultColor = 'white';

            // Use pre-rendered content
            const preRendered = preRenderedWidgets[i];
            if (preRendered?.content) {
                widgetText = preRendered.content;
                // Get default color from widget impl for consistency
                const widgetImpl = getWidget(widget.type);
                if (widgetImpl) {
                    defaultColor = widgetImpl.getDefaultColor();
                }
            }

            if (widgetText) {
                // Special handling for custom-command with preserveColors
                if (widget.type === 'custom-command' && widget.preserveColors) {
                    // Handle max width truncation for commands with ANSI codes
                    let finalOutput = widgetText;
                    if (widget.maxWidth && widget.maxWidth > 0) {
                        const plainLength = getVisibleWidth(widgetText);
                        if (plainLength > widget.maxWidth) {
                            finalOutput = truncateStyledText(widgetText, widget.maxWidth, { ellipsis: false });
                        }
                    }
                    // Preserve original colors from command output
                    elements.push({ content: finalOutput, type: widget.type, widget });
                } else {
                    // Normal widget rendering with colors
                    elements.push({
                        content: applyColorsWithOverride(widgetText, widget.color ?? defaultColor, widget.backgroundColor, widget.bold),
                        type: widget.type,
                        widget
                    });
                }
            }
        } catch {
            // Unknown widget type - skip
            continue;
        }
    }

    if (elements.length === 0)
        return '';

    while (elements.length > 0 && elements[0]?.type === 'separator') {
        elements.shift();
    }

    for (let index = elements.length - 1; index > 0; index--) {
        if (elements[index]?.type === 'separator' && elements[index - 1]?.type === 'separator') {
            elements.splice(index, 1);
        }
    }

    // Remove trailing separators
    while (elements.length > 0 && elements[elements.length - 1]?.type === 'separator') {
        elements.pop();
    }

    // Apply default padding and separators
    const padding = settings.defaultPadding ?? '';
    const defaultSep = settings.defaultSeparator ? formatSeparator(settings.defaultSeparator) : '';
    const paddingWidth = getVisibleWidth(padding);

    // Responsive widget hiding: progressively remove rightmost widgets until line fits
    const effectiveMaxWidth = terminalWidth ?? detectedWidth;
    if (overflowBehavior === 'hide' && effectiveMaxWidth && effectiveMaxWidth > 0) {
        const filteredElements = filterWidgetsToFit(elements, effectiveMaxWidth, paddingWidth);
        elements.length = 0;
        elements.push(...filteredElements);
    }

    const finalTokens: RenderToken[] = [];

    elements.forEach((elem, index) => {
        // Add default separator between any two items (but not before first item, and not around flex separators)
        const prevElem = index > 0 ? elements[index - 1] : null;
        const shouldAddSeparator = defaultSep && index > 0
            && elem.type !== 'separator'
            && elem.type !== 'flex-separator'
            && prevElem?.type !== 'separator'
            && prevElem?.type !== 'flex-separator'
            && !prevElem?.widget?.merge; // Don't add separator if previous widget is merged with this one

        if (shouldAddSeparator) {
            // Check if we should inherit colors from the previous element
            if (settings.inheritSeparatorColors && index > 0) {
                const prevElem = elements[index - 1];
                if (prevElem?.widget) {
                    // Apply the previous element's colors to the separator (already handles override)
                    // Use the widget's color if set, otherwise get the default color for that widget type
                    let widgetColor = prevElem.widget.color;
                    if (!widgetColor && prevElem.widget.type !== 'separator' && prevElem.widget.type !== 'flex-separator') {
                        const widgetImpl = getWidget(prevElem.widget.type);
                        widgetColor = widgetImpl ? widgetImpl.getDefaultColor() : 'white';
                    }
                    const coloredSep = applyColorsWithOverride(defaultSep, widgetColor, prevElem.widget.backgroundColor, prevElem.widget.bold);
                    finalTokens.push({ content: coloredSep, type: 'separator' });
                } else {
                    finalTokens.push({ content: defaultSep, type: 'separator' });
                }
            } else if ((settings.overrideBackgroundColor && settings.overrideBackgroundColor !== 'none')
                || (settings.overrideForegroundColor && settings.overrideForegroundColor !== 'none')) {
                // Apply override colors even when not inheriting colors
                const coloredSep = applyColorsWithOverride(defaultSep, undefined, undefined);
                finalTokens.push({ content: coloredSep, type: 'separator' });
            } else {
                finalTokens.push({ content: defaultSep, type: 'separator' });
            }
        }

        // Add element with padding (separators don't get padding)
        if (elem.type === 'separator' || elem.type === 'flex-separator') {
            finalTokens.push({
                content: elem.content,
                type: elem.type === 'flex-separator' ? 'flex-separator' : 'separator'
            });
        } else {
            // Check if padding should be omitted due to no-padding merge
            const nextElem = index < elements.length - 1 ? elements[index + 1] : null;
            const omitLeadingPadding = prevElem?.widget?.merge === 'no-padding';
            const omitTrailingPadding = elem.widget?.merge === 'no-padding' && nextElem;

            // Apply padding with colors (using overrides if set)
            const hasColorOverride = Boolean(settings.overrideBackgroundColor && settings.overrideBackgroundColor !== 'none')
                || Boolean(settings.overrideForegroundColor && settings.overrideForegroundColor !== 'none');

            if (padding && (elem.widget?.backgroundColor || hasColorOverride)) {
                // Apply colors to padding - applyColorsWithOverride will handle the overrides
                const leadingPadding = omitLeadingPadding ? '' : applyColorsWithOverride(padding, undefined, elem.widget?.backgroundColor);
                const trailingPadding = omitTrailingPadding ? '' : applyColorsWithOverride(padding, undefined, elem.widget?.backgroundColor);
                const paddedContent = leadingPadding + elem.content + trailingPadding;
                finalTokens.push({ content: paddedContent, type: 'content', widget: elem.widget });
            } else if (padding) {
                // Wrap padding in ANSI reset codes to prevent trimming
                // This ensures leading spaces aren't trimmed by terminals
                const protectedPadding = chalk.reset(padding);
                const leadingPadding = omitLeadingPadding ? '' : protectedPadding;
                const trailingPadding = omitTrailingPadding ? '' : protectedPadding;
                finalTokens.push({
                    content: leadingPadding + elem.content + trailingPadding,
                    type: 'content',
                    widget: elem.widget
                });
            } else {
                // No padding
                finalTokens.push({ content: elem.content, type: 'content', widget: elem.widget });
            }
        }
    });

    const joinTokens = (tokens: RenderToken[]): string => tokens.map(token => token.content).join('');

    // When wrap mode is enabled, collapse flex separators to regular separators
    // and wrap the content across multiple lines instead of truncating.
    if (overflowBehavior === 'wrap' && effectiveMaxWidth && effectiveMaxWidth > 0) {
        const collapseFlexSep = (token: RenderToken): RenderToken => token.type === 'flex-separator'
            ? { content: chalk.gray(' · '), type: 'separator' }
            : token;
        const baseWrapTokens = hasFlexSeparator
            ? finalTokens.map(collapseFlexSep)
            : finalTokens;
        const wrapTokens = expandContentTokensForWrap(baseWrapTokens, effectiveMaxWidth);

        const totalWidth = wrapTokens.reduce((sum, token) => sum + getVisibleWidth(token.content), 0);

        // If content fits in one line with flex separators, use flex expansion
        if (hasFlexSeparator && terminalWidth && totalWidth <= terminalWidth) {
            return buildFlexLine(finalTokens, terminalWidth);
        }

        const wrappedGroups = partitionTokensForWrap(wrapTokens, effectiveMaxWidth);
        const wrappedLines = wrappedGroups.map((group) => {
            let wrappedLine = trimStyledWhitespace(joinTokens(group));
            if (getVisibleWidth(wrappedLine) > effectiveMaxWidth) {
                wrappedLine = truncateStyledText(wrappedLine, effectiveMaxWidth, { ellipsis: true });
            }
            return wrappedLine + chalk.reset('');
        });

        return wrappedLines.join('\n');
    }

    // Build the final status line
    let statusLine = '';

    if (hasFlexSeparator && terminalWidth) {
        statusLine = buildFlexLine(finalTokens, terminalWidth);
    } else {
        // No flex separator OR no width detected
        if (hasFlexSeparator && !terminalWidth) {
            // Treat flex separators as normal separators when width detection fails
            statusLine = finalTokens.map(token => token.type === 'flex-separator' ? chalk.gray(' | ') : token.content).join('');
        } else {
            // Just join all elements normally
            statusLine = joinTokens(finalTokens);
        }
    }

    // Truncate if the line exceeds the terminal width
    // Use terminalWidth if available (already accounts for flex mode adjustments), otherwise use detectedWidth
    const maxWidth = terminalWidth ?? detectedWidth;
    if (maxWidth && maxWidth > 0) {
        // Remove ANSI escape codes to get actual length
        const plainLength = getVisibleWidth(statusLine);

        if (plainLength > maxWidth) {
            statusLine = truncateStyledText(statusLine, maxWidth, { ellipsis: true });
        }
    }

    return statusLine;
}