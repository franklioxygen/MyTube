import {
    Cancel as CancelIcon,
    CheckCircle as CheckCircleIcon,
    ClearAll as ClearAllIcon,
    CloudUpload,
    Delete as DeleteIcon,
    Error as ErrorIcon,
    PlaylistAdd as PlaylistAddIcon,
    Replay as ReplayIcon
} from '@mui/icons-material';
import {
    Box,
    Button,
    Chip,
    IconButton,
    LinearProgress,
    List,
    ListItem,
    ListItemText,
    Pagination,
    Paper,
    Tab,
    Tabs,
    Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import React, { useState } from 'react';
import BatchDownloadModal from '../components/BatchDownloadModal';
import UploadModal from '../components/UploadModal';
import { useDownload } from '../contexts/DownloadContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';

const API_URL = import.meta.env.VITE_API_URL;
const ITEMS_PER_PAGE = 20;

interface DownloadHistoryItem {
    id: string;
    title: string;
    author?: string;
    sourceUrl?: string;
    finishedAt: number;
    status: 'success' | 'failed';
    error?: string;
    videoPath?: string;
    thumbnailPath?: string;
    totalSize?: string;
}

interface TabPanelProps {
    children?: React.ReactNode;
    index: number;
    value: number;
}

function CustomTabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props;

    return (
        <div
            role="tabpanel"
            hidden={value !== index}
            id={`simple-tabpanel-${index}`}
            aria-labelledby={`simple-tab-${index}`}
            {...other}
        >
            {value === index && (
                <Box sx={{ p: 3 }}>
                    {children}
                </Box>
            )}
        </div>
    );
}

const DownloadPage: React.FC = () => {
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const { activeDownloads, queuedDownloads, handleVideoSubmit } = useDownload();
    const queryClient = useQueryClient();
    const [tabValue, setTabValue] = useState(0);
    const [showBatchModal, setShowBatchModal] = useState(false);
    const [uploadModalOpen, setUploadModalOpen] = useState(false);

    const [queuePage, setQueuePage] = useState(1);
    const [historyPage, setHistoryPage] = useState(1);

    // Scan files mutation


    const handleUploadSuccess = () => {
        window.location.reload();
    };

    const handleBatchSubmit = async (urls: string[]) => {
        // We'll process them sequentially to be safe, or just fire them all.
        // Let's fire them all but with a small delay or just let the context handle it.
        // Since handleVideoSubmit is async, we can await them.
        let addedCount = 0;
        for (const url of urls) {
            if (url.trim()) {
                await handleVideoSubmit(url.trim());
                addedCount++;
            }
        }
        if (addedCount > 0) {
            showSnackbar(t('batchTasksAdded', { count: addedCount }) || `${addedCount} tasks added`);
        }
    };

    // Fetch history with polling
    const { data: history = [] } = useQuery({
        queryKey: ['downloadHistory'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/downloads/history`);
            return response.data;
        },
        refetchInterval: 2000
    });

    const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
        setTabValue(newValue);
    };

    // Cancel download mutation
    const cancelMutation = useMutation({
        mutationFn: async (id: string) => {
            await axios.post(`${API_URL}/downloads/cancel/${id}`);
        },
        onMutate: async (id: string) => {
            // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
            await queryClient.cancelQueries({ queryKey: ['downloadStatus'] });

            // Snapshot the previous value
            const previousStatus = queryClient.getQueryData(['downloadStatus']);

            // Optimistically update to the new value
            queryClient.setQueryData(['downloadStatus'], (old: any) => {
                if (!old) return old;
                return {
                    ...old,
                    activeDownloads: old.activeDownloads.filter((d: any) => d.id !== id),
                    queuedDownloads: old.queuedDownloads.filter((d: any) => d.id !== id),
                };
            });

            // Return a context object with the snapshotted value
            return { previousStatus };
        },
        onError: (_err, _id, context) => {
            // If the mutation fails, use the context returned from onMutate to roll back
            if (context?.previousStatus) {
                queryClient.setQueryData(['downloadStatus'], context.previousStatus);
            }
            showSnackbar(t('error') || 'Error');
        },
        onSettled: () => {
            // Always refetch after error or success:
            queryClient.invalidateQueries({ queryKey: ['downloadStatus'] });
        },
        onSuccess: () => {
            showSnackbar(t('downloadCancelled') || 'Download cancelled');
        },
    });

    const handleCancelDownload = (id: string) => {
        cancelMutation.mutate(id);
    };

    // Remove from queue mutation
    const removeFromQueueMutation = useMutation({
        mutationFn: async (id: string) => {
            await axios.delete(`${API_URL}/downloads/queue/${id}`);
        },
        onSuccess: () => {
            showSnackbar(t('removedFromQueue') || 'Removed from queue');
            queryClient.invalidateQueries({ queryKey: ['downloadStatus'] });
        },
        onError: () => {
            showSnackbar(t('error') || 'Error');
        }
    });

    const handleRemoveFromQueue = (id: string) => {
        removeFromQueueMutation.mutate(id);
    };

    // Clear queue mutation
    const clearQueueMutation = useMutation({
        mutationFn: async () => {
            await axios.delete(`${API_URL}/downloads/queue`);
        },
        onSuccess: () => {
            showSnackbar(t('queueCleared') || 'Queue cleared');
            queryClient.invalidateQueries({ queryKey: ['downloadStatus'] });
        },
        onError: () => {
            showSnackbar(t('error') || 'Error');
        }
    });

    const handleClearQueue = () => {
        clearQueueMutation.mutate();
    };

    // Remove from history mutation
    const removeFromHistoryMutation = useMutation({
        mutationFn: async (id: string) => {
            await axios.delete(`${API_URL}/downloads/history/${id}`);
        },
        onSuccess: () => {
            showSnackbar(t('removedFromHistory') || 'Removed from history');
            queryClient.invalidateQueries({ queryKey: ['downloadHistory'] });
        },
        onError: () => {
            showSnackbar(t('error') || 'Error');
        }
    });

    const handleRemoveFromHistory = (id: string) => {
        removeFromHistoryMutation.mutate(id);
    };

    // Clear history mutation
    const clearHistoryMutation = useMutation({
        mutationFn: async () => {
            await axios.delete(`${API_URL}/downloads/history`);
        },
        onSuccess: () => {
            showSnackbar(t('historyCleared') || 'History cleared');
            queryClient.invalidateQueries({ queryKey: ['downloadHistory'] });
        },
        onError: () => {
            showSnackbar(t('error') || 'Error');
        }
    });

    const handleClearHistory = () => {
        clearHistoryMutation.mutate();
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleString();
    };

    return (
        <Box sx={{ width: '100%', p: 2 }}>
            <Box sx={{
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                justifyContent: 'space-between',
                alignItems: { xs: 'flex-start', sm: 'center' },
                mb: 2,
                gap: { xs: 2, sm: 0 }
            }}>
                <Typography variant="h4" gutterBottom sx={{ mb: 0 }}>
                    {t('downloads') || 'Downloads'}
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', width: { xs: '100%', sm: 'auto' } }}>

                    <Button
                        variant="contained"
                        size="small"
                        startIcon={<PlaylistAddIcon />}
                        onClick={() => setShowBatchModal(true)}
                    >
                        {t('addBatchTasks') || 'Add batch tasks'}
                    </Button>
                    <Button
                        variant="contained"
                        size="small"
                        startIcon={<CloudUpload />}
                        onClick={() => setUploadModalOpen(true)}
                    >
                        {t('uploadVideo') || 'Upload Video'}
                    </Button>
                </Box>
            </Box>

            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                <Tabs
                    value={tabValue}
                    onChange={handleTabChange}
                    aria-label="download tabs"
                    variant="scrollable"
                    scrollButtons="auto"
                    allowScrollButtonsMobile
                >
                    <Tab label={t('activeDownloads') || 'Active Downloads'} />
                    <Tab label={t('queuedDownloads') || 'Queue'} />
                    <Tab label={t('downloadHistory') || 'History'} />
                </Tabs>
            </Box>

            {/* Active Downloads */}
            <CustomTabPanel value={tabValue} index={0}>
                {activeDownloads.length === 0 ? (
                    <Typography color="textSecondary">{t('noActiveDownloads') || 'No active downloads'}</Typography>
                ) : (
                    <List>
                        {activeDownloads.map((download) => (
                            <Paper key={download.id} sx={{ mb: 2, p: 2 }}>
                                <ListItem
                                    disableGutters
                                    secondaryAction={
                                        <IconButton edge="end" aria-label="cancel" onClick={() => handleCancelDownload(download.id)}>
                                            <CancelIcon />
                                        </IconButton>
                                    }
                                >
                                    <ListItemText
                                        primary={download.title}
                                        secondaryTypographyProps={{ component: 'div' }}
                                        secondary={
                                            <Box sx={{ mt: 1 }}>
                                                <LinearProgress variant="determinate" value={download.progress || 0} sx={{ mb: 1 }} />
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                                    <Typography variant="body2" fontWeight="bold" color="primary">
                                                        {download.progress?.toFixed(1)}%
                                                    </Typography>
                                                    <Typography variant="caption" color="textSecondary">
                                                        •
                                                    </Typography>
                                                    <Typography variant="caption" color="textSecondary">
                                                        {download.speed || '0 B/s'}
                                                    </Typography>
                                                    <Typography variant="caption" color="textSecondary">
                                                        •
                                                    </Typography>
                                                    <Typography variant="caption" color="textSecondary">
                                                        {download.downloadedSize || '0'} / {download.totalSize || '?'}
                                                    </Typography>
                                                </Box>
                                            </Box>
                                        }
                                    />
                                </ListItem>
                            </Paper>
                        ))}
                    </List>
                )}
            </CustomTabPanel>

            {/* Queue */}
            <CustomTabPanel value={tabValue} index={1}>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                    <Button
                        variant="outlined"
                        startIcon={<ClearAllIcon />}
                        onClick={handleClearQueue}
                        disabled={queuedDownloads.length === 0}
                    >
                        {t('clearQueue') || 'Clear Queue'}
                    </Button>
                </Box>
                {queuedDownloads.length === 0 ? (
                    <Typography color="textSecondary">{t('noQueuedDownloads') || 'No queued downloads'}</Typography>
                ) : (
                    <>
                        <List>
                            {queuedDownloads
                                .slice((queuePage - 1) * ITEMS_PER_PAGE, queuePage * ITEMS_PER_PAGE)
                                .map((download) => (
                                    <Paper key={download.id} sx={{ mb: 2, p: 2 }}>
                                        <ListItem
                                            disableGutters
                                            secondaryAction={
                                                <IconButton edge="end" aria-label="remove" onClick={() => handleRemoveFromQueue(download.id)}>
                                                    <DeleteIcon />
                                                </IconButton>
                                            }
                                        >
                                            <ListItemText
                                                primary={download.title}
                                                secondary={t('queued') || 'Queued'}
                                            />
                                        </ListItem>
                                    </Paper>
                                ))}
                        </List>
                        {queuedDownloads.length > ITEMS_PER_PAGE && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                                <Pagination
                                    count={Math.ceil(queuedDownloads.length / ITEMS_PER_PAGE)}
                                    page={queuePage}
                                    onChange={(_: React.ChangeEvent<unknown>, page: number) => setQueuePage(page)}
                                    color="primary"
                                />
                            </Box>
                        )}
                    </>
                )}
            </CustomTabPanel>

            {/* History */}
            <CustomTabPanel value={tabValue} index={2}>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                    <Button
                        variant="outlined"
                        startIcon={<ClearAllIcon />}
                        onClick={handleClearHistory}
                        disabled={history.length === 0}
                    >
                        {t('clearHistory') || 'Clear History'}
                    </Button>
                </Box>
                {history.length === 0 ? (
                    <Typography color="textSecondary">{t('noDownloadHistory') || 'No download history'}</Typography>
                ) : (
                    <>
                        <List>
                            {history
                                .slice((historyPage - 1) * ITEMS_PER_PAGE, historyPage * ITEMS_PER_PAGE)
                                .map((item: DownloadHistoryItem) => (
                                    <Paper key={item.id} sx={{ mb: 2, p: 2 }}>
                                        <ListItem
                                            disableGutters
                                            secondaryAction={
                                                <IconButton edge="end" aria-label="remove" onClick={() => handleRemoveFromHistory(item.id)}>
                                                    <DeleteIcon />
                                                </IconButton>
                                            }
                                        >
                                            <ListItemText
                                                primary={item.title}
                                                secondaryTypographyProps={{ component: 'div' }}
                                                secondary={
                                                    <Box component="div" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                                        {item.sourceUrl && (
                                                            <Typography variant="caption" color="primary" component="a" href={item.sourceUrl} target="_blank" rel="noopener noreferrer" sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                                                                {item.sourceUrl}
                                                            </Typography>
                                                        )}
                                                        <Typography variant="caption" component="span">
                                                            {formatDate(item.finishedAt)}
                                                        </Typography>
                                                        {item.error && (
                                                            <Typography variant="caption" color="error" component="span">
                                                                {item.error}
                                                            </Typography>
                                                        )}
                                                    </Box>
                                                }
                                            />
                                            <Box sx={{ mr: 8, display: 'flex', alignItems: 'center', gap: 1 }}>
                                                {item.status === 'failed' && item.sourceUrl && (
                                                    <Button
                                                        variant="outlined"
                                                        color="primary"
                                                        size="small"
                                                        startIcon={<ReplayIcon />}
                                                        onClick={() => handleVideoSubmit(item.sourceUrl!)}
                                                        sx={{ minWidth: '100px' }}
                                                    >
                                                        {t('retry') || 'Retry'}
                                                    </Button>
                                                )}
                                                {item.status === 'success' ? (
                                                    <Chip icon={<CheckCircleIcon />} label={t('success') || 'Success'} color="success" size="small" />
                                                ) : (
                                                    <Chip icon={<ErrorIcon />} label={t('failed') || 'Failed'} color="error" size="small" />
                                                )}
                                            </Box>
                                        </ListItem>
                                    </Paper>
                                ))}
                        </List>
                        {history.length > ITEMS_PER_PAGE && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                                <Pagination
                                    count={Math.ceil(history.length / ITEMS_PER_PAGE)}
                                    page={historyPage}
                                    onChange={(_: React.ChangeEvent<unknown>, page: number) => setHistoryPage(page)}
                                    color="primary"
                                />
                            </Box>
                        )}
                    </>
                )}
            </CustomTabPanel>

            <BatchDownloadModal
                open={showBatchModal}
                onClose={() => setShowBatchModal(false)}
                onConfirm={handleBatchSubmit}
            />
            <UploadModal
                open={uploadModalOpen}
                onClose={() => setUploadModalOpen(false)}
                onUploadSuccess={handleUploadSuccess}
            />

        </Box>
    );
};

export default DownloadPage;
