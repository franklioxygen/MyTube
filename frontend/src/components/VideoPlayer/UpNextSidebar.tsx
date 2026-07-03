import {
    Add
} from '@mui/icons-material';
import {
    Box,
    Card,
    CardContent,
    CardMedia,
    Chip,
    FormControlLabel,
    Grid,
    IconButton,
    Skeleton,
    Stack,
    Switch,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { neutral, overlay } from '../../theme/colors';
import { useAuth } from '../../contexts/AuthContext';
import { useCloudStorageUrl } from '../../hooks/useCloudStorageUrl';
import { Video } from '../../types';
import { getBackendUrl } from '../../utils/apiUrl';
import { formatDate, formatDuration } from '../../utils/formatUtils';
import { buildSmallThumbnailAbsoluteUrl } from '../../utils/imageOptimization';
import { THUMBNAIL_PLACEHOLDER_SRC, setThumbnailPlaceholder } from '../../utils/thumbnailPlaceholder';

interface UpNextSidebarProps {
    relatedVideos: Video[];
    autoPlayNext: boolean;
    onAutoPlayNextChange: (checked: boolean) => void;
    onVideoClick: (videoId: string) => void;
    onAddToCollection: (videoId: string) => void;
}

const SidebarThumbnail: React.FC<{ video: Video }> = ({ video }) => {
    const [isImageLoaded, setIsImageLoaded] = useState(false);
    // Only load thumbnail from cloud if the video itself is in cloud storage
    const isVideoInCloud = video.videoPath?.startsWith('cloud:') ?? false;
    const thumbnailPathForCloud = isVideoInCloud ? video.thumbnailPath : null;
    const thumbnailUrl = useCloudStorageUrl(thumbnailPathForCloud, 'thumbnail');
    const localThumbnailUrl = !isVideoInCloud
        ? buildSmallThumbnailAbsoluteUrl(
            getBackendUrl(),
            video.thumbnailPath,
            video.thumbnailUrl,
        )
        : undefined;

    return (
        <Box sx={{ width: 180, minWidth: 180, position: 'relative', borderRadius: 2, overflow: 'hidden' }}>
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
                        bgcolor: 'grey.800'
                    }}
                />
            )}
            <CardMedia
                component="img"
                loading="lazy"
                sx={{
                    display: 'block',
                    width: '100%',
                    aspectRatio: '16 / 9',
                    objectFit: 'cover',
                    opacity: isImageLoaded ? 1 : 0,
                    transition: 'opacity 0.2s',
                    // The image is always rendered but hidden until loaded
                }}
                onLoad={() => setIsImageLoaded(true)}
                image={thumbnailUrl || localThumbnailUrl || video.thumbnailUrl || THUMBNAIL_PLACEHOLDER_SRC}
                alt={video.title}
                onError={(e) => {
                    setIsImageLoaded(true);
                    setThumbnailPlaceholder(e.currentTarget);
                }}
            />
            {video.duration && (
                <Chip
                    label={formatDuration(video.duration)}
                    size="small"
                    sx={{
                        position: 'absolute',
                        bottom: 6,
                        right: 6,
                        height: 20,
                        fontSize: '0.75rem',
                        bgcolor: overlay.black80,
                        color: neutral.white
                    }}
                />
            )}
        </Box>
    );
};

const UpNextSidebar: React.FC<UpNextSidebarProps> = ({
    relatedVideos,
    autoPlayNext,
    onAutoPlayNextChange,
    onVideoClick,
    onAddToCollection
}) => {
    const { t } = useLanguage();
    const { userRole } = useAuth();
    const isVisitor = userRole === 'visitor';
    const [hoveredVideoId, setHoveredVideoId] = useState<string | null>(null);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

    const handleAddToCollectionClick = (e: React.MouseEvent, videoId: string) => {
        e.stopPropagation();
        onAddToCollection(videoId);
    };

    return (
        <Box sx={{ p: { xs: 2, md: 0 }, pt: { xs: 2, md: 0 } }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Typography variant="h6" fontWeight="bold" sx={{ mb: 0 }}>{t('upNext')}</Typography>
                <FormControlLabel
                    control={
                        <Switch
                            checked={autoPlayNext}
                            onChange={(e) => onAutoPlayNextChange(e.target.checked)}
                            size="small"
                        />
                    }
                    label={<Typography variant="body2">{t('autoPlayNext')}</Typography>}
                    labelPlacement="start"
                    sx={{ ml: 0, mr: 0 }}
                />
            </Stack>
            <Grid container spacing={1.5}>
                {relatedVideos.map(relatedVideo => (
                    <Grid key={relatedVideo.id} size={{ xs: 12, md: 6, lg: 12 }}>
                        <Card
                            elevation={0}
                            sx={{
                                display: 'flex',
                                cursor: 'pointer',
                                position: 'relative',
                                bgcolor: 'transparent',
                                border: 'none',
                                boxShadow: 'none',
                                backdropFilter: 'none',
                                backgroundImage: 'none',
                                borderRadius: 2,
                                transition: 'background-color 0.15s ease',
                                '&:hover': { bgcolor: 'action.hover' }
                            }}
                            onClick={() => onVideoClick(relatedVideo.id)}
                            onMouseEnter={() => setHoveredVideoId(relatedVideo.id)}
                            onMouseLeave={() => setHoveredVideoId(null)}
                        >
                            <SidebarThumbnail video={relatedVideo} />

                            <CardContent sx={{ flex: '1 1 auto', minWidth: 0, py: 0.25, pl: 1.5, pr: 1, '&:last-child': { pb: 0.25 }, position: 'relative', display: 'flex', flexDirection: 'column' }}>
                                <Typography variant="body2" fontWeight="bold" sx={{ lineHeight: 1.2, mb: 0.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                    {relatedVideo.title}
                                </Typography>
                                <Typography
                                    variant="caption"
                                    display="block"
                                    color="text.secondary"
                                    title={relatedVideo.author}
                                    sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                >
                                    {relatedVideo.author}
                                </Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', mt: 'auto' }}>
                                    <Typography variant="caption" color="text.secondary">
                                        {formatDate(relatedVideo.date)}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                        ·  {relatedVideo.viewCount || 0} {t('views')}
                                    </Typography>
                                </Box>

                                {hoveredVideoId === relatedVideo.id && !isMobile && !isTouch && !isVisitor && (
                                    <Tooltip title={t('addToCollection')} disableHoverListener={isTouch}>
                                        <IconButton
                                            size="small"
                                            onClick={(e) => handleAddToCollectionClick(e, relatedVideo.id)}
                                            sx={{
                                                position: 'absolute',
                                                bottom: 4,
                                                right: 4,
                                                padding: 0.5,
                                                bgcolor: overlay.black90,
                                                color: neutral.white,
                                                '&:hover': { bgcolor: neutral.black },
                                            }}
                                        >
                                            <Add fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                )}
                            </CardContent>
                        </Card>
                    </Grid>
                ))}
            </Grid>
            {relatedVideos.length === 0 && (
                <Typography variant="body2" color="text.secondary">{t('noOtherVideos')}</Typography>
            )}
        </Box>
    );
};

export default UpNextSidebar;
