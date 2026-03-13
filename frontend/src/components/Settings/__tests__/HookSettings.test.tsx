import { useMutation, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HookSettings from '../HookSettings';

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => {
        const translations: Record<string, string> = {
            taskHooks: 'Task Hooks',
            taskHooksDescription: 'Execute declarative hook actions at specific points in the task lifecycle.',
            taskHooksWarning: 'Only allowlisted hook actions are supported.',
            legacyTaskHooksDescription: 'Legacy mode supports declarative JSON hooks and legacy shell scripts for each task event.',
            legacyHookShellWarning: 'Legacy mode accepts .json hooks and .sh scripts.',
            hookTaskBeforeStart: 'Before Task Start',
            hookTaskBeforeStartHelper: 'Executes before the download begins.',
            hookTaskSuccess: 'Task Success',
            hookTaskSuccessHelper: 'Executes after successful download.',
            hookTaskFail: 'Task Failed',
            hookTaskFailHelper: 'Executes when a task fails.',
            hookTaskCancel: 'Task Cancelled',
            hookTaskCancelHelper: 'Executes when a task is manually cancelled.',
            hookGuideButton: 'JSON Hook Guide',
            hookGuideTitle: 'How JSON Hooks Run',
            hookGuideIntro: 'JSON hooks are declarative definitions.',
            hookGuideLegacyShellNote: 'Legacy mode also supports .sh hooks.',
            hookGuideExecutionTitle: 'Execution Flow',
            hookGuideExecutionQueue: 'Event -> queue -> restricted executor. Hooks do not run arbitrary shell commands.',
            hookGuideExecutionSerial: 'Actions inside one hook are executed serially in the order they appear in the JSON file.',
            hookGuideExecutionValidation: 'Invalid JSON, unsupported action types, or disallowed fields are rejected before execution.',
            hookGuideEventsTitle: 'Available Events',
            hookGuideModesTitle: 'Execution Modes',
            hookGuideInlineMode: '`HOOK_EXECUTION_MODE=inline`: backend queues and executes the hook locally.',
            hookGuideWorkerMode: '`HOOK_EXECUTION_MODE=worker`: backend writes jobs to `hook_worker_jobs`, and a separate `hook-worker` process or container polls and executes them.',
            hookGuideActionTitle: 'Supported Action',
            hookGuideActionBody: 'Currently only `notify_webhook` is supported.',
            hookGuideActionDetails: '`method` may be `POST`, `PUT`, or `PATCH`.',
            hookGuideVariablesTitle: 'Template Variables',
            hookGuideTemplateFallback: 'If you do not provide `bodyTemplate`, the webhook receives these fields as JSON plus `emittedAt`.',
            hookGuideExampleTitle: 'Example JSON',
            found: 'Found',
            notFound: 'Not Set',
            uploadLegacyHook: 'Upload .json or .sh',
            uploadHook: 'Upload .json',
            close: 'Close'
        };

        return {
            t: (key: string) => translations[key] ?? key
        };
    }
}));

vi.mock('@tanstack/react-query', () => ({
    useQuery: vi.fn(),
    useMutation: vi.fn()
}));

vi.mock('../../ConfirmationModal', () => ({
    default: () => null
}));

vi.mock('../../PasswordModal', () => ({
    default: () => null
}));

describe('HookSettings', () => {
    const mockOnChange = vi.fn();
    const defaultSettings = {
        securityModel: 'legacy',
        highRiskFeaturesDisabled: {
            hooks: false
        }
    } as any;

    beforeEach(() => {
        vi.clearAllMocks();
        (useQuery as any).mockReturnValue({
            data: {
                task_before_start: true,
                task_success: false,
                task_fail: false,
                task_cancel: false
            },
            refetch: vi.fn(),
            isLoading: false
        });
        (useMutation as any).mockImplementation(() => ({
            mutate: vi.fn(),
            isPending: false
        }));
    });

    it('opens the JSON hook guide modal with execution details and example', async () => {
        const user = userEvent.setup();

        render(<HookSettings settings={defaultSettings} onChange={mockOnChange} />);

        await user.click(screen.getByRole('button', { name: 'JSON Hook Guide' }));

        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeInTheDocument();
        expect(screen.getByText('How JSON Hooks Run')).toBeInTheDocument();
        expect(screen.getByText('Legacy mode also supports .sh hooks.')).toBeInTheDocument();
        expect(screen.getByText('Execution Flow')).toBeInTheDocument();
        expect(screen.getByText(/Event -> queue -> restricted executor/)).toBeInTheDocument();
        expect(screen.getByText(/HOOK_EXECUTION_MODE=worker/)).toBeInTheDocument();
        expect(screen.getAllByText(/notify_webhook/).length).toBeGreaterThan(0);
        expect(screen.getAllByText('{{taskTitle}}').length).toBeGreaterThan(0);
        expect(screen.getByText('Example JSON')).toBeInTheDocument();
    });

    it('shows legacy upload label and warning copy', () => {
        render(<HookSettings settings={defaultSettings} onChange={mockOnChange} />);

        expect(screen.getByText('Legacy mode accepts .json hooks and .sh scripts.')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Upload .json or .sh' }).length).toBe(4);
    });

    it('closes the JSON hook guide modal', async () => {
        const user = userEvent.setup();

        render(<HookSettings settings={defaultSettings} onChange={mockOnChange} />);

        await user.click(screen.getByRole('button', { name: 'JSON Hook Guide' }));
        await user.click(screen.getByRole('button', { name: 'Close' }));

        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
    });
});
