import { CloudUpload, PlaylistAdd as PlaylistAddIcon } from '@mui/icons-material';
import {
    Box,
    Button,
    Tab,
    Tabs,
    Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import React, { useState } from 'react';
import BatchDownloadModal from '../../components/BatchDownloadModal';
import UploadModal from '../../components/UploadModal';
import { useDownload } from '../../contexts/DownloadContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { ActiveDownloadsTab } from './ActiveDownloadsTab';
import { CustomTabPanel } from './CustomTabPanel';
import { HistoryTab } from './HistoryTab';
import { QueueTab } from './QueueTab';
import { DownloadHistoryItem } from './HistoryItem';

const API_URL = import.meta.env.VITE_API_URL;

const DownloadPage: React.FC = () => {
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const { activeDownloads, queuedDownloads, handleVideoSubmit } = useDownload();
    const queryClient = useQueryClient();
    const [tabValue, setTabValue] = useState(0);
    const [showBatchModal, setShowBatchModal] = useState(false);
    const [uploadModalOpen, setUploadModalOpen] = useState(false);
    const [downloadingItems, setDownloadingItems] = useState<Set<string>>(new Set());

    const handleUploadSuccess = () => {
        window.location.reload();
    };

    const handleBatchSubmit = async (urls: string[]) => {
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

    // Fetch history with polling - only when on downloads page
    const { data: history = [] } = useQuery({
        queryKey: ['downloadHistory'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/downloads/history`);
            return response.data;
        },
        // Only poll when tab is active (downloads tab)
        refetchInterval: tabValue === 0 ? 2000 : false,
        staleTime: 1000, // Consider data stale after 1 second
        gcTime: 5 * 60 * 1000, // Garbage collect after 5 minutes
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
            await queryClient.cancelQueries({ queryKey: ['downloadStatus'] });
            const previousStatus = queryClient.getQueryData(['downloadStatus']);
            queryClient.setQueryData(['downloadStatus'], (old: any) => {
                if (!old) return old;
                return {
                    ...old,
                    activeDownloads: old.activeDownloads.filter((d: any) => d.id !== id),
                    queuedDownloads: old.queuedDownloads.filter((d: any) => d.id !== id),
                };
            });
            return { previousStatus };
        },
        onError: (_err, _id, context) => {
            if (context?.previousStatus) {
                queryClient.setQueryData(['downloadStatus'], context.previousStatus);
            }
            showSnackbar(t('error') || 'Error');
        },
        onSettled: () => {
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

    // Helper function to check if a sourceUrl is already in active or queued downloads
    const isDownloadInProgress = (sourceUrl: string): boolean => {
        if (!sourceUrl) return false;
        
        const inActive = activeDownloads.some((d: any) => d.sourceUrl === sourceUrl);
        if (inActive) return true;
        
        const inQueue = queuedDownloads.some((d: any) => d.sourceUrl === sourceUrl);
        if (inQueue) return true;
        
        if (downloadingItems.has(sourceUrl)) return true;
        
        return false;
    };

    // Re-download deleted video
    const handleReDownload = async (sourceUrl: string) => {
        if (!sourceUrl) return;

        if (isDownloadInProgress(sourceUrl)) {
            showSnackbar('Download already in progress or queued');
            return;
        }

        setDownloadingItems(prev => new Set(prev).add(sourceUrl));

        try {
            const response = await axios.post(`${API_URL}/download`, {
                youtubeUrl: sourceUrl,
                forceDownload: true
            });

            if (response.data.downloadId) {
                showSnackbar(t('videoDownloading') || 'Video downloading');
                queryClient.invalidateQueries({ queryKey: ['downloadStatus'] });
            }
        } catch (error: any) {
            console.error('Error re-downloading video:', error);
            showSnackbar(t('error') || 'Error');
        } finally {
            setTimeout(() => {
                setDownloadingItems(prev => {
                    const next = new Set(prev);
                    next.delete(sourceUrl);
                    return next;
                });
            }, 1000);
        }
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

    const handleRetry = (sourceUrl: string) => {
        if (!isDownloadInProgress(sourceUrl)) {
            handleVideoSubmit(sourceUrl);
        } else {
            showSnackbar('Download already in progress or queued');
        }
    };

    const handleViewVideo = (videoId: string) => {
        window.location.href = `/video/${videoId}`;
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

            <CustomTabPanel value={tabValue} index={0}>
                <ActiveDownloadsTab
                    downloads={activeDownloads}
                    onCancel={handleCancelDownload}
                />
            </CustomTabPanel>

            <CustomTabPanel value={tabValue} index={1}>
                <QueueTab
                    downloads={queuedDownloads}
                    onRemove={handleRemoveFromQueue}
                    onClear={handleClearQueue}
                />
            </CustomTabPanel>

            <CustomTabPanel value={tabValue} index={2}>
                <HistoryTab
                    history={history as DownloadHistoryItem[]}
                    onRemove={handleRemoveFromHistory}
                    onClear={handleClearHistory}
                    onRetry={handleRetry}
                    onReDownload={handleReDownload}
                    onViewVideo={handleViewVideo}
                    isDownloadInProgress={isDownloadInProgress}
                />
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

