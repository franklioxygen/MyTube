import {
    Box,
    CircularProgress,
    Fade,
    IconButton,
    Stack,
    Tooltip,
    Typography,
    useTheme,
} from '@mui/material';
import { Computer, Pause, PlayArrow } from '@mui/icons-material';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useCompatibilityStatisticsWatchTracker } from '../../../hooks/useCompatibilityStatisticsWatchTracker';
import { modeColors, neutral, overlay } from '../../../theme/colors';
import {
    DEFAULT_PLAYER_SEEK_INTERVALS,
    PlayerSeekIntervals,
} from '../../../utils/playerSeekIntervals';
import FullscreenControl from '../VideoControls/FullscreenControl';
import ProgressBar from '../VideoControls/ProgressBar';
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
import {
    CompatibilityPlaybackEngine,
    PlaybackSnapshot,
    PlaybackStatus,
} from './playbackEngine';

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
    // Where the viewer is dragging the progress bar, which the engine's clock
    // only catches up to once the seek lands. Null when not scrubbing.
    const [scrubTime, setScrubTime] = useState<number | null>(null);

    const statisticsTracker = useCompatibilityStatisticsWatchTracker({
        status: snapshot.status,
        videoId: statisticsVideoId,
        platform: statisticsPlatform,
        relatedEventId: statisticsRelatedEventId,
        autoplayFromVideoId: statisticsAutoplayFromVideoId,
    });
    const statisticsEndedRef = useRef(statisticsTracker.onEnded);

    // One reposition at a time. The engine refuses a seek issued while another
    // is still running and reports nothing back, so every path that moves the
    // playhead — the saved-position restore, the skip buttons and a
    // progress-bar release — is funnelled through this queue rather than
    // racing into it and being dropped. The newest target wins.
    const seekQueueRef = useRef<number | null>(null);
    const seekRunningRef = useRef(false);
    /** Where the reposition in flight is heading, when this player chose it. */
    const pendingTargetRef = useRef<number | null>(null);
    /** The last target a progress-bar release asked for. */
    const committedSeekRef = useRef<number | null>(null);
    /** Mirror the engine's own reporting for callbacks that must stay stable. */
    const statusRef = useRef<PlaybackStatus>(INITIAL_SNAPSHOT.status);
    const positionRef = useRef(INITIAL_SNAPSHOT.currentTime);
    /**
     * Play or pause pressed while a reposition was running. `seek()` restores
     * the playback state it captured when it started, so a transport change
     * made in the meantime is either overwritten on the way out or left
     * fighting the clock the reposition is rebasing. The intent waits here and
     * is applied once the playhead has landed.
     */
    const pendingPlaybackRef = useRef<boolean | null>(null);

    const isEnginePlaying = () =>
        statusRef.current === 'playing' || statusRef.current === 'buffering';

    // Refs outlive a source change, because the parent keeps this player
    // mounted across navigation. Anything still settling then belongs to the
    // engine that is going away, and must not touch the one taking its place.
    const finishSeek = useCallback((engine: CompatibilityPlaybackEngine) => {
        if (engineRef.current !== engine) {
            return;
        }
        pendingTargetRef.current = null;
        seekRunningRef.current = false;
    }, []);

    const drainSeekQueue = useCallback(async () => {
        if (seekRunningRef.current) {
            return;
        }
        const engine = engineRef.current;
        if (!engine) {
            seekQueueRef.current = null;
            pendingPlaybackRef.current = null;
            return;
        }
        seekRunningRef.current = true;
        try {
            // One engine call at a time until nothing is left. seek() captures
            // the playback state as it starts, and play() can sit in
            // resumeClock() for over a second, so letting either overlap the
            // other loses one of the two. Repositions go first: a transport
            // change belongs on top of the position the viewer chose.
            for (;;) {
                if (engineRef.current !== engine) {
                    break;
                }
                const target = seekQueueRef.current;
                if (target !== null) {
                    seekQueueRef.current = null;
                    pendingTargetRef.current = target;
                    await engine.seek(target);
                    continue;
                }
                const intent = pendingPlaybackRef.current;
                if (intent === null) {
                    break;
                }
                // Left in place for the duration: play() can take a second to
                // resume the clock, and a press made meanwhile has to compose
                // against the state being reached, not the one the engine is
                // still reporting. Applied only when it differs from where the
                // engine actually ended up, because play() has no guard
                // against being called on an already-playing engine.
                if (intent !== isEnginePlaying()) {
                    if (intent) {
                        await engine.play();
                    } else {
                        engine.pause();
                    }
                }
                if (pendingPlaybackRef.current === intent) {
                    pendingPlaybackRef.current = null;
                }
            }
        } finally {
            finishSeek(engine);
        }
        // Hand the bar back to the engine's own clock only once nothing else
        // is waiting and the thumb still sits where this seek was aimed —
        // a drag that started while the seek ran must keep the lead.
        if (seekQueueRef.current === null && engineRef.current === engine) {
            setScrubTime((current) =>
                current === committedSeekRef.current ? null : current
            );
        }
    }, [finishSeek]);

    const queueSeek = useCallback(
        (target: number) => {
            seekQueueRef.current = target;
            void drainSeekQueue();
        },
        [drainSeekQueue]
    );

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

        // Nothing aimed at the outgoing video may reach the incoming one, and
        // the bar must not open on the position of the video just left.
        seekQueueRef.current = null;
        pendingTargetRef.current = null;
        seekRunningRef.current = false;
        committedSeekRef.current = null;
        pendingPlaybackRef.current = null;
        statusRef.current = INITIAL_SNAPSHOT.status;
        positionRef.current = INITIAL_SNAPSHOT.currentTime;
        setScrubTime(null);

        if (!src || !supported) {
            return;
        }

        // No explicit snapshot reset: load() below sets `loading` synchronously
        // before its first await, and that emit carries the new engine's own
        // empty state, so nothing from the previous source survives.
        let restoringInitialPosition = false;
        const engine = new CompatibilityPlaybackEngine(canvas, {
            onChange: (next) => {
                statusRef.current = next.status;
                positionRef.current = next.currentTime;
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
                    seekRunningRef.current = true;
                    pendingTargetRef.current = startTimeRef.current;
                    try {
                        await engine.seek(startTimeRef.current);
                    } finally {
                        restoringInitialPosition = false;
                        finishSeek(engine);
                    }
                }
                if (autoPlay && engineRef.current === engine) {
                    // Autoplay is one more transport change, so it goes through
                    // the queue rather than racing it: anything asked for during
                    // the restore is performed first, and no seek can start
                    // while play() is still resuming the clock. A refused
                    // autoplay leaves the engine ready rather than playing; the
                    // play control then works from a real gesture.
                    pendingPlaybackRef.current = true;
                }
                await drainSeekQueue();
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
        const engine = engineRef.current;
        if (!engine) {
            return;
        }
        if (seekRunningRef.current || seekQueueRef.current !== null) {
            // Reading the pending intent first, so two presses during one
            // reposition cancel out rather than both counting as a change.
            pendingPlaybackRef.current = !(
                pendingPlaybackRef.current ?? isEnginePlaying()
            );
            return;
        }
        // play() rewinds an ended source with a seek of its own, which would
        // refuse anything the bar sent meanwhile. Hold the queue across the
        // toggle so a release waits for it, exactly as a skip does.
        if (statusRef.current === 'ended') {
            // That rewind lands at zero, so a skip pressed meanwhile has a
            // target to count from instead of being dropped.
            pendingTargetRef.current = 0;
        }
        seekRunningRef.current = true;
        void engine.toggle().finally(() => {
            finishSeek(engine);
            void drainSeekQueue();
        });
    }, [drainSeekQueue, finishSeek, revealControls]);

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
            const engine = engineRef.current;
            if (!engine) {
                return;
            }
            if (seekRunningRef.current || seekQueueRef.current !== null) {
                // Something is already under way, and until it lands the
                // engine's clock still reads the position being left, so count
                // from where the player is heading: the queued target, the one
                // in flight, or failing both the last position reported.
                const base =
                    seekQueueRef.current ??
                    pendingTargetRef.current ??
                    positionRef.current;
                queueSeek(base + deltaSeconds);
                return;
            }
            // Idle: let the engine apply the delta to its own live clock, which
            // is closer to the truth than the last position it reported. The
            // intent is recorded so a further skip can count from it.
            seekRunningRef.current = true;
            pendingTargetRef.current = positionRef.current + deltaSeconds;
            void engine.seekBy(deltaSeconds).finally(() => {
                finishSeek(engine);
                void drainSeekQueue();
            });
        },
        [drainSeekQueue, finishSeek, queueSeek, revealControls]
    );

    const handleScrub = useCallback(
        (seconds: number) => {
            revealControls();
            setScrubTime(seconds);
        },
        [revealControls]
    );

    const handleScrubCommitted = useCallback(
        (seconds: number) => {
            revealControls();
            setScrubTime(seconds);
            committedSeekRef.current = seconds;
            queueSeek(seconds);
        },
        [queueSeek, revealControls]
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

    const theme = useTheme();
    const modePalette = modeColors(theme.palette.mode);
    // In fullscreen the strip sits on the player's own black frame, so it stays
    // light-on-dark. Docked in the page it is a panel like the standard
    // player's control bar, and follows the app theme instead.
    const stripBackground = isFullscreen ? 'transparent' : modePalette.backgroundElevated;
    const stripColor = isFullscreen ? neutral.white : modePalette.textPrimary;

    const displayTime = scrubTime ?? snapshot.currentTime;

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

            {/* A trimmed transport strip: the shared progress bar, play and the
                way back to the standard player. */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 1.5,
                    py: 1,
                    bgcolor: stripBackground,
                    color: stripColor,
                    transition: 'background-color 0.3s, color 0.3s',
                    flexWrap: 'wrap',
                }}
            >
                <IconButton
                    size="small"
                    onClick={handleToggle}
                    disabled={hasFailed || isBusy || cannotReplay}
                    aria-label={isPlaying ? t('paused') : t('playing')}
                    sx={{ color: 'inherit' }}
                >
                    {isPlaying ? <Pause /> : <PlayArrow />}
                </IconButton>

                <ProgressBar
                    currentTime={displayTime}
                    duration={snapshot.duration ?? 0}
                    isFullscreen={isFullscreen}
                    disabled={hasFailed || !snapshot.canSeek}
                    onProgressChange={handleScrub}
                    onProgressChangeCommitted={handleScrubCommitted}
                    onProgressMouseDown={revealControls}
                />

                {onExit && canFallBackToStandardPlayer && (
                    <Tooltip title={t('compatibilityModeExit')}>
                        <IconButton
                            size="small"
                            onClick={onExit}
                            aria-label={t('compatibilityModeExit')}
                            sx={{ color: 'inherit' }}
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
