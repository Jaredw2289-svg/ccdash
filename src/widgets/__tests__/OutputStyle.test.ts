import {
    describe,
    expect,
    it
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import { OutputStyleWidget } from '../OutputStyle';

function render(item: WidgetItem, context: RenderContext = {}): string | null {
    return new OutputStyleWidget().render(item, context, DEFAULT_SETTINGS);
}

describe('OutputStyleWidget', () => {
    it('hides default style when hideWhenDefault is enabled', () => {
        const item: WidgetItem = {
            id: 'style',
            type: 'output-style',
            metadata: { hideWhenDefault: 'true' }
        };

        expect(render(item, { data: { output_style: { name: 'default' } } })).toBeNull();
    });

    it('shows labeled non-default style when hideWhenDefault is enabled', () => {
        const item: WidgetItem = {
            id: 'style',
            type: 'output-style',
            metadata: { hideWhenDefault: 'true' }
        };

        expect(render(item, { data: { output_style: { name: 'concise' } } })).toBe('Style: concise');
    });

    it('shows a non-default preview when hideWhenDefault is enabled', () => {
        const item: WidgetItem = {
            id: 'style',
            type: 'output-style',
            metadata: { hideWhenDefault: 'true' }
        };

        expect(render(item, { isPreview: true })).toBe('Style: concise');
    });
});