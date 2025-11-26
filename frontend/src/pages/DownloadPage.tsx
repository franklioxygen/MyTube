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
    ListItemSecondaryAction,
    ListItemText,
    Paper,
    Tab,
    Tabs,
    Typography
} from '@mui/material';
import axios from 'axios';
import React, { useEffect, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';

const API_URL = import.meta.env.VITE_API_URL;

interface DownloadInfo {
    id: string;
    title: string;
    timestamp: number;
    filename?: string;
    totalSize?: string;
    downloadedSize?: string;
    progress?: number;
    speed?: string;
}

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
    const [tabValue, setTabValue] = useState(0);
    const [activeDownloads, setActiveDownloads] = useState<DownloadInfo[]>([]);
    const [queuedDownloads, setQueuedDownloads] = useState<DownloadInfo[]>([]);
    const [history, setHistory] = useState<DownloadHistoryItem[]>([]);

    const fetchStatus = async () => {
        try {
            const response = await axios.get(`${API_URL}/download-status`);
            setActiveDownloads(response.data.activeDownloads);
            setQueuedDownloads(response.data.queuedDownloads);
        } catch (error) {
            console.error('Error fetching download status:', error);
        }
    };

    const fetchHistory = async () => {
        try {
            const response = await axios.get(`${API_URL}/downloads/history`);
            setHistory(response.data);
        } catch (error) {
            console.error('Error fetching history:', error);
        }
    };

    useEffect(() => {
        fetchStatus();
        fetchHistory();
        const interval = setInterval(() => {
            fetchStatus();
            fetchHistory();
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
        setTabValue(newValue);
    };

    const handleCancelDownload = async (id: string) => {
        try {
            await axios.post(`${API_URL}/downloads/cancel/${id}`);
            showSnackbar(t('downloadCancelled') || 'Download cancelled');
            fetchStatus();
        } catch (error) {
            console.error('Error cancelling download:', error);
            showSnackbar(t('error') || 'Error');
        }
    };

    const handleRemoveFromQueue = async (id: string) => {
        try {
            await axios.delete(`${API_URL}/downloads/queue/${id}`);
            showSnackbar(t('removedFromQueue') || 'Removed from queue');
            fetchStatus();
        } catch (error) {
            console.error('Error removing from queue:', error);
            showSnackbar(t('error') || 'Error');
        }
    };

    const handleClearQueue = async () => {
        try {
            await axios.delete(`${API_URL}/downloads/queue`);
            showSnackbar(t('queueCleared') || 'Queue cleared');
            fetchStatus();
        } catch (error) {
            console.error('Error clearing queue:', error);
            showSnackbar(t('error') || 'Error');
        }
    };

    const handleRemoveFromHistory = async (id: string) => {
        try {
            await axios.delete(`${API_URL}/downloads/history/${id}`);
            showSnackbar(t('removedFromHistory') || 'Removed from history');
            fetchHistory();
        } catch (error) {
            console.error('Error removing from history:', error);
            showSnackbar(t('error') || 'Error');
        }
    };

    const handleClearHistory = async () => {
        try {
            await axios.delete(`${API_URL}/downloads/history`);
            showSnackbar(t('historyCleared') || 'History cleared');
            fetchHistory();
        } catch (error) {
            console.error('Error clearing history:', error);
            showSnackbar(t('error') || 'Error');
        }
    };

    const formatBytes = (bytes?: string | number) => {
        if (!bytes) return '-';
        return bytes.toString(); // Simplified, ideally use a helper
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
                                <ListItem disableGutters>
                                    <ListItemText
                                        primary={download.title}
                                        secondaryTypographyProps={{ component: 'div' }}
                                        secondary={
                                            <Box sx={{ mt: 1 }}>
                                                <LinearProgress variant="determinate" value={download.progress || 0} sx={{ mb: 1 }} />
                                                <Typography variant="caption" color="textSecondary">
                                                    {download.progress?.toFixed(1)}% • {download.speed || '0 B/s'} • {download.downloadedSize || '0'} / {download.totalSize || '?'}
                                                </Typography>
                                            </Box>
                                        }
                                    />
                                    <ListItemSecondaryAction>
                                        <IconButton edge="end" aria-label="cancel" onClick={() => handleCancelDownload(download.id)}>
                                            <CancelIcon />
                                        </IconButton>
                                    </ListItemSecondaryAction>
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
                                <ListItem disableGutters>
                                    <ListItemText
                                        primary={download.title}
                                        secondary={t('queued') || 'Queued'}
                                    />
                                    <ListItemSecondaryAction>
                                        <IconButton edge="end" aria-label="remove" onClick={() => handleRemoveFromQueue(download.id)}>
                                            <DeleteIcon />
                                        </IconButton>
                                    </ListItemSecondaryAction>
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
                        {history.map((item) => (
                            <Paper key={item.id} sx={{ mb: 2, p: 2 }}>
                                <ListItem disableGutters>
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
                                    <Box sx={{ mr: 2 }}>
                                        {item.status === 'success' ? (
                                            <Chip icon={<CheckCircleIcon />} label={t('success') || 'Success'} color="success" size="small" />
                                        ) : (
                                            <Chip icon={<ErrorIcon />} label={t('failed') || 'Failed'} color="error" size="small" />
                                        )}
                                    </Box>
                                    <ListItemSecondaryAction>
                                        <IconButton edge="end" aria-label="remove" onClick={() => handleRemoveFromHistory(item.id)}>
                                            <DeleteIcon />
                                        </IconButton>
                                    </ListItemSecondaryAction>
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
