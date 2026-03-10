import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

export class OutputStyleWidget implements Widget {
    getDefaultColor(): string { return 'cyan'; }
    getDescription(): string { return 'Shows the current Claude Code output style'; }
    getDisplayName(): string { return 'Output Style'; }
    getCategory(): string { return 'Core'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        const hideWhenDefault = item.metadata?.hideWhenDefault === 'true';

        if (context.isPreview) {
            const previewValue = hideWhenDefault ? 'concise' : 'default';
            return item.rawValue ? previewValue : `Style: ${previewValue}`;
        }

        const outputStyleName = context.data?.output_style?.name;
        if (!outputStyleName) {
            return null;
        }

        if (hideWhenDefault && outputStyleName === 'default') {
            return null;
        }

        return item.rawValue ? outputStyleName : `Style: ${outputStyleName}`;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}