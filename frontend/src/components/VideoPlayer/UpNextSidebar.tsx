import {
    Box,
    Card,
    CardContent,
    CardMedia,
    Chip,
    FormControlLabel,
    Stack,
    Switch,
    Typography
} from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Video } from '../../types';
import { formatDate, formatDuration } from '../../utils/formatUtils';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

interface UpNextSidebarProps {
    relatedVideos: Video[];
    autoPlayNext: boolean;
    onAutoPlayNextChange: (checked: boolean) => void;
    onVideoClick: (videoId: string) => void;
}

const UpNextSidebar: React.FC<UpNextSidebarProps> = ({
    relatedVideos,
    autoPlayNext,
    onAutoPlayNextChange,
    onVideoClick
}) => {
    const { t } = useLanguage();

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
            <Stack spacing={2}>
                {relatedVideos.map(relatedVideo => (
                    <Card
                        key={relatedVideo.id}
                        sx={{ display: 'flex', cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                        onClick={() => onVideoClick(relatedVideo.id)}
                    >
                        <Box sx={{ width: 168, minWidth: 168, position: 'relative' }}>
                            <CardMedia
                                component="img"
                                sx={{ width: '100%', height: 94, objectFit: 'cover' }}
                                image={`${BACKEND_URL}${relatedVideo.thumbnailPath}`}
                                alt={relatedVideo.title}
                                onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.onerror = null;
                                    target.src = 'https://via.placeholder.com/168x94?text=No+Thumbnail';
                                }}
                            />
                            {relatedVideo.duration && (
                                <Chip
                                    label={formatDuration(relatedVideo.duration)}
                                    size="small"
                                    sx={{
                                        position: 'absolute',
                                        bottom: 4,
                                        right: 4,
                                        height: 20,
                                        fontSize: '0.75rem',
                                        bgcolor: 'rgba(0,0,0,0.8)',
                                        color: 'white'
                                    }}
                                />
                            )}
                        </Box>
                        <CardContent sx={{ flex: '1 1 auto', minWidth: 0, p: 1, '&:last-child': { pb: 1 } }}>
                            <Typography variant="body2" fontWeight="bold" sx={{ lineHeight: 1.2, mb: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                                {relatedVideo.title}
                            </Typography>
                            <Typography variant="caption" display="block" color="text.secondary">
                                {relatedVideo.author}
                            </Typography>
                            <Typography variant="caption" display="block" color="text.secondary">
                                {formatDate(relatedVideo.date)}
                            </Typography>
                            <Typography variant="caption" display="block" color="text.secondary">
                                {relatedVideo.viewCount || 0} {t('views')}
                            </Typography>
                        </CardContent>
                    </Card>
                ))}
                {relatedVideos.length === 0 && (
                    <Typography variant="body2" color="text.secondary">{t('noOtherVideos')}</Typography>
                )}
            </Stack>
        </Box>
    );
};

export default UpNextSidebar;
