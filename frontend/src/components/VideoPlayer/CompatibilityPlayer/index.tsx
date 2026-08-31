import {
    Box,
    CircularProgress,
    Fade,
    IconButton,
    Stack,
    Tooltip,
    Typography,
} from '@mui/material';
import { Computer, Pause, PlayArrow } from '@mui/icons-material';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useCompatibilityStatisticsWatchTracker } from '../../../hooks/useCompatibilityStatisticsWatchTracker';
import { neutral, overlay } from '../../../theme/colors';
import { formatDuration } from '../../../utils/formatUtils';
import {
    DEFAULT_PLAYER_SEEK_INTERVALS,
    PlayerSeekIntervals,
} from '../../../utils/playerSeekIntervals';
import FullscreenControl from '../VideoControls/FullscreenControl';
import SeekButton from '../VideoControls/SeekButton';
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
    /** Saved playback position to resume from, in seconds. */
    startTime?: number;
    onTimeUpdate?: (currentTime: number) => void;
    onEnded?: () => void;
    /**
     * False on the in-car display, where no `<video>` player exists to return
     * to. Failure is then terminal and must be reported as such, and the exit
     * control is withheld because there is nowhere to exit to.
     */
    canFallBackToStandardPlayer?: boolean;
    /** Leaves D Mode for the standard player. */
    onExit?: () => void;
    seekIntervals?: PlayerSeekIntervals;
    statisticsVideoId?: string | null;
    statisticsPlatform?: string | null;
    statisticsRelatedEventId?: string | null;
    statisticsAutoplayFromVideoId?: string | null;
}

const DEFAULT_ASPECT_RATIO = 16 / 9;
/** How long the transport controls stay up after the last interaction. */
const CONTROLS_HIDE_DELAY_MS = 5000;

const INITIAL_SNAPSHOT: PlaybackSnapshot = {
    status: 'idle',
    currentTime: 0,
    duration: null,
    error: null,
    pipeline: null,
    unsupported: false,
    aspectRatio: null,
    buffering: false,
    canSeek: false,
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
    startTime = 0,
    onTimeUpdate,
    onEnded,
    canFallBackToStandardPlayer = true,
    onExit,
    seekIntervals = DEFAULT_PLAYER_SEEK_INTERVALS,
    statisticsVideoId = null,
    statisticsPlatform = null,
    statisticsRelatedEventId = null,
    statisticsAutoplayFromVideoId = null,
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
    // Held in a ref, not a dependency: the source effect is the only reader, so
    // the parent recomputing the saved position mid-watch must not restart
    // playback. The ref is refreshed below so each source load sees its own.
    const startTimeRef = useRef(startTime);
    const [snapshot, setSnapshot] = useState<PlaybackSnapshot>(INITIAL_SNAPSHOT);
    const [controlsVisible, setControlsVisible] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const statisticsTracker = useCompatibilityStatisticsWatchTracker({
        status: snapshot.status,
        videoId: statisticsVideoId,
        platform: statisticsPlatform,
        relatedEventId: statisticsRelatedEventId,
        autoplayFromVideoId: statisticsAutoplayFromVideoId,
    });
    const statisticsEndedRef = useRef(statisticsTracker.onEnded);

    // Keep the engine's inputs current without restarting playback when the
    // parent re-renders with fresh closures. Declared before the source effect
    // so a navigation that swaps `src` refreshes these first: capturing
    // `startTime` only at mount made every later video resume at the previous
    // one's position, which the clamp in seek() could land near its end.
    useEffect(() => {
        onTimeUpdateRef.current = onTimeUpdate;
        onEndedRef.current = onEnded;
        startTimeRef.current = startTime;
        statisticsEndedRef.current = statisticsTracker.onEnded;
    }, [onTimeUpdate, onEnded, startTime, statisticsTracker.onEnded]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        // Reset the picture for the incoming source. Assigning the backing size
        // also clears it, so the previous video's last frame cannot sit under
        // the new one's loading state, or under a failure notice belonging to a
        // different video. Playback replaces this with the decoded frame size;
        // failure never changes it.
        canvas.width = INITIAL_CANVAS_WIDTH;
        canvas.height = INITIAL_CANVAS_HEIGHT;

        if (!src || !supported) {
            return;
        }

        // No explicit snapshot reset: load() below sets `loading` synchronously
        // before its first await, and that emit carries the new engine's own
        // empty state, so nothing from the previous source survives.
        let restoringInitialPosition = false;
        const engine = new CompatibilityPlaybackEngine(canvas, {
            onChange: (next) => {
                setSnapshot(next);
                if (next.status === 'playing') {
                    onTimeUpdateRef.current?.(next.currentTime);
                }
            },
            // Unlike the initial `ready` snapshot, a completed seek is an
            // authoritative position even while paused or back at zero.
            onSeeked: (currentTime) => {
                if (!restoringInitialPosition) {
                    onTimeUpdateRef.current?.(currentTime);
                }
            },
            onEnded: () => {
                // Record natural completion before the parent's callback can
                // synchronously navigate and unmount this player.
                statisticsEndedRef.current();
                onEndedRef.current?.();
            },
        });
        engineRef.current = engine;

        void engine
            .load(src)
            .then(async () => {
                if (engineRef.current !== engine) {
                    return;
                }
                // Resume where the viewer left off. A seek lands on the
                // keyframe at or before the saved position, so playback can
                // start slightly earlier than the exact second recorded.
                if (startTimeRef.current > 0) {
                    restoringInitialPosition = true;
                    try {
                        await engine.seek(startTimeRef.current);
                    } finally {
                        restoringInitialPosition = false;
                    }
                }
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

    // The transport controls sit over the picture and retire themselves, so a
    // parked car screen is not left with a permanent overlay on the video.
    const hideTimerRef = useRef<number | null>(null);
    const revealControls = useCallback(() => {
        setControlsVisible(true);
        if (hideTimerRef.current !== null) {
            window.clearTimeout(hideTimerRef.current);
        }
        hideTimerRef.current = window.setTimeout(
            () => setControlsVisible(false),
            CONTROLS_HIDE_DELAY_MS
        );
    }, []);

    // The controls start visible so there is something to press; this only arms
    // their retirement, and does not touch state synchronously.
    useEffect(() => {
        hideTimerRef.current = window.setTimeout(
            () => setControlsVisible(false),
            CONTROLS_HIDE_DELAY_MS
        );
        return () => {
            if (hideTimerRef.current !== null) {
                window.clearTimeout(hideTimerRef.current);
            }
        };
    }, []);

    const handleToggle = useCallback(() => {
        revealControls();
        void engineRef.current?.toggle();
    }, [revealControls]);

    useEffect(() => {
        const syncFullscreen = () =>
            setIsFullscreen(document.fullscreenElement === containerRef.current);
        document.addEventListener('fullscreenchange', syncFullscreen);
        return () =>
            document.removeEventListener('fullscreenchange', syncFullscreen);
    }, []);

    const handleToggleFullscreen = useCallback(() => {
        revealControls();
        const container = containerRef.current;
        if (!container) {
            return;
        }
        if (document.fullscreenElement === container) {
            void document.exitFullscreen().catch(() => undefined);
        } else {
            void container.requestFullscreen?.().catch(() => undefined);
        }
    }, [revealControls]);

    const handleSeekBy = useCallback(
        (deltaSeconds: number) => {
            revealControls();
            void engineRef.current?.seekBy(deltaSeconds);
        },
        [revealControls]
    );

    const isPlaying =
        snapshot.status === 'playing' || snapshot.status === 'buffering';
    const cannotReplay = snapshot.status === 'ended' && !snapshot.canSeek;
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
                ...(isFullscreen && {
                    width: '100vw',
                    height: '100vh',
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: 0,
                }),
            }}
        >
            <Box
                sx={{
                    position: 'relative',
                    width: '100%',
                    // The transport controls size themselves against the picture
                    // rather than the viewport, so they stay in proportion in a
                    // sidebar, in cinema mode and on a full-width car display
                    // alike. Any browser that can run WebCodecs also supports
                    // container queries — they shipped earlier in both engines.
                    containerType: 'inline-size',
                    ...(isFullscreen
                        ? { flex: 1, minHeight: 0 }
                        : {
                              aspectRatio: snapshot.aspectRatio ?? DEFAULT_ASPECT_RATIO,
                              maxHeight: 'calc(100vh - 180px)',
                          }),
                    backgroundImage: poster ? `url(${poster})` : undefined,
                    backgroundSize: 'contain',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                }}
            >
                <canvas
                    ref={canvasRef}
                    onClick={revealControls}
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

                {!hasFailed && (
                    <Fade in={controlsVisible} timeout={{ enter: 200, exit: 500 }}>
                        <Stack
                            direction="column"
                            alignItems="center"
                            justifyContent="center"
                            sx={{
                                position: 'absolute',
                                inset: 0,
                                color: neutral.white,
                                gap: 'clamp(8px, 2cqw, 24px)',
                                // Hidden controls must not swallow the tap that
                                // is meant to bring them back.
                                pointerEvents: controlsVisible ? 'auto' : 'none',
                                // Overridden here rather than in SeekButton,
                                // which the standard player shares and which
                                // must keep its own sizing.
                                '& .MuiIconButton-root': {
                                    color: neutral.white,
                                    bgcolor: overlay.black70,
                                    width: 'clamp(40px, 9cqw, 96px)',
                                    height: 'clamp(40px, 9cqw, 96px)',
                                    '&:hover': { bgcolor: overlay.black80 },
                                    '&.Mui-disabled': { color: overlay.white32 },
                                    '& .MuiSvgIcon-root': {
                                        fontSize: 'clamp(20px, 4.8cqw, 52px)',
                                    },
                                },
                                // Higher specificity so the primary control
                                // wins over the shared sizing above.
                                '& .MuiIconButton-root.compat-primary': {
                                    width: 'clamp(56px, 13cqw, 136px)',
                                    height: 'clamp(56px, 13cqw, 136px)',
                                    '& .MuiSvgIcon-root': {
                                        fontSize: 'clamp(30px, 7cqw, 76px)',
                                    },
                                },
                            }}
                        >
                            <Stack
                                direction="row"
                                alignItems="center"
                                justifyContent="center"
                                sx={{ gap: 'clamp(8px, 2.5cqw, 32px)' }}
                            >
                                <SeekButton
                                    direction="backward"
                                    tier="medium"
                                    seconds={seekIntervals.mediumSeconds}
                                    onSeek={handleSeekBy}
                                    disableTooltip
                                    disabled={!snapshot.canSeek}
                                />
                                <SeekButton
                                    direction="backward"
                                    tier="short"
                                    seconds={seekIntervals.shortSeconds}
                                    onSeek={handleSeekBy}
                                    disableTooltip
                                    disabled={!snapshot.canSeek}
                                />
                                <IconButton
                                    className="compat-primary"
                                    onClick={handleToggle}
                                    disabled={isBusy || cannotReplay}
                                    aria-label={isPlaying ? t('paused') : t('playing')}
                                >
                                    {isPlaying ? <Pause /> : <PlayArrow />}
                                </IconButton>
                                <SeekButton
                                    direction="forward"
                                    tier="short"
                                    seconds={seekIntervals.shortSeconds}
                                    onSeek={handleSeekBy}
                                    disableTooltip
                                    disabled={!snapshot.canSeek}
                                />
                                <SeekButton
                                    direction="forward"
                                    tier="medium"
                                    seconds={seekIntervals.mediumSeconds}
                                    onSeek={handleSeekBy}
                                    disableTooltip
                                    disabled={!snapshot.canSeek}
                                />
                            </Stack>

                            <FullscreenControl
                                isFullscreen={isFullscreen}
                                onToggle={handleToggleFullscreen}
                            />
                        </Stack>
                    </Fade>
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
                    disabled={hasFailed || isBusy || cannotReplay}
                    aria-label={isPlaying ? t('paused') : t('playing')}
                    sx={{ color: neutral.white }}
                >
                    {isPlaying ? <Pause /> : <PlayArrow />}
                </IconButton>

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

                {onExit && canFallBackToStandardPlayer && (
                    <Tooltip title={t('compatibilityModeExit')}>
                        <IconButton
                            size="small"
                            onClick={onExit}
                            aria-label={t('compatibilityModeExit')}
                            sx={{ color: neutral.white }}
                        >
                            <Computer />
                        </IconButton>
                    </Tooltip>
                )}
            </Box>
        </Box>
    );
};

export default CompatibilityPlayer;
