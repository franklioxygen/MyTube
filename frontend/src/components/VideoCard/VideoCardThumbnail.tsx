import { Folder } from '@mui/icons-material';
import { Box, CardMedia, Chip, Skeleton, useTheme } from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Video } from '../../types';
import { formatDuration, parseDuration } from '../../utils/formatUtils';
import { VideoCardCollectionInfo } from '../../utils/videoCardUtils';

interface VideoCardThumbnailProps {
    video: Video;
    thumbnailSrc?: string;
    videoUrl?: string;
    isHovered: boolean;
    isVideoPlaying: boolean;
    setIsVideoPlaying: (playing: boolean) => void;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    collectionInfo: VideoCardCollectionInfo;
    isNew: boolean;
    isAboveTheFold?: boolean; // For LCP optimization
    showTagsOnThumbnail?: boolean;
    availableTags?: string[]; // Available tags from settings - used to filter displayed tags
}

export const VideoCardThumbnail: React.FC<VideoCardThumbnailProps> = ({
    video,
    thumbnailSrc,
    videoUrl,
    isHovered,
    isVideoPlaying,
    setIsVideoPlaying,
    videoRef,
    collectionInfo,
    isNew,
    isAboveTheFold = false,
    showTagsOnThumbnail = false,
    availableTags = []
}) => {
    const { t } = useLanguage();
    const theme = useTheme();
    const [isImageLoaded, setIsImageLoaded] = useState(false);

    return (
        <Box sx={{ position: 'relative', paddingTop: '56.25%' /* 16:9 aspect ratio */ }}>
            {/* Video Element (only shown on hover) */}
            {isHovered && videoUrl && (
                <Box
                    component="video"
                    ref={videoRef as React.RefObject<HTMLVideoElement>}
                    src={videoUrl}
                    muted
                    autoPlay
                    playsInline
                    onPlaying={() => setIsVideoPlaying(true)}
                    sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        bgcolor: 'black',
                        zIndex: 1 // Ensure video is above thumbnail when playing
                    }}
                    onLoadedMetadata={(e) => {
                        const videoEl = e.target as HTMLVideoElement;
                        const duration = parseDuration(video.duration);
                        if (duration > 5) {
                            videoEl.currentTime = Math.max(0, (duration / 2) - 2.5);
                        }
                    }}
                    onTimeUpdate={(e) => {
                        const videoEl = e.target as HTMLVideoElement;
                        const duration = parseDuration(video.duration);
                        const startTime = Math.max(0, (duration / 2) - 2.5);
                        const endTime = startTime + 5;

                        if (videoEl.currentTime >= endTime) {
                            videoEl.currentTime = startTime;
                            videoEl.play();
                        }
                    }}
                />
            )}

            {/* Skeleton Placeholder */}
            {!isImageLoaded && (
                <Skeleton
                    variant="rectangular"
                    width="100%"
                    height="100%"
                    animation="wave"
                    sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        bgcolor: 'grey.800',
                        zIndex: 2
                    }}
                />
            )}

            {/* Thumbnail Image */}
            <CardMedia
                component="img"
                image={thumbnailSrc || 'https://via.placeholder.com/480x360?text=No+Thumbnail'}
                alt={`${video.title} thumbnail`}
                loading={isAboveTheFold ? "eager" : "lazy"}
                fetchPriority={isAboveTheFold ? "high" : "auto"}
                decoding={isAboveTheFold ? "sync" : "async"}
                width="480"
                height="270"
                onLoad={() => setIsImageLoaded(true)}
                sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    opacity: (isImageLoaded && (!isHovered || !isVideoPlaying)) ? 1 : 0,
                    transition: 'opacity 0.2s',
                    pointerEvents: 'none', // Ensure hover events pass through
                    zIndex: 2
                }}
                onError={(e) => {
                    // If error, we can still show the placeholder or the fallback image
                    // For now, let's treat error as loaded so we see the fallback/alt text if any
                    setIsImageLoaded(true);
                    const target = e.target as HTMLImageElement;
                    target.onerror = null;
                    target.src = 'https://via.placeholder.com/480x360?text=No+Thumbnail';
                }}
            />

            {video.partNumber && video.totalParts && video.totalParts > 1 && (
                <Chip
                    label={`${t('part')} ${video.partNumber}/${video.totalParts}`}
                    size="small"
                    color="primary"
                    sx={{ position: 'absolute', bottom: 36, right: 8, zIndex: 3 }}
                />
            )}

            {video.duration && (
                <Chip
                    label={formatDuration(video.duration)}
                    size="small"
                    sx={{
                        position: 'absolute',
                        bottom: 8,
                        right: 8,
                        height: 20,
                        fontSize: '0.75rem',
                        bgcolor: 'rgba(0,0,0,0.6)',
                        color: 'white',
                        zIndex: 3
                    }}
                />
            )}

            {isNew && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: 0,
                        height: 0,
                        borderStyle: 'solid',
                        borderWidth: '25px 25px 0 0',
                        borderColor: `${theme.palette.error.main} transparent transparent transparent`,
                        opacity: 0.8,
                        zIndex: 10,
                        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                        pointerEvents: 'none'
                    }}
                />
            )}

            {collectionInfo.isFirstInAnyCollection && (
                <Chip
                    icon={<Folder />}
                    label={collectionInfo.firstInCollectionNames.length > 1
                        ? `${collectionInfo.firstInCollectionNames[0]} +${collectionInfo.firstInCollectionNames.length - 1}`
                        : collectionInfo.firstInCollectionNames[0]}
                    color="secondary"
                    size="small"
                    sx={{
                        position: 'absolute',
                        top: isNew ? 32 : 8,
                        left: 8,
                        zIndex: 3
                    }}
                />
            )}

            {showTagsOnThumbnail && video.tags && video.tags.length > 0 && (() => {
                // Filter tags to only show tags that are in availableTags
                // This ensures that when a tag is removed from settings, it's also removed from the display
                const availableTagsArray = Array.isArray(availableTags) ? availableTags : [];
                const filteredTags = video.tags.filter(tag => availableTagsArray.includes(tag));
                
                if (filteredTags.length === 0) return null;
                
                return (
                    <Box
                        sx={{
                            position: 'absolute',
                            bottom: 8,
                            left: 8,
                            right: 60, // Leave space for duration
                            display: 'flex',
                            flexWrap: 'nowrap',
                            gap: 0.5,
                            overflow: 'hidden',
                            zIndex: 2,
                            pointerEvents: 'none',
                            maskImage: 'linear-gradient(to right, black 90%, transparent 100%)',
                            WebkitMaskImage: 'linear-gradient(to right, black 90%, transparent 100%)'
                        }}
                    >
                        {filteredTags.map((tag) => (
                            <Chip
                                key={tag}
                                label={tag}
                                size="small"
                                sx={{
                                    height: 20,
                                    fontSize: '0.65rem',
                                    bgcolor: 'rgba(0, 0, 0, 0.5)',
                                    color: 'white',
                                    backdropFilter: 'blur(2px)',
                                    '& .MuiChip-label': {
                                        px: 1
                                    },
                                    maxWidth: '100px' // individual tag max width
                                }}
                            />
                        ))}
                    </Box>
                );
            })()}
        </Box>
    );
};
