import {
    CheckCircle as CheckCircleIcon,
    Delete as DeleteIcon,
    Error as ErrorIcon,
    PlayArrow as PlayArrowIcon,
    Replay as ReplayIcon,
    SkipNext as SkipNextIcon,
    Warning as WarningIcon
} from '@mui/icons-material';
import {
    Box,
    Button,
    Chip,
    IconButton,
    Link,
    ListItem,
    ListItemText,
    Paper,
    Typography
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useLanguage } from '../../contexts/LanguageContext';

export interface DownloadHistoryItem {
    id: string;
    title: string;
    author?: string;
    sourceUrl?: string;
    finishedAt: number;
    status: 'success' | 'failed' | 'skipped' | 'deleted';
    error?: string;
    videoPath?: string;
    thumbnailPath?: string;
    totalSize?: string;
    videoId?: string;
    downloadedAt?: number;
    deletedAt?: number;
    subscriptionId?: string;
    taskId?: string;
}

interface HistoryItemProps {
    item: DownloadHistoryItem;
    onRemove: (id: string) => void;
    onRetry: (sourceUrl: string) => void;
    onReDownload: (sourceUrl: string) => void;
    onViewVideo: (videoId: string) => void;
    isDownloadInProgress: (sourceUrl: string) => boolean;
    dontSkipDeletedVideo?: boolean;
}

const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
};

export function HistoryItem({
    item,
    onRemove,
    onRetry,
    onReDownload,
    onViewVideo,
    isDownloadInProgress,
    dontSkipDeletedVideo
}: HistoryItemProps) {
    const { t } = useLanguage();

    return (
        <Paper sx={{ mb: 2, p: 2 }}>
            <ListItem
                disableGutters
                secondaryAction={
                    <IconButton edge="end" aria-label="remove" onClick={() => onRemove(item.id)}>
                        <DeleteIcon />
                    </IconButton>
                }
                sx={{
                    flexDirection: { xs: 'column', md: 'row' },
                    alignItems: { xs: 'flex-start', md: 'center' },
                    gap: { xs: 2, md: 0 },
                    pr: { xs: 6, md: 10 },
                    position: 'relative'
                }}
            >
                <ListItemText
                    primary={item.title}
                    slotProps={{ secondary: { component: 'div' } }}
                    sx={{
                        width: { xs: '100%', md: 'auto' },
                        flex: { md: 1 },
                        pr: { xs: 0, md: 2 }
                    }}
                    secondary={
                        <Box component="div" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                            {item.sourceUrl && (
                                <Typography
                                    variant="caption"
                                    color="primary"
                                    component="a"
                                    href={item.sourceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    sx={{
                                        textDecoration: 'none',
                                        '&:hover': { textDecoration: 'underline' },
                                        wordBreak: 'break-all'
                                    }}
                                >
                                    {item.sourceUrl}
                                </Typography>
                            )}
                            {item.status === 'deleted' ? (
                                <>
                                    {item.downloadedAt && (
                                        <Typography variant="caption" component="span">
                                            {t('downloadedOn') || 'Downloaded on'}: {formatDate(item.downloadedAt)}
                                        </Typography>
                                    )}
                                    {item.deletedAt && (
                                        <Typography variant="caption" component="span">
                                            {t('deletedOn') || 'Deleted on'}: {formatDate(item.deletedAt)}
                                        </Typography>
                                    )}
                                </>
                            ) : (
                                <Typography variant="caption" component="span">
                                    {formatDate(item.finishedAt)}
                                </Typography>
                            )}
                            {(item.subscriptionId || item.taskId) && (
                                <Typography variant="caption" color="text.secondary" component="span" sx={{ fontStyle: 'italic' }}>
                                    {item.subscriptionId && ` • ${t('viaSubscription') || 'via Subscription'}`}
                                    {item.taskId && ` • ${t('viaContinuousDownload') || 'via Continuous Download'}`}
                                </Typography>
                            )}
                            {item.error && (
                                <Typography variant="caption" color="error" component="span">
                                    {item.error}
                                </Typography>
                            )}
                        </Box>
                    }
                />
                <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    flexWrap: 'wrap',
                    width: { xs: '100%', md: 'auto' },
                    justifyContent: { xs: 'flex-start', md: 'flex-end' }
                }}>
                    {item.status === 'deleted' && !dontSkipDeletedVideo && (
                        <Typography variant="caption" sx={{ mr: 1 }}>
                            <Link component={RouterLink} to="/settings?tab=4#dontSkipDeletedVideo-setting" color="inherit">
                                {t('changeSettings') || 'Change Settings'}
                            </Link>
                        </Typography>
                    )}
                    {item.status === 'failed' && item.sourceUrl && (
                        <Button
                            variant="outlined"
                            color="primary"
                            size="small"
                            startIcon={<ReplayIcon />}
                            onClick={() => onRetry(item.sourceUrl!)}
                            disabled={isDownloadInProgress(item.sourceUrl)}
                            sx={{ minWidth: '100px' }}
                        >
                            {t('retry') || 'Retry'}
                        </Button>
                    )}
                    {item.status === 'skipped' && item.videoId && (
                        <Button
                            variant="outlined"
                            color="primary"
                            size="small"
                            startIcon={<PlayArrowIcon />}
                            onClick={() => onViewVideo(item.videoId!)}
                            sx={{ minWidth: '100px' }}
                        >
                            {t('viewVideo') || 'View Video'}
                        </Button>
                    )}
                    {item.status === 'success' && item.videoId && (
                        <Button
                            variant="outlined"
                            color="primary"
                            size="small"
                            startIcon={<PlayArrowIcon />}
                            onClick={() => onViewVideo(item.videoId!)}
                            sx={{ minWidth: '100px' }}
                        >
                            {t('viewVideo') || 'View Video'}
                        </Button>
                    )}
                    {item.status === 'deleted' && item.sourceUrl && (
                        <Button
                            variant="outlined"
                            color="primary"
                            size="small"
                            startIcon={<ReplayIcon />}
                            onClick={() => onReDownload(item.sourceUrl!)}
                            disabled={isDownloadInProgress(item.sourceUrl)}
                        >
                            {t('downloadAgain') || 'Download Again'}
                        </Button>
                    )}
                    {item.status === 'success' ? (
                        <Chip icon={<CheckCircleIcon />} label={t('success') || 'Success'} color="success" size="small" />
                    ) : item.status === 'skipped' ? (
                        <Chip icon={<SkipNextIcon />} label={t('skipped') || 'Skipped'} color="info" size="small" />
                    ) : item.status === 'deleted' ? (
                        <Chip icon={<WarningIcon />} label={t('previouslyDeleted') || 'Previously Deleted'} color="warning" size="small" />
                    ) : (
                        <Chip icon={<ErrorIcon />} label={t('failed') || 'Failed'} color="error" size="small" />
                    )}
                </Box>
            </ListItem>
        </Paper>
    );
}

