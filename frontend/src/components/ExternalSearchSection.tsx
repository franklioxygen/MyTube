import { Download, OndemandVideo, YouTube } from '@mui/icons-material';
import {
    Box,
    Button,
    Card,
    CardActions,
    CardContent,
    CardMedia,
    Chip,
    CircularProgress,
    Grid,
    Typography
} from '@mui/material';
import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { VideoSearchResult } from '../types';
import { neutral, overlay, platform } from '../theme/colors';
import { formatDuration } from '../utils/formatUtils';
import { THUMBNAIL_PLACEHOLDER_SRC, setThumbnailPlaceholder } from '../utils/thumbnailPlaceholder';

interface ExternalSearchSectionProps {
    /** Which platform's results these are; drives the heading color and badge. */
    source: 'youtube' | 'bilibili';
    heading: string;
    loadingLabel: string;
    emptyLabel: string;
    results: VideoSearchResult[];
    loading: boolean;
    loadingMore: boolean;
    onLoadMore: () => void;
    onDownload: (result: VideoSearchResult) => void;
    downloadingId: string | null;
}

const formatViewCount = (count?: number) => {
    if (!count) return '0';
    if (count < 1000) return count.toString();
    if (count < 1000000) return `${(count / 1000).toFixed(1)}K`;
    return `${(count / 1000000).toFixed(1)}M`;
};

/**
 * One platform's block of online search results on the search page.
 *
 * YouTube and Bilibili results are the same card with a different heading and
 * badge, so both sections render through this rather than keeping two copies of
 * the grid in step by hand.
 */
const ExternalSearchSection: React.FC<ExternalSearchSectionProps> = ({
    source,
    heading,
    loadingLabel,
    emptyLabel,
    results,
    loading,
    loadingMore,
    onLoadMore,
    onDownload,
    downloadingId
}) => {
    const { t } = useLanguage();
    const sourceColor = source === 'bilibili' ? platform.bilibili : platform.youtube;
    const hasResults = results && results.length > 0;

    return (
        <Box>
            <Typography variant="h5" sx={{ mb: 3, fontWeight: 600, color: sourceColor }}>
                {heading}
            </Typography>

            {loading ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4 }}>
                    <CircularProgress sx={{ color: sourceColor }} />
                    <Typography sx={{ mt: 2 }}>{loadingLabel}</Typography>
                </Box>
            ) : hasResults ? (
                <>
                    <Grid container spacing={3}>
                        {results.map((result) => (
                            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={result.id}>
                                <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                                    <Box sx={{ position: 'relative', paddingTop: '56.25%' }}>
                                        <CardMedia
                                            component="img"
                                            image={result.thumbnailUrl || THUMBNAIL_PLACEHOLDER_SRC}
                                            alt={result.title}
                                            // Bilibili's CDN answers 403 to a hotlinked request
                                            // from any other origin, so the thumbnail only loads
                                            // when the browser sends no Referer. YouTube's CDN
                                            // does not care either way.
                                            referrerPolicy="no-referrer"
                                            sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                                            onError={(e) => {
                                                setThumbnailPlaceholder(e.currentTarget);
                                            }}
                                        />
                                        {result.duration && (
                                            <Chip
                                                label={formatDuration(result.duration)}
                                                size="small"
                                                sx={{ position: 'absolute', bottom: 8, right: 8, bgcolor: overlay.black80, color: neutral.white }}
                                            />
                                        )}
                                        <Box sx={{ position: 'absolute', top: 8, right: 8, bgcolor: overlay.black70, borderRadius: '50%', p: 0.5, display: 'flex' }}>
                                            {result.source === 'bilibili'
                                                ? <OndemandVideo sx={{ color: platform.bilibili }} />
                                                : <YouTube sx={{ color: platform.youtube }} />}
                                        </Box>
                                    </Box>
                                    <CardContent sx={{ flexGrow: 1, p: 2 }}>
                                        <Typography gutterBottom variant="subtitle1" component="div" sx={{ fontWeight: 600, lineHeight: 1.2, mb: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                            {result.title}
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                            {result.author}
                                        </Typography>
                                        {result.viewCount && (
                                            <Typography variant="caption" color="text.secondary">
                                                {formatViewCount(result.viewCount)} {t('views')}
                                            </Typography>
                                        )}
                                    </CardContent>
                                    <CardActions sx={{ p: 2, pt: 0 }}>
                                        <Button
                                            fullWidth
                                            variant="contained"
                                            startIcon={<Download />}
                                            onClick={() => onDownload(result)}
                                            loading={downloadingId === result.id}
                                            loadingPosition="start"
                                        >
                                            {t('download')}
                                        </Button>
                                    </CardActions>
                                </Card>
                            </Grid>
                        ))}
                    </Grid>
                    <Box sx={{ mt: 4, display: 'flex', justifyContent: 'center' }}>
                        <Button
                            variant="outlined"
                            onClick={onLoadMore}
                            loading={loadingMore}
                            loadingPosition="start"
                        >
                            {t('more')}
                        </Button>
                    </Box>
                </>
            ) : (
                <Typography color="text.secondary">{emptyLabel}</Typography>
            )}
        </Box>
    );
};

export default ExternalSearchSection;
