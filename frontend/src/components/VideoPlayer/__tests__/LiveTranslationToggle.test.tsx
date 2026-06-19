import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, Mock } from 'vitest';
import LiveTranslationToggle from '../LiveTranslationToggle';
import { useLiveTranslationAvailability } from '../../../hooks/useLiveTranslationAvailability';
import { useLiveTranslationSession } from '../../../hooks/useLiveTranslationSession';

vi.mock('../../../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock('../../../hooks/useLiveTranslationAvailability', () => ({
  useLiveTranslationAvailability: vi.fn(),
}));
vi.mock('../../../hooks/useLiveTranslationSession', () => ({
  useLiveTranslationSession: vi.fn(),
}));
vi.mock('../../../hooks/useLiveTranslationAudioCapture', () => ({
  isAudioCaptureSupported: () => true,
  useLiveTranslationAudioCapture: () => ({}),
}));
vi.mock('../../../utils/mediaOrigin', () => ({
  isCaptureSupportedForSrc: () => true,
}));

const mockAvailability = useLiveTranslationAvailability as unknown as Mock;
const mockSession = useLiveTranslationSession as unknown as Mock;

function setAvailability(overrides: Record<string, unknown> = {}) {
  mockAvailability.mockReturnValue({
    data: {
      enabled: true,
      available: true,
      canUse: true,
      model: 'gemini-3.5-live-translate-preview',
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

const renderToggle = () =>
  render(
    <LiveTranslationToggle
      videoId="v1"
      videoElement={{ playbackRate: 1 } as unknown as HTMLVideoElement}
      src="/videos/clip.mp4"
    />,
  );

describe('LiveTranslationToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when the feature is disabled globally', () => {
    setAvailability({ enabled: false });
    setSession();
    const { container } = renderToggle();
    expect(container).toBeEmptyDOMElement();
  });

  it('disables the button with a reason when not usable', () => {
    setAvailability({ canUse: false, reason: 'admin_required' });
    setSession();
    renderToggle();
    const button = screen.getByRole('button', { name: 'liveTranslate' });
    expect(button).toBeDisabled();
  });

  it('starts the session when clicked', async () => {
    setAvailability();
    const { start } = setSession();
    renderToggle();
    await userEvent.click(screen.getByRole('button', { name: 'liveTranslate' }));
    expect(start).toHaveBeenCalled();
  });

  it('shows a stop button and stops the session when active', async () => {
    setAvailability();
    const { stop } = setSession({ status: 'translating', isActive: true });
    renderToggle();
    const button = screen.getByRole('button', { name: 'stopLiveTranslation' });
    await userEvent.click(button);
    expect(stop).toHaveBeenCalled();
    expect(screen.getByText('liveTranslationTranslatingTo')).toBeInTheDocument();
  });

  it('shows a retryable error alert (falls back to message when no code)', () => {
    setAvailability();
    setSession({ status: 'error', errorMessage: 'boom', retryable: true });
    renderToggle();
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'liveTranslationRetry' })).toBeInTheDocument();
  });

  it('localizes the error by code instead of the raw server message', () => {
    setAvailability();
    setSession({
      status: 'error',
      errorCode: 'session_timeout',
      errorMessage: 'raw english from backend',
      retryable: true,
    });
    renderToggle();
    // Mocked t() echoes the key, so the localized key appears, not the raw message.
    expect(screen.getByText('liveTranslationErrorSessionTimeout')).toBeInTheDocument();
    expect(screen.queryByText('raw english from backend')).not.toBeInTheDocument();
  });
});
