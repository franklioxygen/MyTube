import {
    Cancel as CancelIcon,
    CheckCircle as CheckCircleIcon,
    ClearAll as ClearAllIcon,
    Delete as DeleteIcon,
    Error as ErrorIcon
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
    Paper,
    Tab,
    Tabs,
    Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import React, { useState } from 'react';
import { useDownload } from '../contexts/DownloadContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';

const API_URL = import.meta.env.VITE_API_URL;

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
    const { activeDownloads, queuedDownloads } = useDownload();
    const queryClient = useQueryClient();
    const [tabValue, setTabValue] = useState(0);

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
        onSuccess: () => {
            showSnackbar(t('downloadCancelled') || 'Download cancelled');
            // DownloadContext handles active/queued updates via its own polling
            // But we might want to invalidate to be sure
            queryClient.invalidateQueries({ queryKey: ['downloadStatus'] });
        },
        onError: () => {
            showSnackbar(t('error') || 'Error');
        }
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
            <Typography variant="h4" gutterBottom>
                {t('downloads') || 'Downloads'}
            </Typography>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                <Tabs value={tabValue} onChange={handleTabChange} aria-label="download tabs">
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
                    <List>
                        {queuedDownloads.map((download) => (
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
                    <List>
                        {history.map((item: DownloadHistoryItem) => (
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
                                    <Box sx={{ mr: 8 }}>
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
                )}
            </CustomTabPanel>
        </Box>
    );
};

export default DownloadPage;
