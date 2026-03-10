import chalk from 'chalk';
import {
    Box,
    Text
} from 'ink';
import React from 'react';

import type { RenderContext } from '../../types/RenderContext';
import type { Settings } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import {
    calculateMaxWidthsFromPreRendered,
    preRenderAllWidgets,
    renderStatusLineWithInfo,
    type PreRenderedWidget,
    type RenderResult
} from '../../utils/renderer';
import { advanceGlobalSeparatorIndex } from '../../utils/separator-index';
import {
    resolveTerminalWidth,
    type TerminalWidthProbeResult
} from '../../utils/terminal';

export interface StatusLinePreviewProps {
    lines: WidgetItem[][];
    terminalWidth: number;
    statuslineWidthProbe?: TerminalWidthProbeResult;
    settings?: Settings;
    onTruncationChange?: (isTruncated: boolean) => void;
}

const renderSingleLine = (
    widgets: WidgetItem[],
    terminalWidth: number,
    settings: Settings,
    lineIndex: number,
    globalSeparatorIndex: number,
    preRenderedWidgets: PreRenderedWidget[],
    preCalculatedMaxWidths: number[]
): RenderResult => {
    // Create render context for preview
    const context: RenderContext = {
        terminalWidth,
        isPreview: true,
        lineIndex,
        globalSeparatorIndex
    };

    return renderStatusLineWithInfo(widgets, settings, context, preRenderedWidgets, preCalculatedMaxWidths);
};

export const StatusLinePreview: React.FC<StatusLinePreviewProps> = ({
    lines,
    terminalWidth,
    statuslineWidthProbe,
    settings,
    onTruncationChange
}) => {
    // Render each configured line
    const previewBaseWidth = React.useMemo(() => {
        if (!settings) {
            return terminalWidth;
        }

        if (!statuslineWidthProbe) {
            return terminalWidth;
        }

        return resolveTerminalWidth(statuslineWidthProbe, settings.fallbackTerminalWidth).width;
    }, [settings, statuslineWidthProbe, terminalWidth]);

    const isPreviewingFallbackWidth = Boolean(statuslineWidthProbe && !statuslineWidthProbe.reliable);

    const { renderedLines, anyTruncated } = React.useMemo(() => {
        if (!settings)
            return { renderedLines: [], anyTruncated: false };

        // Always pre-render all widgets once (for efficiency)
        const preRenderedLines = preRenderAllWidgets(lines, settings, { terminalWidth: previewBaseWidth, isPreview: true });
        const preCalculatedMaxWidths = calculateMaxWidthsFromPreRendered(preRenderedLines, settings);

        let globalSeparatorIndex = 0;
        const result: string[] = [];
        let truncated = false;

        for (let i = 0; i < lines.length; i++) {
            const lineItems = lines[i];
            if (lineItems && lineItems.length > 0) {
                const preRenderedWidgets = preRenderedLines[i] ?? [];
                const renderResult = renderSingleLine(lineItems, previewBaseWidth, settings, i, globalSeparatorIndex, preRenderedWidgets, preCalculatedMaxWidths);
                result.push(...renderResult.line.split('\n'));
                if (renderResult.wasTruncated) {
                    truncated = true;
                }

                globalSeparatorIndex = advanceGlobalSeparatorIndex(globalSeparatorIndex, lineItems);
            }
        }

        return { renderedLines: result, anyTruncated: truncated };
    }, [lines, previewBaseWidth, settings]);

    // Notify parent when truncation status changes
    React.useEffect(() => {
        onTruncationChange?.(anyTruncated);
    }, [anyTruncated, onTruncationChange]);

    return (
        <Box flexDirection='column'>
            <Box borderStyle='round' borderColor='gray' borderDimColor width='100%' paddingLeft={1}>
                <Text>
                    &gt;
                    <Text dimColor> Preview  (ctrl+s to save configuration at any time)</Text>
                </Text>
            </Box>
            {isPreviewingFallbackWidth && settings && (
                <Text dimColor>{`  Previewing fallback width ${settings.fallbackTerminalWidth} for hook rendering.`}</Text>
            )}
            {renderedLines.map((line, index) => (
                <Text key={index}>
                    {'  '}
                    {line}
                    {chalk.reset('')}
                </Text>
            ))}
        </Box>
    );
};