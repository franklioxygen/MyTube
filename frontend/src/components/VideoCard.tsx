import {
    Delete,
    Folder
} from '@mui/icons-material';
import {
    Box,
    Card,
    CardActionArea,
    CardContent,
    CardMedia,
    Chip,
    IconButton,
    Typography,
    useMediaQuery,
    useTheme
} from '@mui/material';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { Collection, Video } from '../types';
import { formatDuration, parseDuration } from '../utils/formatUtils';
import ConfirmationModal from './ConfirmationModal';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

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
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [isVideoPlaying, setIsVideoPlaying] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);



    const handleMouseEnter = () => {
        if (!isMobile && video.videoPath) {
            setIsHovered(true);
        }
    };

    const handleMouseLeave = () => {
        setIsHovered(false);
        setIsVideoPlaying(false);
    };

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



    // Use local thumbnail if available, otherwise fall back to the original URL
    const thumbnailSrc = video.thumbnailPath
        ? `${BACKEND_URL}${video.thumbnailPath}`
        : video.thumbnailUrl;

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

    // Handle delete click
    const handleDeleteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!onDeleteVideo) return;
        setShowDeleteModal(true);
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



    return (
        <>
            <Card
                sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    transition: 'transform 0.2s, box-shadow 0.2s, background-color 0.3s, color 0.3s, border-color 0.3s',
                    '&:hover': {
                        transform: 'translateY(-4px)',
                        boxShadow: theme.shadows[8],
                        '& .delete-btn': {
                            opacity: 1
                        }
                    },
                    border: isFirstInAnyCollection ? `1px solid ${theme.palette.primary.main}` : 'none'
                }}
            >
                <CardActionArea
                    onClick={handleVideoNavigation}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                    sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                >
                    <Box sx={{ position: 'relative', paddingTop: '56.25%' /* 16:9 aspect ratio */ }}>
                        {isHovered && video.videoPath && (
                            <Box
                                component="video"
                                ref={videoRef}
                                src={`${BACKEND_URL}${video.videoPath}`}
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
                                    bgcolor: 'black'
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

                        <CardMedia
                            component="img"
                            image={thumbnailSrc || 'https://via.placeholder.com/480x360?text=No+Thumbnail'}
                            alt={`${video.title} thumbnail`}
                            sx={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                                opacity: (isHovered && isVideoPlaying) ? 0 : 1,
                                transition: 'opacity 0.2s',
                                pointerEvents: 'none' // Ensure hover events pass through to the video if needed, though parent handles it
                            }}
                            onError={(e) => {
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
                                sx={{ position: 'absolute', bottom: 36, right: 8 }}
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
                                    bgcolor: 'rgba(0,0,0,0.8)',
                                    color: 'white'
                                }}
                            />
                        )}

                        {isFirstInAnyCollection && (
                            <Chip
                                icon={<Folder />}
                                label={firstInCollectionNames.length > 1 ? `${firstInCollectionNames[0]} +${firstInCollectionNames.length - 1}` : firstInCollectionNames[0]}
                                color="secondary"
                                size="small"
                                sx={{ position: 'absolute', top: 8, left: 8 }}
                            />
                        )}
                    </Box>

                    <CardContent sx={{ flexGrow: 1, p: 2 }}>
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

                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 'auto' }}>
                            <Typography
                                variant="body2"
                                color="text.secondary"
                                onClick={handleAuthorClick}
                                sx={{
                                    cursor: 'pointer',
                                    '&:hover': { color: 'primary.main' },
                                    fontWeight: 500
                                }}
                            >
                                {video.author}
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
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

                {showDeleteButton && onDeleteVideo && !isMobile && (
                    <IconButton
                        className="delete-btn"
                        onClick={handleDeleteClick}
                        disabled={isDeleting}
                        size="small"
                        sx={{
                            position: 'absolute',
                            top: 8,
                            right: 8,
                            bgcolor: 'rgba(0,0,0,0.6)',
                            color: 'white',
                            opacity: 0, // Hidden by default, shown on hover
                            transition: 'opacity 0.2s',
                            '&:hover': {
                                bgcolor: 'error.main',
                            }
                        }}
                    >
                        <Delete fontSize="small" />
                    </IconButton>
                )}
            </Card>

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
        </>
    );
};

export default VideoCard;
