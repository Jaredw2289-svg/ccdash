import {
    Box,
    Text
} from 'ink';
import React from 'react';

import { List } from './List';

export type MainMenuOption = 'install'
    | 'uninstall'
    | 'starGithub'
    | 'exit';

export interface MainMenuProps {
    onSelect: (value: MainMenuOption, index: number) => void;
    isClaudeInstalled: boolean;
    initialSelection?: number;
}

export const MainMenu: React.FC<MainMenuProps> = ({
    onSelect,
    isClaudeInstalled,
    initialSelection = 0
}) => {
    const menuItems: ({
        label: string;
        sublabel?: string;
        value: MainMenuOption;
        description: string;
    } | '-')[] = [
        {
            label: isClaudeInstalled ? '📦 Reinstall / Update' : '📦 Install to Claude Code',
            sublabel: isClaudeInstalled ? '(already installed)' : undefined,
            value: 'install',
            description: isClaudeInstalled
                ? 'Reinstall or update dashcc in your Claude Code settings'
                : 'Add dashcc to your Claude Code settings'
        },
        {
            label: '🔌 Uninstall from Claude Code',
            sublabel: isClaudeInstalled ? undefined : '(not installed)',
            value: 'uninstall',
            description: 'Remove dashcc from your Claude Code settings'
        },
        '-' as const,
        {
            label: '⭐ Star on GitHub',
            value: 'starGithub',
            description: 'Open the dashcc GitHub repository in your browser'
        },
        {
            label: '🚪 Exit',
            value: 'exit',
            description: 'Exit'
        }
    ];

    return (
        <Box flexDirection='column'>
            <Text bold>Main Menu</Text>

            <List
                items={menuItems}
                marginTop={1}
                onSelect={(value, index) => {
                    if (value === 'back') {
                        return;
                    }

                    onSelect(value, index);
                }}
                initialSelection={initialSelection}
            />
        </Box>
    );
};