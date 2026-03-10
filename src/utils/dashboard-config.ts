import type { WidgetItem } from '../types/Widget';

export const LEGACY_DASHBOARD_PRESET: WidgetItem[][] = [
    [
        { id: '1', type: 'model', rawValue: true, color: 'cyan' },
        { id: '2', type: 'separator' },
        { id: '3', type: 'output-style', rawValue: true, color: 'gray' },
        { id: '4', type: 'separator' },
        { id: '5', type: 'session-clock', rawValue: true, color: 'yellow' },
        { id: '6', type: 'separator' },
        { id: '7', type: 'session-cost', rawValue: false, color: 'green' },
        { id: '8', type: 'separator' },
        { id: '9', type: 'context-bar', rawValue: true, color: 'green', metadata: { display: 'progress-short', colorCoded: 'true' } }
    ],
    [
        { id: '10', type: 'session-usage', color: 'brightBlue', metadata: { display: 'progress-short', colorCoded: 'true', showReset: 'true' } },
        { id: '11', type: 'separator' },
        { id: '12', type: 'weekly-usage', color: 'magenta', metadata: { display: 'progress-short', showReset: 'true' } }
    ],
    [
        { id: '13', type: 'current-working-dir', rawValue: true, color: 'blue', metadata: { segments: '1' } },
        { id: '14', type: 'separator' },
        { id: '15', type: 'status-summary', rawValue: true, color: 'white', maxWidth: 120, metadata: { source: 'first-human' } }
    ],
    [
        { id: '16', type: 'status-summary', rawValue: true, color: 'gray', maxWidth: 120, metadata: { source: 'session-overview' } }
    ]
];

export const DASHBOARD_PRESET: WidgetItem[][] = [
    [
        { id: '1', type: 'model', rawValue: true, color: 'hex:7DB4C0' },
        { id: '3', type: 'output-style', rawValue: false, color: 'hex:7E8594', metadata: { hideWhenDefault: 'true' } },
        { id: '5', type: 'session-clock', rawValue: true, color: 'hex:D7A65F' },
        { id: '7', type: 'session-cost', rawValue: false, color: 'hex:8FB57A' },
        { id: '9', type: 'context-bar', rawValue: true, color: 'hex:6FAF8F', metadata: { display: 'progress-short', colorCoded: 'true' } }
    ],
    [
        { id: '10', type: 'session-usage', color: 'hex:6FA7C9', metadata: { display: 'progress-short', colorCoded: 'false', showReset: 'true' } },
        { id: '12', type: 'weekly-usage', color: 'hex:B88B73', metadata: { display: 'progress-short', colorCoded: 'false', showReset: 'true' } }
    ],
    [
        { id: '13', type: 'git-root-dir', rawValue: true, color: 'hex:7DB4C0', metadata: { hideWhenEmpty: 'true', fallbackToCwd: 'true' } },
        { id: '15', type: 'status-summary', rawValue: false, color: 'hex:E3DDD2', maxWidth: 120, metadata: { source: 'goal' } }
    ],
    [
        { id: '16', type: 'status-summary', rawValue: false, color: 'hex:63B7A4', maxWidth: 120, metadata: { source: 'last-conclusion' } }
    ]
];