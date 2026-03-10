import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    CustomKeybind,
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import { getContextWindowMetrics } from '../utils/context-window';
import {
    getContextConfig,
    getModelContextIdentifier
} from '../utils/model-context';
import { makeUsageProgressBar } from '../utils/usage';

type DisplayMode = 'progress' | 'progress-short';

function getDisplayMode(item: WidgetItem): DisplayMode {
    return item.metadata?.display === 'progress' ? 'progress' : 'progress-short';
}

export class ContextBarWidget implements Widget {
    getDefaultColor(): string { return 'blue'; }
    getDescription(): string { return 'Shows context usage as a progress bar'; }
    getDisplayName(): string { return 'Context Bar'; }
    getCategory(): string { return 'Context'; }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        const mode = getDisplayMode(item);
        const modifiers: string[] = [];

        if (mode === 'progress-short') {
            modifiers.push('short bar');
        }
        if (item.metadata?.colorCoded === 'true') {
            modifiers.push('color coded');
        }

        return {
            displayText: this.getDisplayName(),
            modifierText: modifiers.length > 0 ? `(${modifiers.join(', ')})` : undefined
        };
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        if (action === 'toggle-progress') {
            const currentMode = getDisplayMode(item);
            const nextMode: DisplayMode = currentMode === 'progress-short' ? 'progress' : 'progress-short';

            return {
                ...item,
                metadata: {
                    ...(item.metadata ?? {}),
                    display: nextMode
                }
            };
        }

        if (action === 'toggle-color-coded') {
            const current = item.metadata?.colorCoded === 'true';
            return {
                ...item,
                metadata: {
                    ...(item.metadata ?? {}),
                    colorCoded: current ? 'false' : 'true'
                }
            };
        }

        return null;
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        const displayMode = getDisplayMode(item);
        const barWidth = displayMode === 'progress' ? 32 : 16;

        const colorCoded = item.metadata?.colorCoded === 'true';

        if (context.isPreview) {
            const previewDisplay = `${makeUsageProgressBar(25, barWidth, colorCoded)} 50k/200k (25%)`;
            return item.rawValue ? previewDisplay : `Context: ${previewDisplay}`;
        }

        const contextWindowMetrics = getContextWindowMetrics(context.data);

        let total = contextWindowMetrics.windowSize;
        let used = contextWindowMetrics.contextLengthTokens;

        if (used === null && context.tokenMetrics) {
            used = context.tokenMetrics.contextLength;
        }

        if (total === null && context.tokenMetrics) {
            const modelIdentifier = getModelContextIdentifier(context.data?.model);
            total = getContextConfig(modelIdentifier).maxTokens;
        }

        if (used === null || total === null || total <= 0) {
            return null;
        }

        const percent = (used / total) * 100;
        const clampedPercent = Math.max(0, Math.min(100, percent));

        const usedK = Math.round(used / 1000);
        const totalK = Math.round(total / 1000);
        const display = `${makeUsageProgressBar(clampedPercent, barWidth, colorCoded)} ${usedK}k/${totalK}k (${Math.round(clampedPercent)}%)`;

        return item.rawValue ? display : `Context: ${display}`;
    }

    getCustomKeybinds(): CustomKeybind[] {
        return [
            { key: 'p', label: '(p)rogress toggle', action: 'toggle-progress' },
            { key: 'c', label: '(c)olor coded', action: 'toggle-color-coded' }
        ];
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}