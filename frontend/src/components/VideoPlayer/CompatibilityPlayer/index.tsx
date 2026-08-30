import {
    Box,
    CircularProgress,
    IconButton,
    Slider,
    Typography,
} from '@mui/material';
import { Pause, PlayArrow, VolumeOff, VolumeUp } from '@mui/icons-material';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { neutral, overlay } from '../../../theme/colors';
import { formatDuration } from '../../../utils/formatUtils';
import {
    getMissingCompatibilityModeApis,
    isCompatibilityModeSupported,
} from '../../../utils/compatibilityMode/support';
import {
    drawFailureNotice,
    INITIAL_CANVAS_HEIGHT,
    INITIAL_CANVAS_WIDTH,
} from './failureNotice';
import { CompatibilityPlaybackEngine, PlaybackSnapshot } from './playbackEngine';

interface CompatibilityPlayerProps {
    src: string | null;
    poster?: string;
    autoPlay?: boolean;
    onTimeUpdate?: (currentTime: number) => void;
    onEnded?: () => void;
    /**
     * False on the in-car display, where no `<video>` player exists to return
     * to. Failure is then terminal and must be reported as such.
     */
    canFallBackToStandardPlayer?: boolean;
}

const VOLUME_STORAGE_ID = 'mytube:player-volume';
const DEFAULT_ASPECT_RATIO = 16 / 9;

const readStoredVolume = (): number => {
    try {
        const stored = Number.parseFloat(
            localStorage.getItem(VOLUME_STORAGE_ID) ?? ''
        );
        return Number.isFinite(stored) ? Math.min(1, Math.max(0, stored)) : 1;
    } catch {
        return 1;
    }
};

const INITIAL_SNAPSHOT: PlaybackSnapshot = {
    status: 'idle',
    currentTime: 0,
    duration: null,
    error: null,
    pipeline: null,
    unsupported: false,
    aspectRatio: null,
    volume: 1,
    muted: false,
    buffering: false,
};

/**
 * Proof-of-concept player that renders video into a `<canvas>` instead of a
 * `<video>` element. The page therefore contains no media element at all: the
 * browser (and anything inspecting the DOM) sees a canvas being painted and a
 * Web Audio graph making sound.
 *
 * The regular control panel is intentionally not mounted here — only the
 * minimum needed to demonstrate playback.
 */
const CompatibilityPlayer: React.FC<CompatibilityPlayerProps> = ({
    src,
    poster,
    autoPlay = false,
    onTimeUpdate,
    onEnded,
    canFallBackToStandardPlayer = true,
}) => {
    const { t } = useLanguage();
    // Forced deployments render this player even where WebCodecs is missing,
    // so the guard cannot live only in the parent.
    const supported = useMemo(() => isCompatibilityModeSupported(), []);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const engineRef = useRef<CompatibilityPlaybackEngine | null>(null);
    const onTimeUpdateRef = useRef(onTimeUpdate);
    const onEndedRef = useRef(onEnded);
    const [snapshot, setSnapshot] = useState<PlaybackSnapshot>(INITIAL_SNAPSHOT);

    // Keep the engine's callbacks current without restarting playback when the
    // parent re-renders with fresh closures.
    useEffect(() => {
        onTimeUpdateRef.current = onTimeUpdate;
        onEndedRef.current = onEnded;
    }, [onTimeUpdate, onEnded]);

    // Sized once on mount so a failure before the first frame still renders
    // crisp text. Playback replaces this with the decoded frame size; failure
    // never changes it.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas) {
            canvas.width = INITIAL_CANVAS_WIDTH;
            canvas.height = INITIAL_CANVAS_HEIGHT;
        }
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !src || !supported) {
            return;
        }

        setSnapshot(INITIAL_SNAPSHOT);
        const engine = new CompatibilityPlaybackEngine(canvas, {
            onChange: (next) => {
                setSnapshot(next);
                if (next.status === 'playing') {
                    onTimeUpdateRef.current?.(next.currentTime);
                }
            },
            onEnded: () => onEndedRef.current?.(),
        });
        engineRef.current = engine;
        engine.setVolume(readStoredVolume());

        void engine
            .load(src)
            .then(() => {
                if (autoPlay && engineRef.current === engine) {
                    // A refused autoplay leaves the engine ready rather than
                    // playing; the play control then works from a real gesture.
                    void engine.play();
                }
            })
            .catch(() => undefined);

        return () => {
            engineRef.current = null;
            void engine.destroy();
        };
        // autoPlay is read once per source; re-running on toggle would restart playback.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src, supported]);

    const handleToggle = useCallback(() => {
        void engineRef.current?.toggle();
    }, []);

    const handleToggleMuted = useCallback(() => {
        engineRef.current?.toggleMuted();
    }, []);

    const handleVolumeChange = useCallback((_: Event, value: number | number[]) => {
        const volume = (Array.isArray(value) ? value[0] : value) / 100;
        engineRef.current?.setVolume(volume);
        try {
            localStorage.setItem(VOLUME_STORAGE_ID, String(volume));
        } catch {
            // A storage failure only costs the remembered level.
        }
    }, []);

    const isPlaying =
        snapshot.status === 'playing' || snapshot.status === 'buffering';
    const isBusy =
        supported &&
        (snapshot.status === 'loading' ||
            snapshot.status === 'idle' ||
            snapshot.buffering);
    const hasFailed = !supported || snapshot.status === 'error';
    const failureTitle = supported
        ? t('compatibilityModeFailed')
        : t('compatibilityModeUnavailable');
    const failureDetail = supported
        ? snapshot.error
        : `Missing: ${getMissingCompatibilityModeApis().join(', ')}`;
    const failureHint = canFallBackToStandardPlayer
        ? t('compatibilityModeFallbackHint')
        : t('compatibilityModeUnplayable');

    // Terminal failure is reported inside the picture, at the size the canvas
    // already has, so the frame does not resize or jump when playback stops.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!hasFailed || !canvas) {
            return;
        }
        drawFailureNotice(canvas, {
            title: failureTitle,
            detail: failureDetail,
            hint: failureHint,
        });
    }, [hasFailed, failureTitle, failureDetail, failureHint]);
    const progress =
        snapshot.duration && snapshot.duration > 0
            ? Math.min(100, (snapshot.currentTime / snapshot.duration) * 100)
            : 0;

    return (
        <Box
            ref={containerRef}
            sx={{
                width: '100%',
                bgcolor: neutral.black,
                borderRadius: { xs: 0, sm: 2 },
                overflow: 'hidden',
                boxShadow: 4,
                position: 'relative',
            }}
        >
            <Box
                sx={{
                    position: 'relative',
                    width: '100%',
                    aspectRatio: snapshot.aspectRatio ?? DEFAULT_ASPECT_RATIO,
                    maxHeight: 'calc(100vh - 180px)',
                    backgroundImage: poster ? `url(${poster})` : undefined,
                    backgroundSize: 'contain',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                }}
            >
                <canvas
                    ref={canvasRef}
                    onClick={handleToggle}
                    style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        display: 'block',
                        cursor: 'pointer',
                        position: 'relative',
                    }}
                />

                {isBusy && (
                    <Box
                        sx={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 1,
                            color: neutral.white,
                        }}
                    >
                        <CircularProgress size={28} color="inherit" />
                        <Typography variant="body2">
                            {t('compatibilityModeLoading')}
                        </Typography>
                    </Box>
                )}

                {!isPlaying && !hasFailed && !isBusy && (
                    <Box
                        onClick={handleToggle}
                        sx={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                        }}
                    >
                        <IconButton
                            aria-label={t('playing')}
                            sx={{
                                bgcolor: overlay.black70,
                                color: neutral.white,
                                '&:hover': { bgcolor: overlay.black80 },
                            }}
                        >
                            <PlayArrow fontSize="large" />
                        </IconButton>
                    </Box>
                )}
            </Box>

            {/* Deliberately not the real control panel — just enough to drive the POC. */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 1.5,
                    py: 1,
                    color: neutral.white,
                    flexWrap: 'wrap',
                }}
            >
                <IconButton
                    size="small"
                    onClick={handleToggle}
                    disabled={hasFailed || isBusy}
                    aria-label={isPlaying ? t('paused') : t('playing')}
                    sx={{ color: neutral.white }}
                >
                    {isPlaying ? <Pause /> : <PlayArrow />}
                </IconButton>

                <IconButton
                    size="small"
                    onClick={handleToggleMuted}
                    disabled={hasFailed}
                    aria-label={t('compatibilityModeVolume')}
                    sx={{ color: neutral.white }}
                >
                    {snapshot.muted || snapshot.volume === 0 ? (
                        <VolumeOff />
                    ) : (
                        <VolumeUp />
                    )}
                </IconButton>
                <Slider
                    size="small"
                    aria-label={t('compatibilityModeVolume')}
                    value={snapshot.muted ? 0 : Math.round(snapshot.volume * 100)}
                    onChange={handleVolumeChange}
                    disabled={hasFailed}
                    sx={{ width: 96, color: neutral.white, flexShrink: 0 }}
                />

                <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatDuration(snapshot.currentTime)}
                    {snapshot.duration ? ` / ${formatDuration(snapshot.duration)}` : ''}
                </Typography>

                <Box
                    sx={{
                        flex: 1,
                        minWidth: 80,
                        height: 3,
                        borderRadius: 2,
                        bgcolor: overlay.white32,
                    }}
                >
                    <Box
                        sx={{
                            width: `${progress}%`,
                            height: '100%',
                            borderRadius: 2,
                            bgcolor: 'primary.main',
                            transition: 'width 120ms linear',
                        }}
                    />
                </Box>

                {snapshot.pipeline && (
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                        {snapshot.pipeline}
                    </Typography>
                )}
            </Box>
        </Box>
    );
};

export default CompatibilityPlayer;
