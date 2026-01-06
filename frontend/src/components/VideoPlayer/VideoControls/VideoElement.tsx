import { Box, Typography } from '@mui/material';
import React, { useMemo } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';

interface VideoElementProps {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    src: string;
    poster?: string;
    isLoading: boolean;
    loadError: string | null;
    subtitles: Array<{ language: string; filename: string; path: string }>;
    onClick: () => void;
    onPlay: () => void;
    onPause: () => void;
    onEnded?: () => void;
    onTimeUpdate: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
    onError: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
    onLoadStart: () => void;
    onCanPlay: () => void;
    onLoadedData: () => void;
    onProgress?: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
    onWaiting?: () => void;
    onCanPlayThrough?: () => void;
    onSubtitleInit: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
}

const VideoElement: React.FC<VideoElementProps> = ({
    videoRef,
    src,
    poster,
    isLoading,
    loadError,
    subtitles,
    onClick,
    onPlay,
    onPause,
    onEnded,
    onTimeUpdate,
    onLoadedMetadata,
    onError,
    onLoadStart,
    onCanPlay,
    onLoadedData,
    onProgress,
    onWaiting,
    onCanPlayThrough,
    onSubtitleInit
}) => {
    const { t } = useLanguage();
    // Use useMemo to generate a stable unique ID per component instance
    // Using Date.now() and a simple counter is safe for non-cryptographic purposes
    const videoId = useMemo(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const counter = (globalThis as any).__videoControlCounter = ((globalThis as any).__videoControlCounter || 0) + 1;
        return `video-controls-${Date.now()}-${counter}`;
    }, []);

    return (
        <>
            {/* Scoped style for centering subtitles */}
            <style>
                {`
                    #${videoId}::cue {
                        text-align: center !important;
                        line-height: 1.5;
                        background-color: rgba(0, 0, 0, 0.8);
                    }
                    
                    #${videoId}::-webkit-media-text-track-display {
                        text-align: center !important;
                    }
                    
                    #${videoId}::-webkit-media-text-track-container {
                        text-align: center !important;
                        display: flex;
                        justify-content: center;
                        align-items: flex-end;
                    }
                    
                    #${videoId}::cue-region {
                        text-align: center !important;
                    }
                `}
            </style>

            {/* Loading indicator */}
            {isLoading && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        zIndex: 10,
                        bgcolor: 'rgba(0, 0, 0, 0.7)',
                        borderRadius: 2,
                        p: 2,
                        color: 'white'
                    }}
                >
                    <Typography variant="body2">{t('loadingVideo') || 'Loading video...'}</Typography>
                </Box>
            )}

            {/* Error message */}
            {loadError && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        zIndex: 10,
                        bgcolor: 'rgba(211, 47, 47, 0.9)',
                        borderRadius: 2,
                        p: 2,
                        color: 'white',
                        maxWidth: '80%',
                        textAlign: 'center'
                    }}
                >
                    <Typography variant="body2">{loadError}</Typography>
                </Box>
            )}

            <video
                id={videoId}
                ref={videoRef}
                style={{ width: '100%', aspectRatio: '16/9', display: 'block', cursor: 'pointer' }}
                controls={false}
                src={src}
                preload="metadata"
                onClick={onClick}
                onPlay={onPlay}
                onPause={onPause}
                onEnded={onEnded}
                onTimeUpdate={onTimeUpdate}
                onLoadedMetadata={(e) => {
                    onLoadedMetadata(e);
                    onSubtitleInit(e);
                }}
                onError={onError}
                onLoadStart={onLoadStart}
                onCanPlay={onCanPlay}
                onLoadedData={onLoadedData}
                onProgress={onProgress}
                onWaiting={onWaiting}
                onCanPlayThrough={onCanPlayThrough}
                playsInline
                crossOrigin="anonymous"
                poster={poster}
            >
                {subtitles && subtitles.map((subtitle) => (
                    <track
                        key={subtitle.language}
                        kind="subtitles"
                        src={`${import.meta.env.VITE_BACKEND_URL}${subtitle.path}`}
                        srcLang={subtitle.language}
                        label={subtitle.language.toUpperCase()}
                    />
                ))}
                Your browser does not support the video tag.
            </video>
        </>
    );
};

export default VideoElement;

