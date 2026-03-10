import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    CustomKeybind,
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import type { UsageData } from '../utils/usage';
import {
    formatUsageDuration,
    getUsageErrorMessage,
    makeUsageProgressBar,
    resolveUsageWindowWithFallback
} from '../utils/usage';

import { formatRawOrLabeledValue } from './shared/raw-or-labeled';
import {
    cycleUsageDisplayMode,
    getUsageDisplayMode,
    getUsageDisplayModifierText,
    getUsageProgressBarWidth,
    isUsageInverted,
    isUsageProgressMode,
    toggleUsageInverted
} from './shared/usage-display';

function getSessionResetSuffix(remainingMs: number, responsiveTier?: RenderContext['responsiveTier']): string | null {
    if (responsiveTier === 'narrow') {
        return null;
    }

    const duration = formatUsageDuration(remainingMs, true);
    return responsiveTier === 'medium' ? duration : `${duration} left`;
}

export class SessionUsageWidget implements Widget {
    getDefaultColor(): string { return 'brightBlue'; }
    getDescription(): string { return 'Shows daily/session API usage percentage'; }
    getDisplayName(): string { return 'Session Usage'; }
    getCategory(): string { return 'Usage'; }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return {
            displayText: this.getDisplayName(),
            modifierText: getUsageDisplayModifierText(item)
        };
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        if (action === 'toggle-progress') {
            return cycleUsageDisplayMode(item);
        }

        if (action === 'toggle-invert') {
            return toggleUsageInverted(item);
        }

        return null;
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        const displayMode = getUsageDisplayMode(item);
        const inverted = isUsageInverted(item);
        const showReset = item.metadata?.showReset === 'true';
        const colorCoded = item.metadata?.colorCoded === 'true';

        if (context.isPreview) {
            const previewPercent = 20;
            const renderedPercent = inverted ? 100 - previewPercent : previewPercent;

            if (isUsageProgressMode(displayMode)) {
                const width = getUsageProgressBarWidth(displayMode, context.responsiveTier);
                let progressDisplay = `${makeUsageProgressBar(renderedPercent, width, colorCoded)} ${renderedPercent.toFixed(1)}%`;
                if (showReset) {
                    const previewSuffix = getSessionResetSuffix((3 * 60 + 45) * 60 * 1000, context.responsiveTier);
                    if (previewSuffix) {
                        progressDisplay += ` \u00b7 ${previewSuffix}`;
                    }
                }
                return formatRawOrLabeledValue(item, 'Session: ', progressDisplay);
            }

            return formatRawOrLabeledValue(item, 'Session: ', `${previewPercent.toFixed(1)}%`);
        }

        const data = context.usageData ?? {};
        if (data.error)
            return getUsageErrorMessage(data.error);
        if (data.sessionUsage === undefined)
            return null;

        const percent = Math.max(0, Math.min(100, data.sessionUsage));
        if (isUsageProgressMode(displayMode)) {
            const width = getUsageProgressBarWidth(displayMode, context.responsiveTier);
            const renderedPercent = inverted ? 100 - percent : percent;
            let progressDisplay = `${makeUsageProgressBar(renderedPercent, width, colorCoded)} ${renderedPercent.toFixed(1)}%`;
            if (showReset) {
                const window = resolveUsageWindowWithFallback(data as UsageData, context.blockMetrics);
                if (window) {
                    const suffix = getSessionResetSuffix(window.remainingMs, context.responsiveTier);
                    if (suffix) {
                        progressDisplay += ` \u00b7 ${suffix}`;
                    }
                }
            }
            return formatRawOrLabeledValue(item, 'Session: ', progressDisplay);
        }

        return formatRawOrLabeledValue(item, 'Session: ', `${percent.toFixed(1)}%`);
    }

    getCustomKeybinds(): CustomKeybind[] {
        return [
            { key: 'p', label: '(p)rogress toggle', action: 'toggle-progress' },
            { key: 'v', label: 'in(v)ert fill', action: 'toggle-invert' }
        ];
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}