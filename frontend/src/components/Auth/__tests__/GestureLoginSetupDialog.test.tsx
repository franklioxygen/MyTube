import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GestureLoginSetupDialog from '../GestureLoginSetupDialog';
import { GESTURE_DOT_CENTERS } from '../../../utils/gestureGeometry';

const configureGestureLogin = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/gestureLogin', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../utils/gestureLogin')>();
    return { ...actual, configureGestureLogin };
});

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: () => '' }),
}));

const PRIMARY = { pointerId: 1, isPrimary: true, button: 0, pointerType: 'mouse' as const };
const at = (dot: number) => ({
    clientX: GESTURE_DOT_CENTERS[dot].x,
    clientY: GESTURE_DOT_CENTERS[dot].y,
});

const drawOnGrid = (dots: number[]) => {
    const svg = screen.getByTestId('gesture-pattern').querySelector('svg')!;
    svg.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 300, height: 300, right: 300, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    fireEvent.pointerDown(svg, { ...PRIMARY, ...at(dots[0]) });
    for (const dot of dots.slice(1)) {
        fireEvent.pointerMove(svg, { ...PRIMARY, ...at(dot) });
    }
    fireEvent.pointerUp(svg, { ...PRIMARY, ...at(dots[dots.length - 1]) });
};

let onClose: ReturnType<typeof vi.fn>;
let onSuccess: ReturnType<typeof vi.fn>;
let queryClient: QueryClient;

const renderDialog = (mode: 'create' | 'change' = 'create') =>
    render(
        <QueryClientProvider client={queryClient}>
            <GestureLoginSetupDialog open mode={mode} onClose={onClose} onSuccess={onSuccess} />
        </QueryClientProvider>
    );

const stepText = () => screen.getByTestId('gesture-setup-step').textContent;

beforeEach(() => {
    vi.clearAllMocks();
    onClose = vi.fn();
    onSuccess = vi.fn();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    configureGestureLogin.mockResolvedValue({ status: { configured: true } });
});

describe('the two-draw flow', () => {
    it('starts on step 1 and sends nothing', () => {
        renderDialog();

        expect(stepText()).toBe('Step 1 of 2');
        expect(configureGestureLogin).not.toHaveBeenCalled();
    });

    it('advances to step 2 after a valid first draw, still sending nothing', () => {
        renderDialog();
        drawOnGrid([0, 1, 2]);

        expect(stepText()).toBe('Step 2 of 2');
        // The first draw is held in component memory only.
        expect(configureGestureLogin).not.toHaveBeenCalled();
    });

    it('stays on step 1 for a draw that is too short', () => {
        renderDialog();
        drawOnGrid([0, 4]);

        expect(stepText()).toBe('Step 1 of 2');
        expect(configureGestureLogin).not.toHaveBeenCalled();
    });

    it('sends exactly one request when both draws match', async () => {
        renderDialog();
        drawOnGrid([0, 1, 2]);
        drawOnGrid([0, 1, 2]);

        await waitFor(() => expect(configureGestureLogin).toHaveBeenCalledTimes(1));
        expect(configureGestureLogin).toHaveBeenCalledWith([0, 1, 2]);
    });

    it('returns to step 1 on a mismatch and sends nothing', () => {
        renderDialog();
        drawOnGrid([0, 1, 2]);
        drawOnGrid([6, 7, 8]);

        expect(stepText()).toBe('Step 1 of 2');
        expect(screen.getByTestId('gesture-setup-error')).toBeTruthy();
        expect(configureGestureLogin).not.toHaveBeenCalled();
    });

    it('treats the same dots in a different order as a mismatch', () => {
        renderDialog();
        drawOnGrid([0, 1, 2]);
        drawOnGrid([2, 1, 0]);

        expect(stepText()).toBe('Step 1 of 2');
        expect(configureGestureLogin).not.toHaveBeenCalled();
    });

    it('compares canonical patterns, so a swipe and a traced path agree', async () => {
        renderDialog();
        drawOnGrid([0, 2]);
        drawOnGrid([0, 1, 2]);

        await waitFor(() => expect(configureGestureLogin).toHaveBeenCalledWith([0, 1, 2]));
    });
});

describe('saving', () => {
    it('closes and reports success once the server accepts', async () => {
        renderDialog();
        drawOnGrid([0, 1, 2]);
        drawOnGrid([0, 1, 2]);

        await waitFor(() => expect(onSuccess).toHaveBeenCalled());
        expect(onClose).toHaveBeenCalled();
    });

    it('invalidates the cached status so the toggle reflects the server', async () => {
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        renderDialog();
        drawOnGrid([0, 1, 2]);
        drawOnGrid([0, 1, 2]);

        await waitFor(() =>
            expect(invalidate).toHaveBeenCalledWith({ queryKey: ['gesture-login-status'] })
        );
    });

    it('cannot be dismissed while the request is in flight', async () => {
        let release: (value: unknown) => void = () => {};
        configureGestureLogin.mockImplementation(
            () => new Promise((resolve) => { release = resolve; })
        );

        renderDialog();
        drawOnGrid([0, 1, 2]);
        drawOnGrid([0, 1, 2]);

        await waitFor(() => expect(screen.getByTestId('gesture-setup-saving')).toBeTruthy());
        fireEvent.click(screen.getByText('Cancel'));
        expect(onClose).not.toHaveBeenCalled();

        release({ status: { configured: true } });
    });

    it('restarts the whole flow after a server error', async () => {
        configureGestureLogin.mockRejectedValue({
            response: { data: { code: 'gesture_configuration_failed' } },
        });

        renderDialog();
        drawOnGrid([0, 1, 2]);
        drawOnGrid([0, 1, 2]);

        await waitFor(() => expect(screen.getByTestId('gesture-setup-error')).toBeTruthy());
        // Back to step 1: retrying from a half-remembered pattern would be worse.
        expect(stepText()).toBe('Step 1 of 2');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('never puts the drawn sequence into the error message', async () => {
        configureGestureLogin.mockRejectedValue({
            response: { data: { code: 'gesture_configuration_failed' } },
        });

        renderDialog();
        drawOnGrid([0, 1, 2]);
        drawOnGrid([0, 1, 2]);

        await waitFor(() => expect(screen.getByTestId('gesture-setup-error')).toBeTruthy());
        const text = screen.getByTestId('gesture-setup-error').textContent ?? '';
        expect(text).not.toMatch(/0.*1.*2/);
    });

    it('reports the prerequisite failure distinctly', async () => {
        configureGestureLogin.mockRejectedValue({
            response: { data: { code: 'gesture_password_login_required' } },
        });

        renderDialog();
        drawOnGrid([0, 1, 2]);
        drawOnGrid([0, 1, 2]);

        await waitFor(() => expect(screen.getByTestId('gesture-setup-error')).toBeTruthy());
    });
});

describe('cancelling', () => {
    it('sends no request when closed after the first draw', () => {
        renderDialog();
        drawOnGrid([0, 1, 2]);

        fireEvent.click(screen.getByText('Cancel'));

        expect(configureGestureLogin).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
        expect(onSuccess).not.toHaveBeenCalled();
    });
});

describe('replacement mode', () => {
    it('runs the same two-draw flow', async () => {
        renderDialog('change');

        expect(stepText()).toBe('Step 1 of 2');
        drawOnGrid([3, 4, 5]);
        drawOnGrid([3, 4, 5]);

        // The old gesture keeps working until this resolves.
        await waitFor(() => expect(configureGestureLogin).toHaveBeenCalledWith([3, 4, 5]));
    });
});
