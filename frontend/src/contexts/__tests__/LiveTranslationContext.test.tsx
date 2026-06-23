import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi, Mock } from 'vitest';
import {
    LiveTranslationProvider,
    useLiveTranslationControl,
} from '../LiveTranslationContext';
import { useLiveTranslationAvailability } from '../../hooks/useLiveTranslationAvailability';
import { useLiveTranslationSession } from '../../hooks/useLiveTranslationSession';
import {
    isAudioCaptureSupported,
    isSecureContextForCapture,
} from '../../hooks/useLiveTranslationAudioCapture';

vi.mock('../LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock('../../hooks/useLiveTranslationAvailability', () => ({
    useLiveTranslationAvailability: vi.fn(),
}));
vi.mock('../../hooks/useLiveTranslationSession', () => ({
    useLiveTranslationSession: vi.fn(),
}));
vi.mock('../../hooks/useLiveTranslationAudioCapture', () => ({
    isAudioCaptureSupported: vi.fn(() => true),
    isSecureContextForCapture: vi.fn(() => true),
    useLiveTranslationAudioCapture: () => ({}),
}));
vi.mock('../../utils/mediaOrigin', () => ({
    isCaptureSupportedForSrc: () => true,
}));

const mockAvailability = useLiveTranslationAvailability as unknown as Mock;
const mockSession = useLiveTranslationSession as unknown as Mock;
const mockAudioSupported = isAudioCaptureSupported as unknown as Mock;
const mockSecureContext = isSecureContextForCapture as unknown as Mock;

function setAvailability(overrides: Record<string, unknown> = {}) {
    mockAvailability.mockReturnValue({
        data: {
            enabled: true,
            available: true,
            canUse: true,
            model: 'gemini',
            sourceLanguage: 'auto',
            targetLanguage: 'en',
            apiKeyConfigured: true,
            requiresAdmin: false,
            reason: null,
            ...overrides,
        },
    });
}

function setSession(overrides: Record<string, unknown> = {}) {
    const start = vi.fn();
    const stop = vi.fn();
    mockSession.mockReturnValue({
        status: 'idle',
        isActive: false,
        errorCode: null,
        errorMessage: null,
        retryable: false,
        start,
        stop,
        ...overrides,
    });
    return { start, stop };
}

const Probe: React.FC = () => {
    const control = useLiveTranslationControl();
    return (
        <div>
            <span data-testid="shouldRender">{String(control.shouldRender)}</span>
            <span data-testid="abbr">{control.targetAbbreviation}</span>
            <span data-testid="label">{control.targetLabel}</span>
            <span data-testid="disabled">{control.disabledReason ?? ''}</span>
            <span data-testid="errorVisible">{String(control.errorVisible)}</span>
            <span data-testid="errorText">{control.errorText}</span>
            <button onClick={control.onToggle}>toggle</button>
            <button onClick={control.retry}>retry</button>
        </div>
    );
};

function renderProvider() {
    return render(
        <LiveTranslationProvider
            videoId="v1"
            videoElement={{ playbackRate: 1 } as unknown as HTMLVideoElement}
            src="/videos/clip.mp4"
        >
            <Probe />
        </LiveTranslationProvider>,
    );
}

describe('LiveTranslationContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Re-establish defaults after clearAllMocks so per-test overrides don't leak.
        mockAudioSupported.mockReturnValue(true);
        mockSecureContext.mockReturnValue(true);
    });

    it('does not render the control when the feature is disabled globally', () => {
        setAvailability({ enabled: false });
        setSession();
        renderProvider();
        expect(screen.getByTestId('shouldRender').textContent).toBe('false');
    });

    it('exposes the target abbreviation and label', () => {
        setAvailability({ targetLanguage: 'zh-Hans' });
        setSession();
        renderProvider();
        expect(screen.getByTestId('abbr').textContent).toBe('CN');
        expect(screen.getByTestId('label').textContent).toBe('Chinese (Simplified)');
    });

    it('reports a localized disabled reason when not usable', () => {
        setAvailability({ canUse: false, reason: 'admin_required' });
        setSession();
        renderProvider();
        expect(screen.getByTestId('disabled').textContent).toBe('liveTranslationAdminRequiredPlayer');
    });

    it('hints at HTTPS when capture is unsupported because of an insecure context', () => {
        setAvailability();
        setSession();
        mockAudioSupported.mockReturnValue(false);
        mockSecureContext.mockReturnValue(false);
        renderProvider();
        expect(screen.getByTestId('disabled').textContent).toBe('liveTranslationInsecureContext');
    });

    it('blames the browser when capture is unsupported in a secure context', () => {
        setAvailability();
        setSession();
        mockAudioSupported.mockReturnValue(false);
        mockSecureContext.mockReturnValue(true);
        renderProvider();
        expect(screen.getByTestId('disabled').textContent).toBe('liveTranslationUnsupportedBrowser');
    });

    it('starts the session via onToggle when idle', async () => {
        setAvailability();
        const { start } = setSession();
        renderProvider();
        await userEvent.click(screen.getByText('toggle'));
        expect(start).toHaveBeenCalled();
    });

    it('stops the session via onToggle when active', async () => {
        setAvailability();
        const { stop } = setSession({ status: 'translating', isActive: true });
        renderProvider();
        await userEvent.click(screen.getByText('toggle'));
        expect(stop).toHaveBeenCalled();
    });

    it('localizes errors by code and surfaces them for the alert', () => {
        setAvailability();
        setSession({
            status: 'error',
            errorCode: 'session_timeout',
            errorMessage: 'raw english from backend',
            retryable: true,
        });
        renderProvider();
        expect(screen.getByTestId('errorVisible').textContent).toBe('true');
        expect(screen.getByTestId('errorText').textContent).toBe('liveTranslationErrorSessionTimeout');
    });
});
