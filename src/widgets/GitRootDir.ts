import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    CustomKeybind,
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import {
    isInsideGitWorkTree,
    runGit
} from '../utils/git';

import {
    getHideNoGitKeybinds,
    getHideNoGitModifierText,
    handleToggleNoGitAction,
    isHideNoGitEnabled
} from './shared/git-no-git';

export class GitRootDirWidget implements Widget {
    getDefaultColor(): string { return 'cyan'; }
    getDescription(): string { return 'Shows the git repository root directory name'; }
    getDisplayName(): string { return 'Git Root Dir'; }
    getCategory(): string { return 'Git'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return {
            displayText: this.getDisplayName(),
            modifierText: getHideNoGitModifierText(item)
        };
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        return handleToggleNoGitAction(action, item);
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        const hideNoGit = isHideNoGitEnabled(item) || item.metadata?.hideWhenEmpty === 'true';
        const fallbackToCwd = item.metadata?.fallbackToCwd === 'true';

        if (context.isPreview) {
            return item.rawValue ? 'my-repo' : 'Project: my-repo';
        }

        if (!isInsideGitWorkTree(context)) {
            const fallbackLabel = fallbackToCwd ? this.getFallbackPathLabel(context) : null;
            if (fallbackLabel) {
                return item.rawValue ? fallbackLabel : `Project: ${fallbackLabel}`;
            }
            return hideNoGit ? null : 'no git';
        }

        const rootDir = this.getGitRootDir(context);
        if (rootDir) {
            const rootDirName = this.getRootDirName(rootDir);
            return item.rawValue ? rootDirName : `Project: ${rootDirName}`;
        }

        const fallbackLabel = fallbackToCwd ? this.getFallbackPathLabel(context) : null;
        if (fallbackLabel) {
            return item.rawValue ? fallbackLabel : `Project: ${fallbackLabel}`;
        }

        return hideNoGit ? null : 'no git';
    }

    private getGitRootDir(context: RenderContext): string | null {
        return runGit('rev-parse --show-toplevel', context);
    }

    private getRootDirName(rootDir: string): string {
        const trimmedRootDir = rootDir.replace(/[\\/]+$/, '');
        const normalizedRootDir = trimmedRootDir.length > 0 ? trimmedRootDir : rootDir;
        const parts = normalizedRootDir.split(/[\\/]/).filter(Boolean);
        const lastPart = parts[parts.length - 1];
        return lastPart && lastPart.length > 0 ? lastPart : normalizedRootDir;
    }

    private getFallbackPathLabel(context: RenderContext): string | null {
        const projectDir = context.data?.workspace?.project_dir;
        if (projectDir && projectDir.trim().length > 0) {
            return this.getRootDirName(projectDir);
        }

        const cwd = context.data?.workspace?.current_dir ?? context.data?.cwd;
        if (cwd && cwd.trim().length > 0) {
            return this.getRootDirName(cwd);
        }

        return null;
    }

    getCustomKeybinds(): CustomKeybind[] {
        return getHideNoGitKeybinds();
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}