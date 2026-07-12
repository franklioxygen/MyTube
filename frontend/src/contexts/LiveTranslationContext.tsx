import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useLanguage } from './LanguageContext';
import {
    LiveTranslationSessionStatus,
    LiveTranslationTranscriptEvent,
    useLiveTranslationSession,
} from '../hooks/useLiveTranslationSession';
import { useLiveTranslationAvailability } from '../hooks/useLiveTranslationAvailability';
import {
    isAudioCaptureSupported,
    isSecureContextForCapture,
} from '../hooks/useLiveTranslationAudioCapture';
import { isCaptureSupportedForSrc } from '../utils/mediaOrigin';
import {
    getLiveTranslationLanguageAbbreviation,
    getLiveTranslationLanguageLabel,
} from '../utils/liveTranslationLanguages';
import { LiveTranslationErrorCode } from '../utils/liveTranslationProtocol';
import { TranslationKey } from '../utils/translations';

// Map error codes (client- or server-originated) to localized message keys.
const ERROR_MESSAGE_KEY_BY_CODE: Partial<Record<LiveTranslationErrorCode, TranslationKey>> = {
    feature_disabled: 'liveTranslationUnavailable',
    admin_required: 'liveTranslationAdminRequiredPlayer',
    api_key_missing: 'liveTranslationApiKeyMissingPlayer',
    unsupported_playback_rate: 'liveTranslationErrorRequiresNormalSpeed',
    audio_capture_failed: 'liveTranslationErrorCaptureFailed',
    ticket_missing: 'liveTranslationErrorTicket',
    ticket_expired: 'liveTranslationErrorTicket',
    ticket_used: 'liveTranslationErrorTicket',
    websocket_connect_failed: 'liveTranslationErrorWebSocket',
    gemini_connect_failed: 'liveTranslationErrorConnection',
    gemini_setup_failed: 'liveTranslationErrorConnection',
    gemini_stream_closed: 'liveTranslationErrorConnection',
    gemini_not_ready: 'liveTranslationErrorConnection',
    gemini_rate_limited: 'liveTranslationErrorRateLimited',
    session_timeout: 'liveTranslationErrorSessionTimeout',
    too_many_sessions: 'liveTranslationErrorTooManySessions',
};

export interface LiveTranslationControl {
    /** Feature is enabled globally; the in-player control should be rendered. */
    shouldRender: boolean;
    status: LiveTranslationSessionStatus;
    isActive: boolean;
    isConnecting: boolean;
    isPaused: boolean;
    /** Non-null when the control must be disabled; value is a localized reason. */
    disabledReason: string | null;
    /** Short uppercase badge for the active target language (e.g. "EN", "CN"). */
    targetAbbreviation: string;
    /** Full target language label, used for tooltips. */
    targetLabel: string;
    /** Start when idle, stop when active/connecting. */
    onToggle: () => void;
    /** Error surface (rendered outside the control bar). */
    errorVisible: boolean;
    errorText: string;
    retryable: boolean;
    retry: () => void;
}

const DEFAULT_CONTROL: LiveTranslationControl = {
    shouldRender: false,
    status: 'idle',
    isActive: false,
    isConnecting: false,
    isPaused: false,
    disabledReason: null,
    targetAbbreviation: '',
    targetLabel: '',
    onToggle: () => {},
    errorVisible: false,
    errorText: '',
    retryable: false,
    retry: () => {},
};

const LiveTranslationContext = createContext<LiveTranslationControl>(DEFAULT_CONTROL);

/**
 * Used outside a provider (e.g. in isolated control-bar component tests) it
 * returns an inert default so the in-player control simply renders nothing.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useLiveTranslationControl(): LiveTranslationControl {
    return useContext(LiveTranslationContext);
}

interface LiveTranslationProviderProps {
    videoId: string;
    videoElement: HTMLVideoElement | null;
    src: string | null;
    originalAudioWithSubtitles?: boolean;
    originalAudioWithSubtitlesReady?: boolean;
    onTranscript?: (event: LiveTranslationTranscriptEvent) => void;
    onActiveChange?: (active: boolean) => void;
    children: React.ReactNode;
}

/**
 * Hosts the live translation session and exposes its UI state via context so the
 * trigger can live inside the video control bar while the page keeps wiring the
 * transcript/active-state into the live subtitle track.
 */
export const LiveTranslationProvider: React.FC<LiveTranslationProviderProps> = ({
    videoId,
    videoElement,
    src,
    originalAudioWithSubtitles,
    originalAudioWithSubtitlesReady = true,
    onTranscript,
    onActiveChange,
    children,
}) => {
    const { t } = useLanguage();
    const { data: availability } = useLiveTranslationAvailability();
    const session = useLiveTranslationSession({
        videoElement,
        videoId,
        onTranscript,
        originalAudioWithSubtitles,
    });

    // Report active-state transitions so the player can create/clear the dynamic
    // live subtitle track.
    useEffect(() => {
        onActiveChange?.(session.isActive);
    }, [session.isActive, onActiveChange]);

    const value = useMemo<LiveTranslationControl>(() => {
        const shouldRender = !!availability && availability.enabled && originalAudioWithSubtitlesReady;
        if (!shouldRender) {
            return DEFAULT_CONTROL;
        }

        const isConnecting = session.status === 'connecting';
        const isActive = session.isActive;
        const isPaused = session.status === 'paused';

        // Resolve the disabled reason (server availability first, then local capability).
        let disabledReason: string | null = null;
        if (!availability.canUse) {
            if (availability.reason === 'admin_required') {
                disabledReason = t('liveTranslationAdminRequiredPlayer');
            } else if (availability.reason === 'api_key_missing') {
                disabledReason = t('liveTranslationApiKeyMissingPlayer');
            } else {
                disabledReason = t('liveTranslationUnavailable');
            }
        } else if (!isAudioCaptureSupported()) {
            // AudioWorklet is missing. The usual real-world cause is an insecure
            // origin (http:// on a LAN IP), where browsers don't expose it — point
            // users at HTTPS/localhost rather than implying the browser is too old.
            disabledReason = isSecureContextForCapture()
                ? t('liveTranslationUnsupportedBrowser')
                : t('liveTranslationInsecureContext');
        } else if (!isCaptureSupportedForSrc(src)) {
            disabledReason = t('liveTranslationAudioCaptureBlocked');
        } else if (!videoElement) {
            disabledReason = t('liveTranslationUnavailable');
        }

        // Localize the error by code; fall back to any server message, then a generic key.
        const errorKey = session.errorCode
            ? ERROR_MESSAGE_KEY_BY_CODE[session.errorCode]
            : undefined;
        const errorText = errorKey
            ? t(errorKey)
            : session.errorMessage || t('liveTranslationErrorGeneric');

        return {
            shouldRender,
            status: session.status,
            isActive,
            isConnecting,
            isPaused,
            disabledReason,
            targetAbbreviation: getLiveTranslationLanguageAbbreviation(availability.targetLanguage),
            targetLabel: getLiveTranslationLanguageLabel(availability.targetLanguage),
            onToggle: () => {
                if (isActive || isConnecting) {
                    session.stop();
                } else {
                    session.start();
                }
            },
            errorVisible: session.status === 'error',
            errorText,
            retryable: session.retryable,
            retry: () => session.start(),
        };
    }, [availability, originalAudioWithSubtitlesReady, session, src, videoElement, t]);

    return (
        <LiveTranslationContext.Provider value={value}>
            {children}
        </LiveTranslationContext.Provider>
    );
};
