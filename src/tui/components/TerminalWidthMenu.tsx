import {
    Box,
    Text,
    useInput
} from 'ink';
import React, { useState } from 'react';

import type { FlexMode } from '../../types/FlexMode';
import type { Settings } from '../../types/Settings';
import { shouldInsertInput } from '../../utils/input-guards';
import {
    resolveTerminalWidth,
    type TerminalWidthProbeResult
} from '../../utils/terminal';

import {
    List,
    type ListEntry
} from './List';

export const TERMINAL_WIDTH_OPTIONS: FlexMode[] = ['responsive-stable', 'full', 'full-minus-40', 'full-until-compact'];
export type TerminalWidthMenuValue = FlexMode | 'fallback-width';

export function getTerminalWidthSelectionIndex(selectedOption: FlexMode): number {
    const selectedIndex = TERMINAL_WIDTH_OPTIONS.indexOf(selectedOption);

    return selectedIndex >= 0 ? selectedIndex : 0;
}

export function validateCompactThresholdInput(value: string): string | null {
    const parsedValue = parseInt(value, 10);

    if (isNaN(parsedValue)) {
        return 'Please enter a valid number';
    }

    if (parsedValue < 1 || parsedValue > 99) {
        return `Value must be between 1 and 99 (you entered ${parsedValue})`;
    }

    return null;
}

export function validateFallbackTerminalWidthInput(value: string): string | null {
    const parsedValue = parseInt(value, 10);

    if (isNaN(parsedValue)) {
        return 'Please enter a valid number';
    }

    if (parsedValue < 1 || parsedValue > 500) {
        return `Value must be between 1 and 500 (you entered ${parsedValue})`;
    }

    return null;
}

export function buildTerminalWidthItems(
    selectedOption: FlexMode,
    compactThreshold: number,
    fallbackTerminalWidth: number
): ListEntry<TerminalWidthMenuValue>[] {
    return [
        {
            value: 'responsive-stable',
            label: 'Responsive stable',
            sublabel: selectedOption === 'responsive-stable' ? '(recommended, active)' : '(recommended, default)',
            description: 'Recommended for terminal use. Recomputes the layout on every render using stable width tiers, while keeping temporary Claude UI messages off the main dashboard line. Narrow widths reserve 50%, medium widths reserve 30%, and wide widths reserve 20%.'
        },
        {
            value: 'full',
            label: 'Full width always',
            sublabel: selectedOption === 'full' ? '(active)' : undefined,
            description: 'Uses the measured or fallback width minus 6 characters. If Claude adds extra UI such as the auto-compact message, the line may still wrap.\n\nNOTE: If /ide integration is enabled, it is not recommended to use this mode.'
        },
        {
            value: 'full-minus-40',
            label: 'Full width minus 40',
            sublabel: selectedOption === 'full-minus-40' ? '(active)' : '(fixed reserve)',
            description: 'Leaves a fixed 40-character gap to the right of the status line to accommodate Claude UI such as the auto-compact message. This is predictable, but can waste space on wider terminals and still feel cramped on narrower ones.'
        },
        {
            value: 'full-until-compact',
            label: 'Full width until compact',
            sublabel: selectedOption === 'full-until-compact'
                ? `(threshold ${compactThreshold}%, active)`
                : `(threshold ${compactThreshold}%)`,
            description: `Dynamically switches between a 6-character reserve and a 40-character reserve based on context usage. When context reaches ${compactThreshold}%, it switches to the larger reserve.\n\nNOTE: If /ide integration is enabled, it is not recommended to use this mode.`
        },
        {
            value: 'fallback-width',
            label: 'Fallback width',
            sublabel: `(${fallbackTerminalWidth} cols)`,
            description: 'Used when the live Claude hook cannot measure width reliably. Preview and live wrapping will both use this width until a reliable measurement is available.'
        }
    ];
}

export interface TerminalWidthMenuProps {
    settings: Settings;
    statuslineWidthProbe?: TerminalWidthProbeResult;
    onUpdate: (settings: Settings) => void;
    onBack: () => void;
}

export const TerminalWidthMenu: React.FC<TerminalWidthMenuProps> = ({
    settings,
    statuslineWidthProbe,
    onUpdate,
    onBack
}) => {
    const [selectedOption, setSelectedOption] = useState<FlexMode>(settings.flexMode);
    const [compactThreshold, setCompactThreshold] = useState(settings.compactThreshold);
    const [fallbackTerminalWidth, setFallbackTerminalWidth] = useState(settings.fallbackTerminalWidth);
    const [editingField, setEditingField] = useState<'threshold' | 'fallback-width' | null>(null);
    const [thresholdInput, setThresholdInput] = useState(String(settings.compactThreshold));
    const [fallbackWidthInput, setFallbackWidthInput] = useState(String(settings.fallbackTerminalWidth));
    const [validationError, setValidationError] = useState<string | null>(null);

    const resolvedStatuslineWidth = resolveTerminalWidth(
        statuslineWidthProbe ?? { width: null, source: 'unavailable', reliable: false },
        fallbackTerminalWidth
    );
    const widthSourceLabel = statuslineWidthProbe?.source === 'stdout-columns'
        ? 'stdout columns'
        : statuslineWidthProbe?.source === 'tty-probe'
            ? 'tty probe'
            : statuslineWidthProbe?.source === 'tput'
                ? 'tput estimate'
                : 'fallback';

    useInput((input, key) => {
        if (editingField) {
            if (key.return) {
                const isEditingThreshold = editingField === 'threshold';
                const inputValue = isEditingThreshold ? thresholdInput : fallbackWidthInput;
                const error = isEditingThreshold
                    ? validateCompactThresholdInput(inputValue)
                    : validateFallbackTerminalWidthInput(inputValue);

                if (error) {
                    setValidationError(error);
                } else {
                    const value = parseInt(inputValue, 10);
                    const updatedSettings = isEditingThreshold
                        ? {
                            ...settings,
                            flexMode: selectedOption,
                            compactThreshold: value,
                            fallbackTerminalWidth
                        }
                        : {
                            ...settings,
                            flexMode: selectedOption,
                            compactThreshold,
                            fallbackTerminalWidth: value
                        };

                    if (isEditingThreshold) {
                        setCompactThreshold(value);
                    } else {
                        setFallbackTerminalWidth(value);
                    }

                    onUpdate(updatedSettings);
                    setEditingField(null);
                    setValidationError(null);
                }
            } else if (key.escape) {
                setThresholdInput(String(compactThreshold));
                setFallbackWidthInput(String(fallbackTerminalWidth));
                setEditingField(null);
                setValidationError(null);
            } else if (key.backspace) {
                if (editingField === 'threshold') {
                    setThresholdInput(thresholdInput.slice(0, -1));
                } else {
                    setFallbackWidthInput(fallbackWidthInput.slice(0, -1));
                }
                setValidationError(null);
            } else if (key.delete) {
                // For simple number inputs, forward delete does nothing since there's no cursor position
            } else if (shouldInsertInput(input, key) && /\d/.test(input)) {
                const currentValue = editingField === 'threshold' ? thresholdInput : fallbackWidthInput;
                const newValue = currentValue + input;
                if (editingField === 'threshold' && newValue.length <= 2) {
                    setThresholdInput(newValue);
                    setValidationError(null);
                } else if (editingField === 'fallback-width' && newValue.length <= 3) {
                    setFallbackWidthInput(newValue);
                    setValidationError(null);
                }
            }
            return;
        }

        if (key.escape) {
            onBack();
        }
    });

    return (
        <Box flexDirection='column'>
            <Text bold>Terminal Width</Text>
            <Text color='white'>These settings affect where long lines are truncated, and where right-alignment occurs when using flex separators</Text>
            <Text dimColor wrap='wrap'>Claude Code does not currently provide a reliable available-width variable for the statusline hook, so live rendering uses either a measured hook width or your configured fallback width.</Text>
            <Text dimColor>
                {resolvedStatuslineWidth.reliable
                    ? `Live hook width: ${resolvedStatuslineWidth.width} columns via ${widthSourceLabel}.`
                    : `Live hook width: estimated from fallback ${resolvedStatuslineWidth.width} columns (${widthSourceLabel}).`}
            </Text>

            {editingField ? (
                <Box marginTop={1} flexDirection='column'>
                    <Text>
                        {editingField === 'threshold'
                            ? 'Enter compact threshold (1-99):'
                            : 'Enter fallback width (1-500 columns):'}
                        {' '}
                        {editingField === 'threshold' ? thresholdInput : fallbackWidthInput}
                        {editingField === 'threshold' ? '%' : ''}
                    </Text>
                    {validationError ? (
                        <Text color='red'>{validationError}</Text>
                    ) : (
                        <Text dimColor>Press Enter to confirm, ESC to cancel</Text>
                    )}
                </Box>
            ) : (
                <List
                    marginTop={1}
                    items={buildTerminalWidthItems(selectedOption, compactThreshold, fallbackTerminalWidth)}
                    initialSelection={getTerminalWidthSelectionIndex(selectedOption)}
                    onSelect={(value) => {
                        if (value === 'back') {
                            onBack();
                            return;
                        }

                        if (value === 'fallback-width') {
                            setFallbackWidthInput(String(fallbackTerminalWidth));
                            setValidationError(null);
                            setEditingField('fallback-width');
                            return;
                        }

                        setSelectedOption(value);

                        const updatedSettings = {
                            ...settings,
                            flexMode: value,
                            compactThreshold,
                            fallbackTerminalWidth
                        };
                        onUpdate(updatedSettings);

                        if (value === 'full-until-compact') {
                            setThresholdInput(String(compactThreshold));
                            setValidationError(null);
                            setEditingField('threshold');
                        }
                    }}
                    showBackButton={true}
                />
            )}
        </Box>
    );
};