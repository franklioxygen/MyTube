import {
    Folder
} from '@mui/icons-material';
import {
    Box,
    Card,
    CardActionArea,
    CardContent,
    CardMedia,
    Chip,
    Menu, MenuItem,
    Skeleton,
    Typography,
    useMediaQuery,
    useTheme
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCollection } from '../contexts/CollectionContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext'; // Added
import { useVideo } from '../contexts/VideoContext';
import { useCloudStorageUrl } from '../hooks/useCloudStorageUrl';
import { useShareVideo } from '../hooks/useShareVideo'; // Added
import { Collection, Video } from '../types';
import { formatDuration, parseDuration } from '../utils/formatUtils';
import { getAvailablePlayers, getPlayerUrl } from '../utils/playerUtils'; // Added
import CollectionModal from './CollectionModal';
import ConfirmationModal from './ConfirmationModal';
import VideoKebabMenuButtons from './VideoPlayer/VideoInfo/VideoKebabMenuButtons'; // Added

interface VideoCardProps {
    video: Video;
    collections?: Collection[];
    onDeleteVideo?: (id: string) => Promise<any>;
    showDeleteButton?: boolean;
    disableCollectionGrouping?: boolean;
}

const VideoCard: React.FC<VideoCardProps> = ({
    video,
    collections = [],
    onDeleteVideo,
    showDeleteButton = false,
    disableCollectionGrouping = false
}) => {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [isVideoPlaying, setIsVideoPlaying] = useState(false);
    const [isImageLoaded, setIsImageLoaded] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);

    // New state for player menu
    const [playerMenuAnchor, setPlayerMenuAnchor] = useState<null | HTMLElement>(null);

    // Hooks for share and snackbar
    const { handleShare } = useShareVideo(video);
    const { showSnackbar } = useSnackbar();
    const { updateVideo, incrementView } = useVideo();



    const handleMouseEnter = () => {
        if (!isMobile && video.videoPath) {
            setIsHovered(true);
        }
    };

    const handleMouseLeave = () => {
        setIsHovered(false);
        setIsVideoPlaying(false);
        // Cleanup video element when mouse leaves
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.src = '';
            videoRef.current.load();
        }
    };

    // Cleanup video element on unmount
    useEffect(() => {
        return () => {
            if (videoRef.current) {
                videoRef.current.pause();
                videoRef.current.src = '';
                videoRef.current.load();
            }
        };
    }, []);

    // Format the date (assuming format YYYYMMDD from youtube-dl)
    const formatDate = (dateString: string) => {
        if (!dateString || dateString.length !== 8) {
            return t('unknownDate');
        }

        const year = dateString.substring(0, 4);
        const month = dateString.substring(4, 6);
        const day = dateString.substring(6, 8);

        return `${year}-${month}-${day}`;
    };



    // Use cloud storage hook for thumbnail URL only if video is in cloud storage
    // Only load thumbnail from cloud if the video itself is in cloud storage
    const isVideoInCloud = video.videoPath?.startsWith('cloud:') ?? false;
    const thumbnailPathForCloud = isVideoInCloud ? video.thumbnailPath : null;
    const thumbnailUrl = useCloudStorageUrl(thumbnailPathForCloud, 'thumbnail');
    const localThumbnailUrl = !isVideoInCloud && video.thumbnailPath
        ? `${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5551'}${video.thumbnailPath}`
        : undefined;
    const thumbnailSrc = thumbnailUrl || localThumbnailUrl || video.thumbnailUrl;

    // Use cloud storage hook for video URL
    const videoUrl = useCloudStorageUrl(video.videoPath, 'video');

    // Handle author click
    const handleAuthorClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigate(`/author/${encodeURIComponent(video.author)}`);
    };

    // Handle confirm delete
    const confirmDelete = async () => {
        if (!onDeleteVideo) return;

        setIsDeleting(true);
        try {
            await onDeleteVideo(video.id);
        } catch (error) {
            console.error('Error deleting video:', error);
            setIsDeleting(false);
        }
    };

    // Find collections this video belongs to
    const videoCollections = collections.filter(collection =>
        collection.videos.includes(video.id)
    );

    // Check if this video is the first in any collection
    const isFirstInAnyCollection = !disableCollectionGrouping && videoCollections.some(collection =>
        collection.videos[0] === video.id
    );

    // Get collection names where this video is the first
    const firstInCollectionNames = videoCollections
        .filter(collection => collection.videos[0] === video.id)
        .map(collection => collection.name);

    // Get the first collection ID where this video is the first video
    const firstCollectionId = isFirstInAnyCollection
        ? videoCollections.find(collection => collection.videos[0] === video.id)?.id
        : null;

    // Check if video is new (0 views and added within 7 days)
    const isNewVideo = React.useMemo(() => {
        // Check if viewCount is 0 or null/undefined (unwatched)
        // Handle both number and string types
        const viewCountNum = typeof video.viewCount === 'string' ? parseInt(video.viewCount, 10) : video.viewCount;
        const hasNoViews = viewCountNum === 0 || viewCountNum === null || viewCountNum === undefined || isNaN(viewCountNum);
        if (!hasNoViews) {
            return false;
        }

        // Check if addedAt exists
        if (!video.addedAt) {
            return false;
        }

        // Check if added within 7 days
        const addedDate = new Date(video.addedAt);
        const now = new Date();

        // Handle invalid dates
        if (isNaN(addedDate.getTime())) {
            return false;
        }

        const daysDiff = (now.getTime() - addedDate.getTime()) / (1000 * 60 * 60 * 24);
        const isWithin7Days = daysDiff >= 0 && daysDiff <= 7; // >= 0 to handle future dates

        // Debug log (can be removed later)
        if (process.env.NODE_ENV === 'development') {
            console.log(`Video ${video.id}: viewCount=${video.viewCount} (parsed: ${viewCountNum}), addedAt=${video.addedAt}, daysDiff=${daysDiff.toFixed(2)}, isNew=${isWithin7Days}`);
        }

        return isWithin7Days;
    }, [video.viewCount, video.addedAt, video.id]);

    // Handle video navigation
    const handleVideoNavigation = () => {
        // If this is the first video in a collection, navigate to the collection page
        if (isFirstInAnyCollection && firstCollectionId) {
            navigate(`/collection/${firstCollectionId}`);
        } else {
            // Otherwise navigate to the video player page
            navigate(`/video/${video.id}`);
        }
    };


    // Player Logic
    const getVideoUrl = async (): Promise<string> => {
        // If we have a cloud storage URL, use it directly
        if (videoUrl) {
            return videoUrl;
        }

        // If cloud storage path but URL not loaded yet, wait for it
        if (video.videoPath?.startsWith('cloud:')) {
            // Try to get the signed URL directly
            const { getFileUrl } = await import('../utils/cloudStorage');
            const cloudUrl = await getFileUrl(video.videoPath, 'video');
            if (cloudUrl) {
                return cloudUrl;
            }
            // If still not available, return empty string
            return '';
        }

        // Otherwise, construct URL from videoPath
        if (video.videoPath) {
            const videoPath = video.videoPath.startsWith('/') ? video.videoPath : `/${video.videoPath}`;
            return `${window.location.origin}${videoPath}`;
        }
        return video.sourceUrl || '';
    };

    const handlePlayerMenuClose = () => {
        setPlayerMenuAnchor(null);
    };

    const handlePlayerSelect = async (player: string) => {
        const resolvedVideoUrl = await getVideoUrl();

        if (!resolvedVideoUrl) {
            showSnackbar(t('error') || 'Video URL not available', 'error');
            handlePlayerMenuClose();
            return;
        }

        // Increment view count since we can't track watch time in external players
        await incrementView(video.id);

        try {
            let playerUrl = '';

            if (player === 'copy') {
                // Copy URL to clipboard
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(resolvedVideoUrl).then(() => {
                        showSnackbar(t('linkCopied'), 'success');
                    }).catch(() => {
                        showSnackbar(t('copyFailed'), 'error');
                    });
                } else {
                    // Fallback
                    const textArea = document.createElement("textarea");
                    textArea.value = resolvedVideoUrl;
                    textArea.style.position = "fixed";
                    document.body.appendChild(textArea);
                    textArea.focus();
                    textArea.select();
                    try {
                        const successful = document.execCommand('copy');
                        if (successful) {
                            showSnackbar(t('linkCopied'), 'success');
                        } else {
                            showSnackbar(t('copyFailed'), 'error');
                        }
                    } catch (err) {
                        showSnackbar(t('copyFailed'), 'error');
                    }
                    document.body.removeChild(textArea);
                }
                handlePlayerMenuClose();
                return;
            } else {
                playerUrl = getPlayerUrl(player, resolvedVideoUrl);
            }

            // Try to open the player URL using a hidden anchor element
            // This prevents navigation away from the page
            if (playerUrl) {
                const link = document.createElement('a');
                link.href = playerUrl;
                link.style.display = 'none';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                // Show a message after a short delay
                setTimeout(() => {
                    showSnackbar(t('openInExternalPlayer'), 'info');
                }, 500);
            }

        } catch (error) {
            console.error('Error opening player:', error);
            showSnackbar(t('copyFailed'), 'error');
        }

        handlePlayerMenuClose();
    };



    // Collections Logic (State and Handlers)
    const { collections: allCollections, addToCollection, createCollection, removeFromCollection } = useCollection();
    const [showCollectionModal, setShowCollectionModal] = useState(false);

    const handleAddToCollection = async (collectionId: string) => {
        if (!video.id) return;
        await addToCollection(collectionId, video.id);
    };

    const handleCreateCollection = async (name: string) => {
        if (!video.id) return;
        await createCollection(name, video.id);
    };

    const handleRemoveFromCollection = async () => {
        if (!video.id) return;
        await removeFromCollection(video.id);
    };

    // Handle visibility toggle
    const handleToggleVisibility = async () => {
        if (!video.id) return;
        const newVisibility = (video.visibility ?? 1) === 0 ? 1 : 0;
        const result = await updateVideo(video.id, { visibility: newVisibility });
        if (result.success) {
            showSnackbar(newVisibility === 1 ? t('showVideo') : t('hideVideo'), 'success');
        } else {
            showSnackbar(t('error'), 'error');
        }
    };

    // Calculate collections that contain THIS video
    const currentVideoCollections = allCollections.filter(c => c.videos.includes(video.id));

    return (
        <>
            <Card
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    transition: 'transform 0.2s, box-shadow 0.2s, background-color 0.3s, color 0.3s, border-color 0.3s',
                    borderRadius: isMobile ? 0 : undefined,
                    ...(!isMobile && {
                        '&:hover': {
                            transform: 'translateY(-4px)',
                            boxShadow: theme.shadows[8],
                            '& .delete-btn': {
                                opacity: 1
                            },
                            '& .add-btn': {
                                opacity: 1
                            }
                        }
                    }),
                    border: isFirstInAnyCollection ? `1px solid ${theme.palette.primary.main}` : 'none'
                }}
            >
                <CardActionArea
                    onClick={handleVideoNavigation}
                    sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                >
                    <Box sx={{ position: 'relative', paddingTop: '56.25%' /* 16:9 aspect ratio */ }}>
                        {/* Video Element (only shown on hover) */}
                        {isHovered && videoUrl && (
                            <Box
                                component="video"
                                ref={videoRef}
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

                        {isNewVideo && (
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

                        {isFirstInAnyCollection && (
                            <Chip
                                icon={<Folder />}
                                label={firstInCollectionNames.length > 1 ? `${firstInCollectionNames[0]} +${firstInCollectionNames.length - 1}` : firstInCollectionNames[0]}
                                color="secondary"
                                size="small"
                                sx={{
                                    position: 'absolute',
                                    top: isNewVideo ? 32 : 8,
                                    left: 8,
                                    zIndex: 3
                                }}
                            />
                        )}


                    </Box>

                    <CardContent sx={{ flexGrow: 1, p: 2, display: 'flex', flexDirection: 'column' }}>
                        <Typography gutterBottom variant="subtitle1" component="div" sx={{ fontWeight: 600, lineHeight: 1.2, mb: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {isFirstInAnyCollection ? (
                                <>
                                    {firstInCollectionNames[0]}
                                    {firstInCollectionNames.length > 1 && <Typography component="span" color="text.secondary" sx={{ fontSize: 'inherit' }}> +{firstInCollectionNames.length - 1}</Typography>}
                                </>
                            ) : (
                                video.title
                            )}
                        </Typography>

                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 'auto', gap: 1 }}>
                            <Typography
                                variant="body2"
                                color="text.secondary"
                                onClick={handleAuthorClick}
                                sx={{
                                    cursor: 'pointer',
                                    '&:hover': { color: 'primary.main' },
                                    fontWeight: 500,
                                    flex: 1,
                                    minWidth: 0, // Allows flex item to shrink below content size
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                {video.author}
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                                <Typography variant="caption" color="text.secondary">
                                    {formatDate(video.date)}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                    {video.viewCount || 0} {t('views')}
                                </Typography>
                            </Box>
                        </Box>
                    </CardContent>
                </CardActionArea>

                <Box
                    sx={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        zIndex: 10,
                        opacity: (!isMobile && !isTouch && !isHovered) ? 0 : 1, // Show on hover for desktop, always for mobile/touch if needed (though usually kebab is cleaner hidden until interaction or hover? Let's stick to hover for desktop)
                        transition: 'opacity 0.2s',
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <VideoKebabMenuButtons
                        onPlayWith={(anchor) => setPlayerMenuAnchor(anchor)}
                        onShare={handleShare}
                        onAddToCollection={() => setShowCollectionModal(true)}
                        onDelete={(showDeleteButton && onDeleteVideo) ? () => setShowDeleteModal(true) : undefined}
                        isDeleting={isDeleting}
                        onToggleVisibility={handleToggleVisibility}
                        video={video}
                        sx={{
                            color: 'white',
                            bgcolor: 'rgba(0,0,0,0.6)',
                            '&:hover': {
                                bgcolor: 'rgba(0,0,0,0.8)',
                                color: 'primary.main'
                            }
                        }}
                    />
                </Box>
            </Card>

            <Menu
                anchorEl={playerMenuAnchor}
                open={Boolean(playerMenuAnchor)}
                onClose={handlePlayerMenuClose}
                anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'right', // Align right for the card menu
                }}
                transformOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                }}
            >
                {getAvailablePlayers().map((player) => (
                    <MenuItem key={player.id} onClick={() => handlePlayerSelect(player.id)}>
                        {player.name}
                    </MenuItem>
                ))}
                <MenuItem onClick={() => handlePlayerSelect('copy')}>{t('copyUrl')}</MenuItem>
            </Menu>

            <ConfirmationModal
                isOpen={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
                onConfirm={confirmDelete}
                title={t('deleteVideo')}
                message={`${t('confirmDelete')} "${video.title}"?`}
                confirmText={t('delete')}
                cancelText={t('cancel')}
                isDanger={true}
            />

            <CollectionModal
                open={showCollectionModal}
                onClose={() => setShowCollectionModal(false)}
                videoCollections={currentVideoCollections}
                collections={allCollections}
                onAddToCollection={handleAddToCollection}
                onCreateCollection={handleCreateCollection}
                onRemoveFromCollection={handleRemoveFromCollection}
            />
        </>
    );
};

export default VideoCard;
