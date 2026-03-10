import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import type { WidgetHookDef } from '../utils/hooks';
import {
    getFirstUserSummary,
    getLastAssistantSummary,
    getSessionOverview
} from '../utils/jsonl-summary';
import { readSessionStatusFile } from '../utils/session-status-file';

function truncate(text: string, maxWidth: number): string {
    if (text.length <= maxWidth) {
        return text;
    }
    return text.substring(0, maxWidth - 1) + '\u2026';
}

export class StatusSummaryWidget implements Widget {
    getDefaultColor(): string { return 'white'; }
    getDescription(): string { return 'Shows the current task summary for this session'; }
    getDisplayName(): string { return 'Status Summary'; }
    getCategory(): string { return 'Session'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        const source = item.metadata?.source;
        const useFirstHuman = source === 'first-human';
        const useSessionOverview = source === 'session-overview';
        const useGoalSummary = source === 'goal';
        const useCurrentFocus = source === 'current-focus';
        const useLastConclusion = source === 'last-conclusion';
        const useGoalLikeSummary = useFirstHuman || useGoalSummary;
        const useNowLikeSummary = useCurrentFocus || useLastConclusion;

        if (context.isPreview) {
            if (useGoalSummary) {
                return item.rawValue ? 'Refine the session dashboard information hierarchy' : 'Goal: Refine the session dashboard information hierarchy';
            }
            if (useCurrentFocus) {
                return item.rawValue ? 'Updating the renderer to wrap instead of hiding widgets' : 'Now: Updating the renderer to wrap instead of hiding widgets';
            }
            if (useLastConclusion) {
                return item.rawValue ? 'Wrapped narrow layouts without dropping dashboard context' : 'Now: Wrapped narrow layouts without dropping dashboard context';
            }
            if (useFirstHuman) {
                return item.rawValue ? 'Three-line layout, rich quota display' : 'Goal: Three-line layout, rich quota display';
            }
            if (useSessionOverview) {
                return item.rawValue ? 'Turn 5 · All tests pass, lint clean' : 'Task: Turn 5 · All tests pass, lint clean';
            }
            return item.rawValue ? 'Refactored auth module' : 'Task: Refactored auth module';
        }

        const dashboardState = context.dashboardState;
        if (dashboardState) {
            if (useGoalSummary) {
                const goalSummary = dashboardState.goalSummary;
                if (goalSummary) {
                    return item.rawValue ? goalSummary : `Goal: ${goalSummary}`;
                }
            }

            if (useCurrentFocus || useLastConclusion) {
                const now = dashboardState.lastConclusion;
                if (now) {
                    return item.rawValue ? now : `Now: ${now}`;
                }
            }
        }

        const sessionId = context.data?.session_id;
        const maxWidth = item.maxWidth ?? 60;

        const sessionStatus = sessionId ? readSessionStatusFile(sessionId) : null;
        if (!useSessionOverview) {
            if (useGoalSummary && sessionStatus?.goal) {
                const goal = truncate(sessionStatus.goal, maxWidth);
                return item.rawValue ? goal : `Goal: ${goal}`;
            }

            if (!useGoalLikeSummary && sessionStatus?.now) {
                const summary = truncate(sessionStatus.now, maxWidth);
                const label = useNowLikeSummary ? 'Now: ' : 'Task: ';
                return item.rawValue ? summary : `${label}${summary}`;
            }
        }

        // Fall back to transcript-based summary
        const transcriptPath = context.data?.transcript_path;
        if (transcriptPath) {
            let transcriptSummary: string | null;
            if (useGoalLikeSummary) {
                transcriptSummary = getFirstUserSummary(transcriptPath, maxWidth);
            } else if (useSessionOverview) {
                transcriptSummary = getSessionOverview(transcriptPath, maxWidth);
            } else {
                transcriptSummary = getLastAssistantSummary(transcriptPath, maxWidth);
            }
            if (transcriptSummary) {
                const label = useGoalLikeSummary ? 'Goal: ' : useNowLikeSummary ? 'Now: ' : 'Task: ';
                return item.rawValue ? transcriptSummary : `${label}${transcriptSummary}`;
            }
        }

        return null;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }

    getHooks(): WidgetHookDef[] {
        return [{ event: 'UserPromptSubmit' }];
    }
}