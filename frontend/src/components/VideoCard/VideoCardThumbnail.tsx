import { Folder, MusicNote } from '@mui/icons-material';
import { Box, CardMedia, Chip, Skeleton, useMediaQuery, useTheme } from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { mask, neutral, overlay, shadow } from '../../theme/colors';
import { Video } from '../../types';
import { formatDuration, parseDuration } from '../../utils/formatUtils';
import { THUMBNAIL_PLACEHOLDER_SRC, setThumbnailPlaceholder } from '../../utils/thumbnailPlaceholder';
import { VideoCardCollectionInfo } from '../../utils/videoCardUtils';

interface VideoCardThumbnailProps {
    video: Video;
    thumbnailSrc?: string;
    thumbnailSrcSet?: string;
    thumbnailSizes?: string;
    videoUrl?: string;
    isHovered: boolean;
    isVideoPlaying: boolean;
    setIsVideoPlaying: (playing: boolean) => void;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    collectionInfo: VideoCardCollectionInfo;
    isNew: boolean;
    isAboveTheFold?: boolean; // For LCP optimization
    isHeroImage?: boolean;
    showTagsOnThumbnail?: boolean;
    availableTags?: string[]; // Available tags from settings - used to filter displayed tags
    selectedTags?: string[];
    onTagClick?: (tag: string) => void;
}

const VideoCardThumbnailView: React.FC<VideoCardThumbnailProps> = ({
    video,
    thumbnailSrc,
    thumbnailSrcSet,
    thumbnailSizes,
    videoUrl,
    isHovered,
    isVideoPlaying,
    setIsVideoPlaying,
    videoRef,
    collectionInfo,
    isNew,
    isAboveTheFold = false,
    isHeroImage = false,
    showTagsOnThumbnail = false,
    availableTags = [],
    selectedTags = [],
    onTagClick
}) => {
    const { t } = useLanguage();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const [isImageLoaded, setIsImageLoaded] = useState(false);

    return (
        <Box
            sx={{
                position: 'relative',
                paddingTop: '56.25%', // 16:9 aspect ratio
                borderRadius: isMobile ? 0 : 2,
                overflow: 'hidden'
            }}
        >
            {/* Video Element (only shown on hover) */}
            {isHovered && videoUrl && (
                <Box
                    component="video"
                    ref={videoRef as React.RefObject<HTMLVideoElement>}
                    src={videoUrl}
                    muted
                    autoPlay
                    playsInline
                    onPlaying={() => {
                        setIsVideoPlaying(true);
                    }}
                    sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        bgcolor: neutral.black,
                        borderRadius: 'inherit',
                        zIndex: 1 // Ensure video is above thumbnail when playing
                    }}
                    onLoadedMetadata={(e) => {
                        const duration = parseDuration(video.duration);
                        if (duration > 5) {
                            e.currentTarget.currentTime = Math.max(0, (duration / 2) - 2.5);
                        }
                    }}
                    onTimeUpdate={(e) => {
                        const duration = parseDuration(video.duration);
                        const startTime = Math.max(0, (duration / 2) - 2.5);
                        const endTime = startTime + 5;

                        if (e.currentTarget.currentTime >= endTime) {
                            e.currentTarget.currentTime = startTime;
                            void e.currentTarget.play();
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
                        borderRadius: 'inherit',
                        zIndex: 2
                    }}
                />
            )}

            {/* Thumbnail Image */}
            <CardMedia
                component="img"
                image={thumbnailSrc || THUMBNAIL_PLACEHOLDER_SRC}
                alt={`${video.title} thumbnail`}
                loading={isAboveTheFold ? "eager" : "lazy"}
                fetchPriority={isHeroImage ? "high" : "auto"}
                decoding={isHeroImage ? "sync" : "async"}
                srcSet={thumbnailSrcSet}
                sizes={thumbnailSizes}
                width="480"
                height="270"
                onLoad={() => {
                    setIsImageLoaded(true);
                }}
                sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    opacity: (isImageLoaded && (!isHovered || !isVideoPlaying)) ? 1 : 0,
                    transition: 'opacity 0.2s',
                    borderRadius: 'inherit',
                    pointerEvents: 'none', // Ensure hover events pass through
                    zIndex: 2
                }}
                onError={(e) => {
                    setIsImageLoaded(true);
                    setThumbnailPlaceholder(e.currentTarget);
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
                        bgcolor: overlay.black60,
                        color: neutral.white,
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
                        boxShadow: shadow.thumbnail,
                        pointerEvents: 'none'
                    }}
                />
            )}

            {video.mediaType === 'audio' && (
                <Box
                    component="span"
                    role="img"
                    aria-label={t('downloadAudioOnly')}
                    title={t('downloadAudioOnly')}
                    sx={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        width: 28,
                        height: 28,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: overlay.black60,
                        color: neutral.white,
                        borderRadius: '50%',
                        zIndex: 3,
                        pointerEvents: 'none',
                    }}
                >
                    <MusicNote fontSize="small" />
                </Box>
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
                const filteredTags = video.tags.filter(tag =>
                    availableTagsArray.some(availableTag => availableTag.toLowerCase() === tag.toLowerCase())
                );

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
                            zIndex: 4, // Higher z-index to be above other elements and clickable
                            pointerEvents: 'auto', // Enable pointer events for children
                            maskImage: mask.fadeRight,
                            WebkitMaskImage: mask.fadeRight,
                        }}
                    >
                        {filteredTags.map((tag) => {
                            const isSelected = selectedTags.includes(tag);
                            return (
                                <Chip
                                    key={tag}
                                    label={tag}
                                    size="small"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        if (onTagClick) {
                                            onTagClick(tag);
                                        }
                                    }}
                                    sx={{
                                        height: 20,
                                        fontSize: '0.65rem',
                                        bgcolor: isSelected ? theme.palette.primary.main : overlay.black50,
                                        // Selected chips sit on the bright primary color; use its
                                        // computed contrast text (dark in dark mode) so the label
                                        // stands out instead of white-on-bright.
                                        color: isSelected ? theme.palette.primary.contrastText : neutral.white,
                                        backdropFilter: 'blur(2px)',
                                        '& .MuiChip-label': {
                                            px: 1
                                        },
                                        maxWidth: '100px', // individual tag max width
                                        cursor: 'pointer',
                                        '&:hover': {
                                            bgcolor: isSelected ? theme.palette.primary.dark : overlay.black70
                                        }
                                    }}
                                />
                            );
                        })}
                    </Box>
                );
            })()}
        </Box>
    );
};

export { VideoCardThumbnailView as VideoCardThumbnail };
