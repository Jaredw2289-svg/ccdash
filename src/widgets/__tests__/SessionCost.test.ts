import {
    describe,
    expect,
    it
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import { SessionCostWidget } from '../SessionCost';

function render(item: WidgetItem, context: RenderContext = {}): string | null {
    return new SessionCostWidget().render(item, context, DEFAULT_SETTINGS);
}

describe('SessionCostWidget', () => {
    it('uses the session spending label', () => {
        const item: WidgetItem = { id: 'cost', type: 'session-cost' };
        expect(render(item, { data: { cost: { total_cost_usd: 2.45 } } })).toBe('Session spending: $2.45');
    });

    it('keeps raw value output unchanged', () => {
        const item: WidgetItem = { id: 'cost', type: 'session-cost', rawValue: true };
        expect(render(item, { data: { cost: { total_cost_usd: 2.45 } } })).toBe('$2.45');
    });
});