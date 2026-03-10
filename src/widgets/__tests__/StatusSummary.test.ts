import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import {
    getFirstUserSummary,
    getLastAssistantSummary,
    getSessionOverview
} from '../../utils/jsonl-summary';
import { readSessionStatusFile } from '../../utils/session-status-file';
import { StatusSummaryWidget } from '../StatusSummary';

vi.mock('../../utils/jsonl-summary', () => ({ getLastAssistantSummary: vi.fn(), getFirstUserSummary: vi.fn(), getSessionOverview: vi.fn() }));
vi.mock('../../utils/session-status-file', () => ({ readSessionStatusFile: vi.fn() }));

const mockGetLastAssistantSummary = getLastAssistantSummary as unknown as ReturnType<typeof vi.fn>;
const mockGetFirstUserSummary = getFirstUserSummary as unknown as ReturnType<typeof vi.fn>;
const mockGetSessionOverview = getSessionOverview as unknown as ReturnType<typeof vi.fn>;
const mockReadSessionStatusFile = readSessionStatusFile as unknown as ReturnType<typeof vi.fn>;

function render(widget: StatusSummaryWidget, item: WidgetItem, context: RenderContext = {}): string | null {
    return widget.render(item, context, DEFAULT_SETTINGS);
}

describe('StatusSummaryWidget', () => {
    const baseItem: WidgetItem = { id: 'summary', type: 'status-summary' };
    const rawItem: WidgetItem = { id: 'summary', type: 'status-summary', rawValue: true };
    let widget: StatusSummaryWidget;

    beforeEach(() => {
        vi.clearAllMocks();
        widget = new StatusSummaryWidget();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('returns preview text', () => {
        expect(render(widget, baseItem, { isPreview: true })).toBe('Task: Refactored auth module');
        expect(render(widget, rawItem, { isPreview: true })).toBe('Refactored auth module');
    });

    it('reads from per-session file when session_id is present', () => {
        mockReadSessionStatusFile.mockReturnValue({
            goal: null,
            now: 'Fixed login CSS layout',
            updatedAt: '2026-03-10T00:00:00.000Z'
        });

        const context: RenderContext = { data: { session_id: 'session-abc' } };
        expect(render(widget, rawItem, context)).toBe('Fixed login CSS layout');
        expect(render(widget, baseItem, context)).toBe('Task: Fixed login CSS layout');
        expect(mockReadSessionStatusFile).toHaveBeenCalledWith('session-abc');
    });

    it('returns null when per-session file is missing and no transcript', () => {
        mockReadSessionStatusFile.mockReturnValue(null);

        const context: RenderContext = { data: { session_id: 'session-xyz' } };
        expect(render(widget, rawItem, context)).toBeNull();
    });

    it('returns null when no session_id and no transcript', () => {
        expect(render(widget, rawItem, { data: {} })).toBeNull();
    });

    it('uses transcript when session file missing', () => {
        mockReadSessionStatusFile.mockReturnValue(null);
        mockGetLastAssistantSummary.mockReturnValue('Transcript-based task');

        const context: RenderContext = { data: { session_id: 'session-xyz', transcript_path: '/tmp/test.jsonl' } };
        expect(render(widget, rawItem, context)).toBe('Transcript-based task');
    });

    it('returns null when no files exist', () => {
        mockReadSessionStatusFile.mockReturnValue(null);
        expect(render(widget, rawItem)).toBeNull();
    });

    it('returns null when session status is empty', () => {
        mockReadSessionStatusFile.mockReturnValue({
            goal: null,
            now: null,
            updatedAt: null
        });
        expect(render(widget, rawItem)).toBeNull();
    });

    it('uses now from Claude-managed session status', () => {
        mockReadSessionStatusFile.mockReturnValue({
            goal: null,
            now: 'Latest task',
            updatedAt: '2026-03-10T00:00:00.000Z'
        });

        const context: RenderContext = { data: { session_id: 'session-abc' } };
        expect(render(widget, rawItem, context)).toBe('Latest task');
    });

    it('truncates to maxWidth', () => {
        mockReadSessionStatusFile.mockReturnValue({
            goal: null,
            now: 'This is a very long summary that should be truncated',
            updatedAt: '2026-03-10T00:00:00.000Z'
        });

        const itemWithMaxWidth: WidgetItem = { id: 'summary', type: 'status-summary', rawValue: true, maxWidth: 20 };
        const context: RenderContext = { data: { session_id: 'session-abc' } };
        const result = render(widget, itemWithMaxWidth, context);
        expect(result).toBe('This is a very long\u2026');
        expect(result).toHaveLength(20);
    });

    it('returns null when session status has no usable now value', () => {
        mockReadSessionStatusFile.mockReturnValue({
            goal: 'Stable session goal',
            now: null,
            updatedAt: '2026-03-10T00:00:00.000Z'
        });
        const context: RenderContext = { data: { session_id: 'session-abc' } };
        expect(render(widget, rawItem, context)).toBeNull();
    });

    it('has correct metadata', () => {
        expect(widget.getDisplayName()).toBe('Status Summary');
        expect(widget.getCategory()).toBe('Session');
        expect(widget.getDefaultColor()).toBe('white');
        expect(widget.supportsRawValue()).toBe(true);
        expect(widget.supportsColors(baseItem)).toBe(true);
    });

    it('uses session file when available', () => {
        mockReadSessionStatusFile.mockReturnValue({
            goal: null,
            now: 'Session-specific task',
            updatedAt: '2026-03-10T00:00:00.000Z'
        });

        const context: RenderContext = { data: { session_id: 'session-abc' } };
        expect(render(widget, rawItem, context)).toBe('Session-specific task');
    });

    it('uses transcript when per-session file is empty', () => {
        mockReadSessionStatusFile.mockReturnValue({
            goal: null,
            now: null,
            updatedAt: null
        });
        mockGetLastAssistantSummary.mockReturnValue('Transcript fallback');

        const context: RenderContext = { data: { session_id: 'session-abc', transcript_path: '/tmp/test.jsonl' } };
        expect(render(widget, rawItem, context)).toBe('Transcript fallback');
    });

    describe('first-human source', () => {
        const firstHumanItem: WidgetItem = { id: 'goal', type: 'status-summary', rawValue: true, maxWidth: 120, metadata: { source: 'first-human' } };

        it('skips file-based summary and uses transcript directly', () => {
            mockReadSessionStatusFile.mockReturnValue({
                goal: 'Session goal from Claude-managed status',
                now: 'File-based step',
                updatedAt: '2026-03-10T00:00:00.000Z'
            });
            mockGetFirstUserSummary.mockReturnValue('Session goal from transcript');

            const context: RenderContext = { data: { session_id: 'session-abc', transcript_path: '/tmp/test.jsonl' } };
            expect(render(widget, firstHumanItem, context)).toBe('Session goal from transcript');
            expect(mockGetFirstUserSummary).toHaveBeenCalledWith('/tmp/test.jsonl', 120);
        });

        it('calls getFirstUserSummary instead of getLastAssistantSummary', () => {
            mockReadSessionStatusFile.mockReturnValue(null);
            mockGetFirstUserSummary.mockReturnValue('Build a CLI tool');

            const context: RenderContext = { data: { transcript_path: '/tmp/test.jsonl' } };
            expect(render(widget, firstHumanItem, context)).toBe('Build a CLI tool');
            expect(mockGetFirstUserSummary).toHaveBeenCalledWith('/tmp/test.jsonl', 120);
            expect(mockGetLastAssistantSummary).not.toHaveBeenCalled();
        });

        it('shows goal-like preview text', () => {
            expect(render(widget, firstHumanItem, { isPreview: true })).toBe('Three-line layout, rich quota display');
            const labeledItem: WidgetItem = { ...firstHumanItem, rawValue: false };
            expect(render(widget, labeledItem, { isPreview: true })).toBe('Goal: Three-line layout, rich quota display');
        });
    });

    describe('session-overview source', () => {
        const overviewItem: WidgetItem = { id: 'overview', type: 'status-summary', rawValue: true, maxWidth: 120, metadata: { source: 'session-overview' } };

        it('skips file-based summary and uses getSessionOverview', () => {
            mockReadSessionStatusFile.mockReturnValue({
                goal: 'Stable goal',
                now: 'File-based step',
                updatedAt: '2026-03-10T00:00:00.000Z'
            });
            mockGetSessionOverview.mockReturnValue('Turn 5 · Fixed login CSS layout');

            const context: RenderContext = { data: { session_id: 'session-abc', transcript_path: '/tmp/test.jsonl' } };
            expect(render(widget, overviewItem, context)).toBe('Turn 5 · Fixed login CSS layout');
            expect(mockGetSessionOverview).toHaveBeenCalledWith('/tmp/test.jsonl', 120);
        });

        it('calls getSessionOverview instead of getLastAssistantSummary', () => {
            mockReadSessionStatusFile.mockReturnValue(null);
            mockGetSessionOverview.mockReturnValue('Turn 3 · Added unit tests');

            const context: RenderContext = { data: { transcript_path: '/tmp/test.jsonl' } };
            expect(render(widget, overviewItem, context)).toBe('Turn 3 · Added unit tests');
            expect(mockGetSessionOverview).toHaveBeenCalledWith('/tmp/test.jsonl', 120);
            expect(mockGetLastAssistantSummary).not.toHaveBeenCalled();
            expect(mockGetFirstUserSummary).not.toHaveBeenCalled();
        });

        it('shows overview-style preview text', () => {
            expect(render(widget, overviewItem, { isPreview: true })).toBe('Turn 5 · All tests pass, lint clean');
        });

        it('returns null when no transcript available', () => {
            mockReadSessionStatusFile.mockReturnValue(null);

            const context: RenderContext = { data: { session_id: 'session-abc' } };
            expect(render(widget, overviewItem, context)).toBeNull();
        });
    });

    describe('dashboard state sources', () => {
        it('renders goal summary from dashboard state', () => {
            const item: WidgetItem = { id: 'goal', type: 'status-summary', rawValue: false, metadata: { source: 'goal' } };
            const context: RenderContext = {
                dashboardState: {
                    goalSummary: 'Refine the session dashboard information hierarchy',
                    lastConclusion: null
                }
            };

            expect(render(widget, item, context)).toBe('Goal: Refine the session dashboard information hierarchy');
        });

        it('renders now from dashboard state via current-focus source', () => {
            const item: WidgetItem = { id: 'focus', type: 'status-summary', rawValue: false, metadata: { source: 'current-focus' } };
            const context: RenderContext = {
                dashboardState: {
                    goalSummary: null,
                    lastConclusion: 'Updating the renderer to wrap instead of hiding widgets'
                }
            };

            expect(render(widget, item, context)).toBe('Now: Updating the renderer to wrap instead of hiding widgets');
        });

        it('renders now from dashboard state via last-conclusion source', () => {
            const item: WidgetItem = { id: 'now', type: 'status-summary', rawValue: false, metadata: { source: 'last-conclusion' } };
            const context: RenderContext = {
                dashboardState: {
                    goalSummary: null,
                    lastConclusion: 'Wrapped narrow layouts without dropping dashboard context'
                }
            };

            expect(render(widget, item, context)).toBe('Now: Wrapped narrow layouts without dropping dashboard context');
        });

        it('returns null when lastConclusion is absent for now-like source', () => {
            const item: WidgetItem = { id: 'now', type: 'status-summary', rawValue: false, metadata: { source: 'last-conclusion' } };
            const context: RenderContext = {
                dashboardState: {
                    goalSummary: 'Some goal',
                    lastConclusion: null
                }
            };

            expect(render(widget, item, context)).toBeNull();
        });
    });

    describe('transcript fallback', () => {
        it('uses transcript when no file-based summary exists', () => {
            mockReadSessionStatusFile.mockReturnValue(null);
            mockGetLastAssistantSummary.mockReturnValue('Refactored the auth module');

            const context: RenderContext = { data: { transcript_path: '/tmp/test.jsonl' } };
            expect(render(widget, rawItem, context)).toBe('Refactored the auth module');
        });

        it('adds Task: prefix when rawValue is false', () => {
            mockReadSessionStatusFile.mockReturnValue(null);
            mockGetLastAssistantSummary.mockReturnValue('Refactored the auth module');

            const context: RenderContext = { data: { transcript_path: '/tmp/test.jsonl' } };
            expect(render(widget, baseItem, context)).toBe('Task: Refactored the auth module');
        });

        it('prefers file-based summary over transcript', () => {
            mockReadSessionStatusFile.mockReturnValue({
                goal: null,
                now: 'File-based task',
                updatedAt: '2026-03-10T00:00:00.000Z'
            });
            mockGetLastAssistantSummary.mockReturnValue('Transcript task');

            const context: RenderContext = { data: { session_id: 'session-abc', transcript_path: '/tmp/test.jsonl' } };
            expect(render(widget, rawItem, context)).toBe('File-based task');
            expect(mockGetLastAssistantSummary).not.toHaveBeenCalled();
        });

        it('returns null when both file and transcript have no summary', () => {
            mockReadSessionStatusFile.mockReturnValue(null);
            mockGetLastAssistantSummary.mockReturnValue(null);

            const context: RenderContext = { data: { transcript_path: '/tmp/test.jsonl' } };
            expect(render(widget, rawItem, context)).toBeNull();
        });

        it('does not call transcript when no transcript_path in context', () => {
            mockReadSessionStatusFile.mockReturnValue(null);

            const context: RenderContext = { data: {} };
            expect(render(widget, rawItem, context)).toBeNull();
            expect(mockGetLastAssistantSummary).not.toHaveBeenCalled();
        });

        it('passes maxWidth to getLastAssistantSummary', () => {
            mockReadSessionStatusFile.mockReturnValue(null);
            mockGetLastAssistantSummary.mockReturnValue('Short');

            const itemWithMaxWidth: WidgetItem = { id: 'summary', type: 'status-summary', rawValue: true, maxWidth: 25 };
            const context: RenderContext = { data: { transcript_path: '/tmp/test.jsonl' } };
            render(widget, itemWithMaxWidth, context);
            expect(mockGetLastAssistantSummary).toHaveBeenCalledWith('/tmp/test.jsonl', 25);
        });

        it('reads goal from Claude-managed session status for goal source', () => {
            mockReadSessionStatusFile.mockReturnValue({
                goal: 'Understand available capabilities in ccdash',
                now: 'Explaining the assistant capability surface for this repo',
                updatedAt: '2026-03-10T00:00:00.000Z'
            });

            const item: WidgetItem = { id: 'goal', type: 'status-summary', rawValue: false, metadata: { source: 'goal' } };
            const context: RenderContext = { data: { session_id: 'session-abc' } };

            expect(render(widget, item, context)).toBe('Goal: Understand available capabilities in ccdash');
        });
    });
});