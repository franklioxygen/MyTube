import { Box, Chip, CircularProgress, IconButton, Typography } from '@mui/material';
import { Pause, PlayArrow } from '@mui/icons-material';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { neutral, overlay } from '../../../theme/colors';
import { formatDuration } from '../../../utils/formatUtils';
import { CompatibilityPlaybackEngine, PlaybackSnapshot } from './playbackEngine';

interface CompatibilityPlayerProps {
    src: string | null;
    poster?: string;
    autoPlay?: boolean;
    onTimeUpdate?: (currentTime: number) => void;
    onEnded?: () => void;
}

const INITIAL_SNAPSHOT: PlaybackSnapshot = {
    status: 'idle',
    currentTime: 0,
    duration: null,
    error: null,
    pipeline: null,
    unsupported: false,
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
}) => {
    const { t } = useLanguage();
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const engineRef = useRef<CompatibilityPlaybackEngine | null>(null);
    const onTimeUpdateRef = useRef(onTimeUpdate);
    const onEndedRef = useRef(onEnded);
    const [snapshot, setSnapshot] = useState<PlaybackSnapshot>(INITIAL_SNAPSHOT);
    const [mediaElementCount, setMediaElementCount] = useState(0);

    // Keep the engine's callbacks current without restarting playback when the
    // parent re-renders with fresh closures.
    useEffect(() => {
        onTimeUpdateRef.current = onTimeUpdate;
        onEndedRef.current = onEnded;
    }, [onTimeUpdate, onEnded]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !src) {
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

        void engine.load(src).then(() => {
            if (autoPlay && engineRef.current === engine) {
                void engine.play();
            }
        });

        return () => {
            engineRef.current = null;
            void engine.destroy();
        };
        // autoPlay is read once per source; re-running on toggle would restart playback.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src]);

    // The whole point of the mode: prove nothing media-element-shaped is mounted.
    useEffect(() => {
        setMediaElementCount(
            containerRef.current?.querySelectorAll('video, audio, source, track')
                .length ?? 0
        );
    }, [snapshot.status]);

    const handleToggle = useCallback(() => {
        void engineRef.current?.toggle();
    }, []);

    const isPlaying = snapshot.status === 'playing';
    const isBusy = snapshot.status === 'loading' || snapshot.status === 'idle';
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
                    aspectRatio: '16/9',
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

                <Chip
                    size="small"
                    label={`${t('compatibilityMode')} · POC`}
                    sx={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        bgcolor: overlay.black70,
                        color: neutral.white,
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

                {snapshot.status === 'error' && (
                    <Box
                        sx={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 1,
                            p: 3,
                            textAlign: 'center',
                            bgcolor: overlay.black70,
                            color: neutral.white,
                        }}
                    >
                        <Typography variant="body1">
                            {t('compatibilityModeFailed')}
                        </Typography>
                        <Typography variant="body2" sx={{ opacity: 0.8 }}>
                            {snapshot.error}
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.7 }}>
                            {t('compatibilityModeFallbackHint')}
                        </Typography>
                    </Box>
                )}

                {!isPlaying && snapshot.status !== 'error' && !isBusy && (
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
                    disabled={snapshot.status === 'error' || isBusy}
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

                {snapshot.pipeline && (
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                        {snapshot.pipeline}
                    </Typography>
                )}
                <Typography variant="caption" sx={{ opacity: 0.7 }}>
                    {t('compatibilityModeMediaElements', {
                        count: mediaElementCount,
                    })}
                </Typography>
            </Box>
        </Box>
    );
};

export default CompatibilityPlayer;
