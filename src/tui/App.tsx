import {
    Box,
    Text,
    render,
    useApp,
    useInput
} from 'ink';
import Gradient from 'ink-gradient';
import React, {
    useCallback,
    useEffect,
    useState
} from 'react';

import {
    CCSTATUSLINE_COMMANDS,
    getClaudeSettingsPath,
    getExistingStatusLine,
    installStatusLine,
    isBunxAvailable,
    isInstalled,
    isKnownCommand,
    uninstallStatusLine
} from '../utils/claude-settings';
import { openExternalUrl } from '../utils/open-url';
import { getPackageVersion } from '../utils/terminal';

import {
    ConfirmDialog,
    InstallMenu,
    MainMenu,
    type MainMenuOption
} from './components';

const GITHUB_REPO_URL = 'https://github.com/Jaredw2289-svg/ccdash';

interface FlashMessage {
    text: string;
    color: 'green' | 'red';
}

type AppScreen = 'main' | 'confirm' | 'install';

interface ConfirmDialogState {
    message: string;
    action: () => Promise<void>;
    cancelScreen?: Exclude<AppScreen, 'confirm'>;
}

export function getConfirmCancelScreen(confirmDialog: ConfirmDialogState | null): Exclude<AppScreen, 'confirm'> {
    return confirmDialog?.cancelScreen ?? 'main';
}

export function clearInstallMenuSelection(menuSelections: Record<string, number>): Record<string, number> {
    if (menuSelections.install === undefined) {
        return menuSelections;
    }

    const next = { ...menuSelections };
    delete next.install;
    return next;
}

export const App: React.FC = () => {
    const { exit } = useApp();
    const [screen, setScreen] = useState<AppScreen>('main');
    const [menuSelections, setMenuSelections] = useState<Record<string, number>>({});
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
    const [isClaudeInstalled, setIsClaudeInstalled] = useState(false);
    const [existingStatusLine, setExistingStatusLine] = useState<string | null>(null);
    const [flashMessage, setFlashMessage] = useState<FlashMessage | null>(null);

    useEffect(() => {
        void getExistingStatusLine().then(setExistingStatusLine);
        void isInstalled().then(setIsClaudeInstalled);
    }, []);

    useEffect(() => {
        if (flashMessage) {
            const timer = setTimeout(() => {
                setFlashMessage(null);
            }, 2000);
            return () => { clearTimeout(timer); };
        }
    }, [flashMessage]);

    useInput((input, key) => {
        if (key.ctrl && input === 'c') {
            exit();
        }
    });

    const handleInstallSelection = useCallback((command: string, displayName: string, useBunx: boolean) => {
        void getExistingStatusLine().then((existing) => {
            const isAlreadyInstalled = isKnownCommand(existing ?? '');
            let message: string;

            if (existing && !isAlreadyInstalled) {
                message = `This will modify ${getClaudeSettingsPath()}\n\nA status line is already configured: "${existing}"\nReplace it with ${command}?`;
            } else if (isAlreadyInstalled) {
                message = `dashcc is already installed in ${getClaudeSettingsPath()}\nUpdate it with ${command}?`;
            } else {
                message = `This will modify ${getClaudeSettingsPath()} to add dashcc with ${displayName}.\nContinue?`;
            }

            setConfirmDialog({
                message,
                cancelScreen: 'install',
                action: async () => {
                    await installStatusLine(useBunx);
                    setIsClaudeInstalled(true);
                    setExistingStatusLine(command);
                    setScreen('main');
                    setConfirmDialog(null);
                    setFlashMessage({
                        text: '✓ Installed successfully',
                        color: 'green'
                    });
                }
            });
            setScreen('confirm');
        });
    }, []);

    const handleNpxInstall = useCallback(() => {
        setMenuSelections(prev => ({ ...prev, install: 0 }));
        handleInstallSelection(CCSTATUSLINE_COMMANDS.NPM, 'npx', false);
    }, [handleInstallSelection]);

    const handleBunxInstall = useCallback(() => {
        setMenuSelections(prev => ({ ...prev, install: 1 }));
        handleInstallSelection(CCSTATUSLINE_COMMANDS.BUNX, 'bunx', true);
    }, [handleInstallSelection]);

    const handleInstallMenuCancel = useCallback(() => {
        setMenuSelections(clearInstallMenuSelection);
        setScreen('main');
    }, []);

    const handleUninstall = () => {
        setConfirmDialog({
            message: `This will remove dashcc from ${getClaudeSettingsPath()}. Continue?`,
            action: async () => {
                await uninstallStatusLine();
                setIsClaudeInstalled(false);
                setExistingStatusLine(null);
                setScreen('main');
                setConfirmDialog(null);
                setFlashMessage({
                    text: '✓ Uninstalled successfully',
                    color: 'green'
                });
            }
        });
        setScreen('confirm');
    };

    const handleMainMenuSelect = (value: MainMenuOption) => {
        switch (value) {
            case 'install':
                setScreen('install');
                break;
            case 'uninstall':
                handleUninstall();
                break;
            case 'starGithub':
                setConfirmDialog({
                    message: `Open the dashcc GitHub repository in your browser?\n\n${GITHUB_REPO_URL}`,
                    action: () => {
                        const result = openExternalUrl(GITHUB_REPO_URL);
                        if (result.success) {
                            setFlashMessage({
                                text: '✓ Opened GitHub repository in browser',
                                color: 'green'
                            });
                        } else {
                            setFlashMessage({
                                text: `✗ Could not open browser. Visit: ${GITHUB_REPO_URL}`,
                                color: 'red'
                            });
                        }
                        setScreen('main');
                        setConfirmDialog(null);
                        return Promise.resolve();
                    }
                });
                setScreen('confirm');
                break;
            case 'exit':
                exit();
                break;
        }
    };

    return (
        <Box flexDirection='column'>
            <Box marginBottom={1}>
                <Text bold>
                    <Gradient name='retro'>
                        dashcc
                    </Gradient>
                </Text>
                <Text bold>
                    {` | ${getPackageVersion() && `v${getPackageVersion()}`}`}
                </Text>
                {flashMessage && (
                    <Text color={flashMessage.color} bold>
                        {`  ${flashMessage.text}`}
                    </Text>
                )}
            </Box>

            <Box marginTop={1}>
                {screen === 'main' && (
                    <MainMenu
                        onSelect={(value, index) => {
                            if (value !== 'exit') {
                                setMenuSelections(prev => ({ ...prev, main: index }));
                            }

                            handleMainMenuSelect(value);
                        }}
                        isClaudeInstalled={isClaudeInstalled}
                        initialSelection={menuSelections.main}
                    />
                )}
                {screen === 'confirm' && confirmDialog && (
                    <ConfirmDialog
                        message={confirmDialog.message}
                        onConfirm={() => void confirmDialog.action()}
                        onCancel={() => {
                            setScreen(getConfirmCancelScreen(confirmDialog));
                            setConfirmDialog(null);
                        }}
                    />
                )}
                {screen === 'install' && (
                    <InstallMenu
                        bunxAvailable={isBunxAvailable()}
                        existingStatusLine={existingStatusLine}
                        onSelectNpx={handleNpxInstall}
                        onSelectBunx={handleBunxInstall}
                        onCancel={handleInstallMenuCancel}
                        initialSelection={menuSelections.install}
                    />
                )}
            </Box>
        </Box>
    );
};

export function runTUI() {
    process.stdout.write('\x1b[2J\x1b[H');
    render(<App />);
}