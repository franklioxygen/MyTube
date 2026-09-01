import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SecuritySettings from '../SecuritySettings';
import { api } from '../../../utils/apiClient';
import type { GestureLoginStatus } from '../../../utils/gestureLogin';

vi.mock('../UserManagementSettings', () => ({
    default: () => <div data-testid="user-management-settings" />,
}));

vi.mock('../../Auth/GestureLoginSetupDialog', () => ({
    default: ({ open, mode }: { open: boolean; mode: string }) =>
        open ? <div data-testid="gesture-setup-dialog" data-mode={mode} /> : null,
}));

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../utils/apiClient', () => ({
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const STATUS: Record<string, GestureLoginStatus> = {
    unconfigured: {
        configured: false,
        canConfigure: true,
        locked: false,
        available: false,
        attemptsRemaining: null,
        resetRequired: false,
    },
    prerequisiteOff: {
        configured: false,
        canConfigure: false,
        locked: false,
        available: false,
        attemptsRemaining: null,
        resetRequired: false,
    },
    configured: {
        configured: true,
        canConfigure: true,
        locked: false,
        available: true,
        attemptsRemaining: 3,
        resetRequired: false,
    },
    locked: {
        configured: true,
        canConfigure: true,
        locked: true,
        available: false,
        attemptsRemaining: 0,
        resetRequired: false,
    },
    resetRequired: {
        configured: false,
        canConfigure: true,
        locked: false,
        available: false,
        attemptsRemaining: null,
        resetRequired: true,
    },
};

const BASE_SETTINGS: any = {
    loginEnabled: true,
    password: '',
    passwordLoginAllowed: true,
    apiKeyEnabled: false,
    apiKey: '',
    isPasswordSet: true,
    visitorUserEnabled: true,
};

let gestureResponse: { status?: GestureLoginStatus; reject?: boolean; pending?: boolean };
let passkeysExist = false;

const renderSettings = (settings: Partial<typeof BASE_SETTINGS> = {}) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onChange = vi.fn();
    const result = rtlRender(
        <QueryClientProvider client={queryClient}>
            <SecuritySettings settings={{ ...BASE_SETTINGS, ...settings }} onChange={onChange} />
        </QueryClientProvider>
    );
    return { ...result, onChange };
};

// MUI renders a Switch with role="switch", not role="checkbox".
const gestureSwitch = () => screen.getByRole('switch', { name: 'gestureLogin' });

beforeEach(() => {
    vi.clearAllMocks();
    gestureResponse = { status: STATUS.unconfigured };
    passkeysExist = false;

    vi.mocked(api.get).mockImplementation(async (url: string) => {
        if (url === '/settings/gesture-login/status') {
            if (gestureResponse.pending) return new Promise(() => {}) as any;
            if (gestureResponse.reject) throw new Error('status unavailable');
            return { data: gestureResponse.status } as any;
        }
        return { data: { exists: passkeysExist } } as any;
    });
    vi.mocked(api.delete).mockResolvedValue({ data: { success: true } } as any);

    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
});

describe('toggle state', () => {
    it('is off and enabled when nothing is configured and prerequisites hold', async () => {
        renderSettings();

        await waitFor(() => expect(gestureSwitch()).not.toBeDisabled());
        expect(gestureSwitch()).not.toBeChecked();
    });

    it('is disabled while the persisted prerequisite is off', async () => {
        gestureResponse = { status: STATUS.prerequisiteOff };
        renderSettings();

        await waitFor(() =>
            expect(screen.getByTestId('gesture-save-first-hint')).toBeTruthy()
        );
        expect(gestureSwitch()).toBeDisabled();
    });

    it('is disabled when the prerequisite is only true in the unsaved draft', async () => {
        // Persisted status says it can configure, but the admin has locally
        // switched password login off; enrolling would conflict on save.
        renderSettings({ passwordLoginAllowed: false });

        await waitFor(() =>
            expect(screen.getByTestId('gesture-prerequisite-hint')).toBeTruthy()
        );
        expect(gestureSwitch()).toBeDisabled();
    });

    it('is on when a credential is configured', async () => {
        gestureResponse = { status: STATUS.configured };
        renderSettings();

        await waitFor(() => expect(gestureSwitch()).toBeChecked());
        expect(screen.getByTestId('gesture-change-button')).toBeTruthy();
    });
});

describe('unknown status', () => {
    it('never renders an actionable OFF while the status is still loading', async () => {
        gestureResponse = { pending: true };
        renderSettings();

        await waitFor(() => expect(screen.getByTestId('gesture-status-loading')).toBeTruthy());
        // Rendering an enabled OFF here would invite enrolling against a state
        // that might already be configured.
        expect(gestureSwitch()).toBeDisabled();
    });

    it('offers a retry and stays disabled when the status request fails', async () => {
        gestureResponse = { reject: true };
        renderSettings();

        await waitFor(() => expect(screen.getByTestId('gesture-status-error')).toBeTruthy());
        expect(gestureSwitch()).toBeDisabled();

        gestureResponse = { status: STATUS.configured };
        await userEvent.click(screen.getByRole('button', { name: 'gestureLoginRetryStatus' }));
        await waitFor(() => expect(gestureSwitch()).toBeChecked());
    });
});

describe('locked credential', () => {
    it('stays checked, blocks Change, and explains the recovery path', async () => {
        gestureResponse = { status: STATUS.locked };
        renderSettings();

        await waitFor(() => expect(screen.getByTestId('gesture-locked-hint')).toBeTruthy());
        expect(gestureSwitch()).toBeChecked();
        // Locked is not unconfigured: the credential is still there.
        expect(screen.queryByTestId('gesture-change-button')).toBeNull();
        // Removal stays available, since it removes rather than unlocks.
        expect(gestureSwitch()).not.toBeDisabled();
    });
});

describe('reset-required credential', () => {
    it('offers a fresh setup instead of the normal switch action', async () => {
        gestureResponse = { status: STATUS.resetRequired };
        renderSettings();

        await waitFor(() => expect(screen.getByTestId('gesture-reset-required')).toBeTruthy());
        expect(gestureSwitch()).not.toBeChecked();

        await userEvent.click(screen.getByRole('button', { name: 'gestureLoginSetNew' }));
        expect(screen.getByTestId('gesture-setup-dialog').getAttribute('data-mode')).toBe('change');
    });
});

describe('mutations', () => {
    it('opens the setup dialog on OFF to ON and sends nothing yet', async () => {
        renderSettings();
        await waitFor(() => expect(gestureSwitch()).not.toBeDisabled());

        await userEvent.click(gestureSwitch());

        expect(screen.getByTestId('gesture-setup-dialog').getAttribute('data-mode')).toBe('create');
        expect(api.put).not.toHaveBeenCalled();
        // The switch stays off until the server confirms.
        expect(gestureSwitch()).not.toBeChecked();
    });

    it('confirms before deleting on ON to OFF', async () => {
        gestureResponse = { status: STATUS.configured };
        renderSettings();
        await waitFor(() => expect(gestureSwitch()).toBeChecked());

        await userEvent.click(gestureSwitch());
        expect(api.delete).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: 'remove' }));
        await waitFor(() =>
            expect(api.delete).toHaveBeenCalledWith('/settings/gesture-login')
        );
    });

    it('leaves the credential alone when the removal is cancelled', async () => {
        gestureResponse = { status: STATUS.configured };
        renderSettings();
        await waitFor(() => expect(gestureSwitch()).toBeChecked());

        await userEvent.click(gestureSwitch());
        await userEvent.click(screen.getByRole('button', { name: 'cancel' }));

        expect(api.delete).not.toHaveBeenCalled();
        // The open dialog hides the background from the a11y tree, so wait for
        // it to close before asserting the switch is untouched.
        await waitFor(() => expect(gestureSwitch()).toBeChecked());
    });

    it('opens replacement mode from Change Gesture', async () => {
        gestureResponse = { status: STATUS.configured };
        renderSettings();
        await waitFor(() => expect(screen.getByTestId('gesture-change-button')).toBeTruthy());

        await userEvent.click(screen.getByTestId('gesture-change-button'));

        expect(screen.getByTestId('gesture-setup-dialog').getAttribute('data-mode')).toBe('change');
    });
});

describe('password login dependency', () => {
    it('blocks turning password login off while a gesture exists', async () => {
        // A passkey must exist, or the switch is already disabled for the
        // unrelated pre-existing reason and the assertion proves nothing.
        passkeysExist = true;
        gestureResponse = { status: STATUS.configured };
        renderSettings();

        await waitFor(() => expect(screen.getByTestId('gesture-blocks-password-login')).toBeTruthy());
        expect(screen.getByRole('switch', { name: 'allowPasswordLogin' })).toBeDisabled();
    });

    it('leaves password login switchable once no gesture is configured', async () => {
        passkeysExist = true;
        renderSettings();

        await waitFor(() => expect(gestureSwitch()).not.toBeDisabled());
        expect(screen.queryByTestId('gesture-blocks-password-login')).toBeNull();
        expect(screen.getByRole('switch', { name: 'allowPasswordLogin' })).not.toBeDisabled();
    });
});
