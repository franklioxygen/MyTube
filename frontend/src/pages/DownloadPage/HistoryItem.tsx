import {
    Cancel as CancelIcon,
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
import { getBilibiliRetryGapSummary } from '../../utils/bilibiliRetryMetadata';
import { formatDisplayDateTime } from '../../utils/formatUtils';

export interface DownloadHistoryItem {
    id: string;
    title: string;
    author?: string;
    sourceUrl?: string;
    finishedAt: number;
    status: 'success' | 'failed' | 'partial' | 'skipped' | 'deleted' | 'pending_retry';
    error?: string;
    videoPath?: string;
    thumbnailPath?: string;
    totalSize?: string;
    videoId?: string;
    downloadedAt?: number;
    deletedAt?: number;
    subscriptionId?: string;
    taskId?: string;
    downloadType?: string;
    retryCount?: number;
    retryLimit?: number;
    retryIntervalMinutes?: number;
    nextRetryAt?: number;
    retryMetadata?: string;
}

interface HistoryItemProps {
    item: DownloadHistoryItem;
    onRemove: (id: string) => void;
    onCancelRetry: (id: string) => void;
    onRetry: (sourceUrl: string) => void;
    onReDownload: (sourceUrl: string) => void;
    onViewVideo: (videoId: string) => void;
    isDownloadInProgress: (sourceUrl: string) => boolean;
    dontSkipDeletedVideo?: boolean;
}

export function HistoryItem({
    item,
    onRemove,
    onCancelRetry,
    onRetry,
    onReDownload,
    onViewVideo,
    isDownloadInProgress,
    dontSkipDeletedVideo
}: HistoryItemProps) {
    const { t } = useLanguage();
    const isPendingRetry = item.status === 'pending_retry';
    const isPartial = item.status === 'partial';
    const retryGapSummary =
        item.downloadType === 'bilibili'
            ? getBilibiliRetryGapSummary(item.retryMetadata)
            : undefined;
    const actionButtonMinWidth = { xs: 0, md: '100px' };
    const statusChipSx = {
        height: 22,
        '& .MuiChip-label': {
            px: 0.75,
            fontSize: '0.72rem',
            lineHeight: 1.1,
        },
        '& .MuiChip-icon': {
            ml: 0.5,
            fontSize: '0.9rem',
        },
    } as const;
    const statusChip = item.status === 'success' ? (
        <Chip
            icon={<CheckCircleIcon sx={{ fontSize: '0.9rem' }} />}
            label={t('success') || 'Success'}
            color="success"
            size="small"
            sx={statusChipSx}
        />
    ) : item.status === 'skipped' ? (
        <Chip
            icon={<SkipNextIcon sx={{ fontSize: '0.9rem' }} />}
            label={t('skipped') || 'Skipped'}
            color="info"
            size="small"
            sx={statusChipSx}
        />
    ) : item.status === 'deleted' ? (
        <Chip
            icon={<WarningIcon sx={{ fontSize: '0.9rem' }} />}
            label={t('previouslyDeleted') || 'Previously Deleted'}
            color="warning"
            size="small"
            sx={statusChipSx}
        />
    ) : item.status === 'pending_retry' ? (
        <Chip
            icon={<ReplayIcon sx={{ fontSize: '0.9rem' }} />}
            label={t('pendingRetry') || 'Pending Retry'}
            color="warning"
            size="small"
            sx={statusChipSx}
        />
    ) : item.status === 'partial' ? (
        <Chip
            icon={<WarningIcon sx={{ fontSize: '0.9rem' }} />}
            label={t('partialDownload') || 'Incomplete'}
            color="warning"
            size="small"
            sx={statusChipSx}
        />
    ) : (
        <Chip
            icon={<ErrorIcon sx={{ fontSize: '0.9rem' }} />}
            label={t('failed') || 'Failed'}
            color="error"
            size="small"
            sx={statusChipSx}
        />
    );

    return (
        <Paper sx={{ mb: 2, px: 2, py: 1.5 }}>
            <ListItem
                disableGutters
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) auto' },
                    alignItems: { xs: 'stretch', md: 'flex-start' },
                    columnGap: { xs: 0, md: 2 },
                    rowGap: 2,
                    width: '100%'
                }}
            >
                <ListItemText
                    primary={item.title}
                    slotProps={{ secondary: { component: 'div' } }}
                    sx={{
                        width: '100%',
                        minWidth: 0
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
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                        {statusChip}
                                        {item.deletedAt ? (
                                            <Typography variant="caption" component="span">
                                                {t('deletedOn') || 'Deleted on'}: {formatDisplayDateTime(item.deletedAt)}
                                            </Typography>
                                        ) : item.downloadedAt ? (
                                            <Typography variant="caption" component="span">
                                                {t('downloadedOn') || 'Downloaded on'}: {formatDisplayDateTime(item.downloadedAt)}
                                            </Typography>
                                        ) : null}
                                        {item.subscriptionId && (
                                            <Typography variant="caption" color="text.secondary" component="span" sx={{ fontStyle: 'italic' }}>
                                                {` • ${t('viaSubscription') || 'via Subscription'}`}
                                            </Typography>
                                        )}
                                        {item.taskId && (
                                            <Typography variant="caption" color="text.secondary" component="span" sx={{ fontStyle: 'italic' }}>
                                                {` • ${t('viaContinuousDownload') || 'via Continuous Download'}`}
                                            </Typography>
                                        )}
                                    </Box>
                                    {item.downloadedAt && item.deletedAt && (
                                        <Typography variant="caption" component="span">
                                            {t('downloadedOn') || 'Downloaded on'}: {formatDisplayDateTime(item.downloadedAt)}
                                        </Typography>
                                    )}
                                    {!dontSkipDeletedVideo && (
                                        <Typography variant="caption" component="span">
                                            <Link component={RouterLink} to="/settings?tab=4#dontSkipDeletedVideo-setting" color="inherit">
                                                {t('changeSettings') || 'Change Settings'}
                                            </Link>
                                        </Typography>
                                    )}
                                </>
                            ) : (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                    {statusChip}
                                    <Typography variant="caption" component="span">
                                        {formatDisplayDateTime(item.finishedAt)}
                                    </Typography>
                                    {item.subscriptionId && (
                                        <Typography variant="caption" color="text.secondary" component="span" sx={{ fontStyle: 'italic' }}>
                                            {` • ${t('viaSubscription') || 'via Subscription'}`}
                                        </Typography>
                                    )}
                                    {item.taskId && (
                                        <Typography variant="caption" color="text.secondary" component="span" sx={{ fontStyle: 'italic' }}>
                                            {` • ${t('viaContinuousDownload') || 'via Continuous Download'}`}
                                        </Typography>
                                    )}
                                </Box>
                            )}
                            {item.error && (
                                <Typography variant="caption" color="error" component="span">
                                    {item.error}
                                </Typography>
                            )}
                            {retryGapSummary && (
                                <Typography variant="caption" color="warning.main" component="span">
                                    {`${t(retryGapSummary.labelKey) || retryGapSummary.labelKey}: ${retryGapSummary.displayValue}`}
                                </Typography>
                            )}
                            {isPendingRetry && item.nextRetryAt && (
                                <Typography variant="caption" color="warning.main" component="span">
                                    {t('retryScheduledFor') || 'Retry scheduled for'}: {formatDisplayDateTime(item.nextRetryAt)}
                                </Typography>
                            )}
                            {isPendingRetry && item.retryCount && item.retryLimit && (
                                <Typography variant="caption" color="text.secondary" component="span">
                                    {t('retryAttemptProgress', {
                                        current: item.retryCount,
                                        total: item.retryLimit,
                                    }) || `Retry ${item.retryCount} of ${item.retryLimit}`}
                                </Typography>
                            )}
                        </Box>
                    }
                />
                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: { xs: 'row', md: 'column' },
                        gap: 1,
                        width: { xs: '100%', md: 'fit-content' },
                        justifySelf: { xs: 'stretch', md: 'end' },
                        alignItems: { xs: 'center', md: 'flex-end' },
                        justifyContent: 'flex-end',
                        flexWrap: 'nowrap'
                    }}>
                        {(item.status === 'failed' || isPartial) && item.sourceUrl && (
                            <Button
                                variant="outlined"
                                color="primary"
                                size="small"
                                startIcon={<ReplayIcon />}
                                onClick={() => onRetry(item.sourceUrl!)}
                                disabled={isDownloadInProgress(item.sourceUrl)}
                                sx={{ minWidth: actionButtonMinWidth, order: { xs: 1, md: 2 } }}
                            >
                                {t('retry') || 'Retry'}
                            </Button>
                        )}
                        {item.status === 'pending_retry' && (
                            <Button
                                variant="outlined"
                                color="warning"
                                size="small"
                                startIcon={<CancelIcon />}
                                onClick={() => onCancelRetry(item.id)}
                                sx={{ minWidth: actionButtonMinWidth, order: { xs: 1, md: 2 } }}
                            >
                                {t('cancelRetry') || 'Cancel Retry'}
                            </Button>
                        )}
                        {item.status === 'skipped' && item.videoId && (
                            <Button
                                variant="outlined"
                                color="primary"
                                size="small"
                                startIcon={<PlayArrowIcon />}
                                onClick={() => onViewVideo(item.videoId!)}
                                sx={{ minWidth: actionButtonMinWidth, order: { xs: 1, md: 2 } }}
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
                                sx={{ minWidth: actionButtonMinWidth, order: { xs: 1, md: 2 } }}
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
                                sx={{ minWidth: actionButtonMinWidth, order: { xs: 1, md: 2 } }}
                            >
                                {t('downloadAgain') || 'Download Again'}
                            </Button>
                        )}
                        <IconButton
                            aria-label="remove"
                            onClick={() => onRemove(item.id)}
                            disabled={isPendingRetry}
                            sx={{ order: { xs: 3, md: 1 }, alignSelf: { xs: 'center', md: 'flex-end' } }}
                        >
                            <DeleteIcon />
                        </IconButton>
                    </Box>
            </ListItem>
        </Paper>
    );
}
