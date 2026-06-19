import { Translate as TranslateIcon, Stop as StopIcon } from '@mui/icons-material';
import { Alert, Box, Button, Chip, CircularProgress, Tooltip } from '@mui/material';
import React, { useEffect, useMemo } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import {
    LiveTranslationTranscriptEvent,
    useLiveTranslationSession,
} from '../../hooks/useLiveTranslationSession';
import { LiveTranslationErrorCode } from '../../utils/liveTranslationProtocol';
import { TranslationKey } from '../../utils/translations';
import { useLiveTranslationAvailability } from '../../hooks/useLiveTranslationAvailability';
import { isAudioCaptureSupported } from '../../hooks/useLiveTranslationAudioCapture';
import { isCaptureSupportedForSrc } from '../../utils/mediaOrigin';
import { getLiveTranslationLanguageLabel } from '../../utils/liveTranslationLanguages';

interface LiveTranslationToggleProps {
    videoId: string;
    videoElement: HTMLVideoElement | null;
    src: string | null;
    onTranscript?: (event: LiveTranslationTranscriptEvent) => void;
    onActiveChange?: (active: boolean) => void;
}

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
    gemini_connect_failed: 'liveTranslationErrorConnection',
    gemini_setup_failed: 'liveTranslationErrorConnection',
    gemini_stream_closed: 'liveTranslationErrorConnection',
    gemini_not_ready: 'liveTranslationErrorConnection',
    gemini_rate_limited: 'liveTranslationErrorRateLimited',
    session_timeout: 'liveTranslationErrorSessionTimeout',
    too_many_sessions: 'liveTranslationErrorTooManySessions',
};

const LiveTranslationToggle: React.FC<LiveTranslationToggleProps> = ({
    videoId,
    videoElement,
    src,
    onTranscript,
    onActiveChange,
}) => {
    const { t } = useLanguage();
    const { data: availability } = useLiveTranslationAvailability();

    const session = useLiveTranslationSession({ videoElement, videoId, onTranscript });

    // Report active-state transitions so the player can create/clear the dynamic
    // live subtitle track.
    useEffect(() => {
        onActiveChange?.(session.isActive);
    }, [session.isActive, onActiveChange]);

    const captureSupported = useMemo(
        () => isAudioCaptureSupported() && isCaptureSupportedForSrc(src),
        [src],
    );

    // Hidden entirely when the feature is disabled globally.
    if (!availability || !availability.enabled) {
        return null;
    }

    const targetLabel = getLiveTranslationLanguageLabel(availability.targetLanguage);

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
        disabledReason = t('liveTranslationUnsupportedBrowser');
    } else if (!isCaptureSupportedForSrc(src)) {
        disabledReason = t('liveTranslationAudioCaptureBlocked');
    } else if (!videoElement) {
        disabledReason = t('liveTranslationUnavailable');
    }

    const isConnecting = session.status === 'connecting';
    const isActive = session.isActive;
    const isPaused = session.status === 'paused';

    const handleClick = () => {
        if (isActive || isConnecting) {
            session.stop();
        } else {
            session.start();
        }
    };

    const renderButtonLabel = () => {
        if (isConnecting) return t('liveTranslationConnecting');
        if (isActive) return t('stopLiveTranslation');
        return t('liveTranslate');
    };

    // Localize the error by code; fall back to any server message, then a generic key.
    const errorKey = session.errorCode
        ? ERROR_MESSAGE_KEY_BY_CODE[session.errorCode]
        : undefined;
    const errorText = errorKey
        ? t(errorKey)
        : session.errorMessage || t('liveTranslationErrorGeneric');

    const button = (
        <Button
            variant={isActive ? 'contained' : 'outlined'}
            color={isActive ? 'secondary' : 'primary'}
            size="small"
            disabled={!!disabledReason && !isActive && !isConnecting}
            onClick={handleClick}
            startIcon={
                isConnecting ? (
                    <CircularProgress size={16} color="inherit" />
                ) : isActive ? (
                    <StopIcon />
                ) : (
                    <TranslateIcon />
                )
            }
            sx={{ textTransform: 'none' }}
        >
            {renderButtonLabel()}
        </Button>
    );

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1, px: { xs: 2, md: 0 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                {disabledReason && !isActive && !isConnecting ? (
                    <Tooltip title={disabledReason}>
                        <span>{button}</span>
                    </Tooltip>
                ) : (
                    button
                )}

                {isActive && !isPaused && (
                    <Chip
                        size="small"
                        color="secondary"
                        label={t('liveTranslationTranslatingTo').replace('{language}', targetLabel)}
                    />
                )}
                {isPaused && <Chip size="small" label={t('liveTranslationPaused')} />}
                {!captureSupported && !disabledReason && (
                    <Chip size="small" color="warning" label={t('liveTranslationAudioCaptureBlocked')} />
                )}
            </Box>

            {session.status === 'error' && (
                <Alert
                    severity="error"
                    action={
                        session.retryable ? (
                            <Button color="inherit" size="small" onClick={() => session.start()}>
                                {t('liveTranslationRetry')}
                            </Button>
                        ) : undefined
                    }
                >
                    {errorText}
                </Alert>
            )}
        </Box>
    );
};

export default LiveTranslationToggle;
