import { Cancel, Check, Close, Delete, DeleteOutline, Edit, Pause, PlayArrow } from '@mui/icons-material';
import {
    Box,
    Button,
    CircularProgress,
    Container,
    IconButton,
    LinearProgress,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Typography,
    useMediaQuery
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import ConfirmationModal from '../components/ConfirmationModal';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { api } from '../utils/apiClient';
import { formatDisplayDateTimeMinutes } from '../utils/formatUtils';
import type { TranslationKey } from '../utils/translations';

interface Subscription {
    id: string;
    author: string;
    authorUrl: string;
    interval: number;
    lastVideoLink?: string;
    lastCheck?: number;
    downloadCount: number;
    createdAt: number;
    platform: string;
    paused?: number;
    // Playlist subscription fields
    playlistId?: string;
    playlistTitle?: string;
    subscriptionType?: string; // 'author' or 'playlist'
    collectionId?: string;
    // Retention
    retentionDays?: number | null;
}

interface ContinuousDownloadTask {
    id: string;
    subscriptionId?: string;
    authorUrl: string;
    author: string;
    platform: string;
    status: 'active' | 'paused' | 'completed' | 'cancelled';
    totalVideos: number;
    downloadedCount: number;
    skippedCount: number;
    failedCount: number;
    currentVideoIndex: number;
    createdAt: number;
    updatedAt?: number;
    completedAt?: number;
    error?: string;
    playlistName?: string;
}

const getNextCheckTimestamp = (subscription: Subscription) => {
    if (subscription.lastCheck === undefined || subscription.lastCheck === null) {
        return undefined;
    }

    return subscription.lastCheck + (subscription.interval * 60 * 1000);
};

const parsePositiveInteger = (value: string): number | null => {
    const trimmedValue = value.trim();
    if (!/^\d+$/.test(trimmedValue)) {
        return null;
    }

    const parsedValue = Number(trimmedValue);
    return Number.isSafeInteger(parsedValue) && parsedValue > 0
        ? parsedValue
        : null;
};

const SubscriptionsPage: React.FC = () => {
    const theme = useTheme();
    const isMobileLayout = useMediaQuery(theme.breakpoints.down('md'));
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const { userRole } = useAuth();
    const isVisitor = userRole === 'visitor';
    const [isUnsubscribeModalOpen, setIsUnsubscribeModalOpen] = useState(false);
    const [selectedSubscription, setSelectedSubscription] = useState<{ id: string; author: string } | null>(null);
    const [isCancelTaskModalOpen, setIsCancelTaskModalOpen] = useState(false);
    const [isDeleteTaskModalOpen, setIsDeleteTaskModalOpen] = useState(false);
    const [isClearFinishedModalOpen, setIsClearFinishedModalOpen] = useState(false);
    const [selectedTask, setSelectedTask] = useState<ContinuousDownloadTask | null>(null);
    const [editingSubscriptionId, setEditingSubscriptionId] = useState<string | null>(null);
    const [editedInterval, setEditedInterval] = useState<string>('');
    const [isSavingInterval, setIsSavingInterval] = useState(false);
    const [editingRetentionId, setEditingRetentionId] = useState<string | null>(null);
    const [editedRetention, setEditedRetention] = useState<string>('');
    const [isSavingRetention, setIsSavingRetention] = useState(false);

    // Use React Query for better caching and memory management
    const { data: subscriptions = [], refetch: refetchSubscriptions } = useQuery({
        queryKey: ['subscriptions'],
        queryFn: async () => {
            const response = await api.get('/subscriptions');
            return response.data as Subscription[];
        },
        refetchInterval: 30000, // Refetch every 30 seconds (less frequent)
        staleTime: 10000, // Consider data fresh for 10 seconds
        gcTime: 10 * 60 * 1000, // Garbage collect after 10 minutes
    });

    const { data: tasks = [], refetch: refetchTasks } = useQuery({
        queryKey: ['subscriptionTasks'],
        queryFn: async () => {
            const response = await api.get('/subscriptions/tasks');
            return response.data as ContinuousDownloadTask[];
        },
        // Only poll when there are active tasks
        refetchInterval: (query) => {
            const data = query.state.data as ContinuousDownloadTask[] | undefined;
            const hasActive = data?.some(task => task.status === 'active' || task.status === 'paused') ?? false;
            // Poll every 10 seconds if there are active tasks, otherwise every 60 seconds
            return hasActive ? 10000 : 60000;
        },
        staleTime: 5000, // Consider data fresh for 5 seconds
        gcTime: 10 * 60 * 1000, // Garbage collect after 10 minutes
    });

    const handleUnsubscribeClick = (id: string, author: string, subscriptionType?: string) => {
        // Format display name with translated suffix for playlists watchers
        const displayName = subscriptionType === 'channel_playlists' 
            ? `${author} (${t('playlistsWatcher')})`
            : author;
        setSelectedSubscription({ id, author: displayName });
        setIsUnsubscribeModalOpen(true);
    };

    const handleConfirmUnsubscribe = async () => {
        if (!selectedSubscription) return;

        try {
            await api.delete(`/subscriptions/${selectedSubscription.id}`);
            showSnackbar(t('unsubscribedSuccessfully'));
            refetchSubscriptions();
        } catch (error) {
            console.error('Error unsubscribing:', error);
            showSnackbar(t('error'));
        } finally {
            setIsUnsubscribeModalOpen(false);
            setSelectedSubscription(null);
        }
    };

    const handleCancelTaskClick = (task: ContinuousDownloadTask) => {
        setSelectedTask(task);
        setIsCancelTaskModalOpen(true);
    };

    const handleConfirmCancelTask = async () => {
        if (!selectedTask) return;

        try {
            await api.delete(`/subscriptions/tasks/${selectedTask.id}`);
            showSnackbar(t('taskCancelled'));
            refetchTasks();
        } catch (error) {
            console.error('Error cancelling task:', error);
            showSnackbar(t('error'));
        } finally {
            setIsCancelTaskModalOpen(false);
            setSelectedTask(null);
        }
    };

    const handleDeleteTaskClick = (task: ContinuousDownloadTask) => {
        setSelectedTask(task);
        setIsDeleteTaskModalOpen(true);
    };

    const handleConfirmDeleteTask = async () => {
        if (!selectedTask) return;

        try {
            await api.delete(`/subscriptions/tasks/${selectedTask.id}/delete`);
            showSnackbar(t('taskDeleted'));
            refetchTasks();
        } catch (error) {
            console.error('Error deleting task:', error);
            showSnackbar(t('error'));
        } finally {
            setIsDeleteTaskModalOpen(false);
            setSelectedTask(null);
        }
    };

    const handleClearFinishedClick = () => {
        setIsClearFinishedModalOpen(true);
    };

    const handleConfirmClearFinished = async () => {
        try {
            await api.delete('/subscriptions/tasks/clear-finished');
            showSnackbar(t('tasksCleared'));
            refetchTasks();
        } catch (error) {
            console.error('Error clearing finished tasks:', error);
            showSnackbar(t('error'));
        } finally {
            setIsClearFinishedModalOpen(false);
        }
    };

    const handlePauseSubscription = async (id: string) => {
        try {
            await api.put(`/subscriptions/${id}/pause`);
            showSnackbar(t('subscriptionPaused'));
            refetchSubscriptions();
        } catch (error) {
            console.error('Error pausing subscription:', error);
            showSnackbar(t('error'));
        }
    };

    const handleResumeSubscription = async (id: string) => {
        try {
            await api.put(`/subscriptions/${id}/resume`);
            showSnackbar(t('subscriptionResumed'));
            refetchSubscriptions();
        } catch (error) {
            console.error('Error resuming subscription:', error);
            showSnackbar(t('error'));
        }
    };

    const handleStartEditingInterval = (subscription: Subscription) => {
        setEditingSubscriptionId(subscription.id);
        setEditedInterval(String(subscription.interval));
    };

    const handleCancelEditingInterval = () => {
        setEditingSubscriptionId(null);
        setEditedInterval('');
        setIsSavingInterval(false);
    };

    const parsedEditedInterval = parsePositiveInteger(editedInterval);
    const isEditedIntervalValid = parsedEditedInterval !== null;

    const handleSaveSubscriptionInterval = async (id: string) => {
        if (parsedEditedInterval === null) return;

        setIsSavingInterval(true);

        try {
            await api.put(`/subscriptions/${id}`, { interval: parsedEditedInterval });
            showSnackbar(t('subscriptionUpdated'));
            await refetchSubscriptions();
            handleCancelEditingInterval();
        } catch (error) {
            console.error('Error updating subscription interval:', error);
            showSnackbar(t('subscriptionUpdateFailed'));
            setIsSavingInterval(false);
        }
    };

    const handleStartEditingRetention = (subscription: Subscription) => {
        setEditingRetentionId(subscription.id);
        setEditedRetention(subscription.retentionDays != null ? String(subscription.retentionDays) : '');
    };

    const handleCancelEditingRetention = () => {
        setEditingRetentionId(null);
        setEditedRetention('');
        setIsSavingRetention(false);
    };

    const handleSaveRetention = async (id: string, currentInterval: number) => {
        setIsSavingRetention(true);
        const retentionValue = editedRetention.trim() === '' ? null : parsePositiveInteger(editedRetention);
        if (editedRetention.trim() !== '' && retentionValue === null) {
            showSnackbar(t('retentionDaysUpdateFailed'));
            setIsSavingRetention(false);
            return;
        }
        try {
            await api.put(`/subscriptions/${id}`, { interval: currentInterval, retentionDays: retentionValue });
            showSnackbar(t('retentionDaysUpdated'));
            await refetchSubscriptions();
            handleCancelEditingRetention();
        } catch (error) {
            console.error('Error updating retention:', error);
            showSnackbar(t('retentionDaysUpdateFailed'));
            setIsSavingRetention(false);
        }
    };

    const renderRetentionEditor = (subscriptionId: string, currentInterval: number) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <TextField
                value={editedRetention}
                onChange={(e) => setEditedRetention(e.target.value)}
                size="small"
                type="number"
                placeholder={t('retentionDaysNone')}
                autoFocus
                slotProps={{ htmlInput: { min: 1, step: 1, 'aria-label': t('retentionDays') } }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSaveRetention(subscriptionId, currentInterval);
                    if (e.key === 'Escape') handleCancelEditingRetention();
                }}
                sx={{ width: 88 }}
            />
            <Typography variant="body2" color="text.secondary">
                {t('retentionDaysLabel')}
            </Typography>
            <IconButton
                size="small"
                color="primary"
                title={t('save')}
                onClick={() => void handleSaveRetention(subscriptionId, currentInterval)}
                disabled={isSavingRetention}
            >
                {isSavingRetention ? <CircularProgress size={18} /> : <Check fontSize="small" />}
            </IconButton>
            <IconButton
                size="small"
                color="inherit"
                title={t('cancel')}
                onClick={handleCancelEditingRetention}
                disabled={isSavingRetention}
            >
                <Close fontSize="small" />
            </IconButton>
        </Box>
    );

    const handlePauseTask = async (task: ContinuousDownloadTask) => {
        try {
            await api.put(`/subscriptions/tasks/${task.id}/pause`);
            showSnackbar(t('taskPaused'));
            refetchTasks();
        } catch (error) {
            console.error('Error pausing task:', error);
            showSnackbar(t('error'));
        }
    };

    const handleResumeTask = async (task: ContinuousDownloadTask) => {
        try {
            await api.put(`/subscriptions/tasks/${task.id}/resume`);
            showSnackbar(t('taskResumed'));
            refetchTasks();
        } catch (error) {
            console.error('Error resuming task:', error);
            showSnackbar(t('error'));
        }
    };

    const getTaskProgress = (task: ContinuousDownloadTask) => {
        if (task.totalVideos === 0) return 0;
        return Math.round((task.currentVideoIndex / task.totalVideos) * 100);
    };

    const renderIntervalEditor = (subscriptionId: string, compact: boolean = false) => (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                minWidth: compact ? 0 : 180,
                flexWrap: compact ? 'wrap' : 'nowrap',
            }}
        >
            <TextField
                value={editedInterval}
                onChange={(e) => setEditedInterval(e.target.value)}
                size="small"
                type="number"
                autoFocus
                slotProps={{
                    htmlInput: {
                        min: 1,
                        step: 1,
                        'aria-label': t('checkIntervalMinutes'),
                    },
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        void handleSaveSubscriptionInterval(subscriptionId);
                    }
                    if (e.key === 'Escape') {
                        handleCancelEditingInterval();
                    }
                }}
                sx={{ width: compact ? 88 : 96 }}
            />
            <Typography variant="body2" color="text.secondary">
                {t('minutes')}
            </Typography>
            <IconButton
                size="small"
                color="primary"
                title={t('save')}
                onClick={() => void handleSaveSubscriptionInterval(subscriptionId)}
                disabled={!isEditedIntervalValid || isSavingInterval}
            >
                {isSavingInterval ? <CircularProgress size={18} /> : <Check fontSize="small" />}
            </IconButton>
            <IconButton
                size="small"
                color="inherit"
                title={t('cancel')}
                onClick={handleCancelEditingInterval}
                disabled={isSavingInterval}
            >
                <Close fontSize="small" />
            </IconButton>
        </Box>
    );

    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <Typography variant="h4" component="h1" gutterBottom fontWeight="bold">
                {t('subscriptions')}
            </Typography>

            <TableContainer component={Paper} sx={{ mt: 3 }}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>{t('author')}</TableCell>
                            <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{t('platform')}</TableCell>
                            <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{t('interval')}</TableCell>
                            <TableCell sx={{ display: { xs: 'none', md: 'table-cell' }, whiteSpace: 'nowrap' }}>
                                <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1.4 }}>
                                    <Box component="span">{t('lastCheck')} /</Box>
                                    <Box component="span">{t('nextCheck')}</Box>
                                </Box>
                            </TableCell>
                            <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{t('downloads')}</TableCell>
                            <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{t('retentionDays')}</TableCell>
                            {!isVisitor && <TableCell align="right">{t('actions')}</TableCell>}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {subscriptions.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={isVisitor ? 6 : 7} align="center">
                                    <Typography color="text.secondary" sx={{ py: 4 }}>
                                        {t('noVideos')} {/* Reusing "No videos found" or similar if "No subscriptions" key missing */}
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        ) : (
                            subscriptions.map((sub) => {
                                const isEditingInterval = editingSubscriptionId === sub.id;
                                const isEditingRetention = editingRetentionId === sub.id;

                                return (
                                <TableRow key={sub.id}>
                                    <TableCell>
                                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                            <Button
                                                href={sub.authorUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                sx={{ textTransform: 'none', justifyContent: 'flex-start', p: 0 }}
                                            >
                                                {sub.subscriptionType === 'channel_playlists'
                                                    ? `${sub.author} (${t('playlistsWatcher')})`
                                                    : sub.author}
                                            </Button>
                                            {isMobileLayout && (
                                                isEditingInterval ? (
                                                    renderIntervalEditor(sub.id, true)
                                                ) : (
                                                    <Typography variant="body2" color="text.secondary">
                                                        {t('interval')}: {sub.interval} {t('minutes')}
                                                    </Typography>
                                                )
                                            )}
                                            {isMobileLayout && !isVisitor && (
                                                isEditingRetention ? (
                                                    renderRetentionEditor(sub.id, sub.interval)
                                                ) : (
                                                    <Typography variant="body2" color="text.secondary">
                                                        {t('retentionDays')}: {sub.retentionDays != null ? `${sub.retentionDays}d` : t('retentionDaysNone')}
                                                    </Typography>
                                                )
                                            )}
                                        </Box>
                                    </TableCell>
                                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{sub.platform}</TableCell>
                                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                                        {isEditingInterval && !isMobileLayout ? (
                                            renderIntervalEditor(sub.id)
                                        ) : (
                                            <>{sub.interval} {t('minutes')}</>
                                        )}
                                    </TableCell>
                                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' }, whiteSpace: 'nowrap' }}>
                                        <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1.4 }}>
                                            <Box component="span">
                                                {formatDisplayDateTimeMinutes(sub.lastCheck, t('never'))}
                                            </Box>
                                            <Box component="span">
                                                {formatDisplayDateTimeMinutes(getNextCheckTimestamp(sub), t('never'))}
                                            </Box>
                                        </Box>
                                    </TableCell>
                                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{sub.downloadCount}</TableCell>
                                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                                        {isEditingRetention && !isMobileLayout ? (
                                            renderRetentionEditor(sub.id, sub.interval)
                                        ) : (
                                            sub.retentionDays != null
                                                ? `${sub.retentionDays}d`
                                                : <Typography variant="body2" color="text.secondary">{t('retentionDaysNone')}</Typography>
                                        )}
                                    </TableCell>
                                    {!isVisitor && (
                                        <TableCell align="right">
                                            <IconButton
                                                color="primary"
                                                onClick={() => handleStartEditingInterval(sub)}
                                                title={t('editInterval')}
                                                disabled={isEditingInterval || isSavingInterval || isEditingRetention}
                                            >
                                                <Edit />
                                            </IconButton>
                                            <IconButton
                                                color="primary"
                                                onClick={() => handleStartEditingRetention(sub)}
                                                title={t('editRetention')}
                                                disabled={isEditingRetention || isSavingRetention || isEditingInterval}
                                            >
                                                <DeleteOutline />
                                            </IconButton>
                                            <IconButton
                                                color="error"
                                                onClick={() => handleUnsubscribeClick(sub.id, sub.author, sub.subscriptionType)}
                                                title={t('unsubscribe')}
                                                disabled={(isEditingInterval && isSavingInterval) || (isEditingRetention && isSavingRetention)}
                                            >
                                                <Delete />
                                            </IconButton>
                                            {sub.paused ? (
                                                <IconButton
                                                    color="success"
                                                    onClick={() => handleResumeSubscription(sub.id)}
                                                    title={t('resumeSubscription')}
                                                    disabled={isEditingInterval && isSavingInterval}
                                                >
                                                    <PlayArrow />
                                                </IconButton>
                                            ) : (
                                                <IconButton
                                                    color="warning"
                                                    onClick={() => handlePauseSubscription(sub.id)}
                                                    title={t('pauseSubscription')}
                                                    disabled={isEditingInterval && isSavingInterval}
                                                >
                                                    <Pause />
                                                </IconButton>
                                            )}
                                        </TableCell>
                                    )}
                                </TableRow>
                            )})
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            {tasks.length > 0 && (
                <Box sx={{ mt: 4 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Typography variant="h5" component="h2" fontWeight="bold">
                            {t('continuousDownloadTasks')}
                        </Typography>
                        {!isVisitor && (
                            <Button
                                variant="outlined"
                                color="error"
                                onClick={handleClearFinishedClick}
                                startIcon={<DeleteOutline />}
                                size="small"
                            >
                                {t('clearFinishedTasks')}
                            </Button>
                        )}
                    </Box>
                    <TableContainer component={Paper} sx={{ mt: 2 }}>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>{t('authorOrPlaylist')}</TableCell>
                                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{t('platform')}</TableCell>
                                    <TableCell>{t('status')}</TableCell>
                                    <TableCell>{t('progress')}</TableCell>
                                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{t('downloaded')}</TableCell>
                                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{t('skipped')}</TableCell>
                                    <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{t('failed')}</TableCell>
                                    {!isVisitor && <TableCell align="right">{t('actions')}</TableCell>}
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {tasks.slice().reverse().map((task) => (
                                    <TableRow key={task.id}>
                                        <TableCell>{task.playlistName || task.author}</TableCell>
                                        <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{task.platform}</TableCell>
                                        <TableCell>
                                            <Typography
                                                variant="body2"
                                                color={
                                                    task.status === 'completed'
                                                        ? 'success.main'
                                                        : task.status === 'cancelled'
                                                            ? 'error.main'
                                                            : 'info.main'
                                                }
                                            >
                                                {t(`taskStatus${task.status.charAt(0).toUpperCase() + task.status.slice(1)}` as TranslationKey)}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>
                                            <Box sx={{ minWidth: 100 }}>
                                                <LinearProgress
                                                    variant="determinate"
                                                    value={getTaskProgress(task)}
                                                    sx={{ mb: 0.5 }}
                                                />
                                                <Typography variant="caption" color="text.secondary">
                                                    {task.currentVideoIndex} / {task.totalVideos || '?'}
                                                </Typography>
                                            </Box>
                                        </TableCell>
                                        <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{task.downloadedCount}</TableCell>
                                        <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{task.skippedCount}</TableCell>
                                        <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{task.failedCount}</TableCell>
                                        {!isVisitor && (
                                            <TableCell align="right">
                                                <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                                                    {task.status !== 'completed' && task.status !== 'cancelled' && (
                                                        <IconButton
                                                            color="error"
                                                            onClick={() => handleCancelTaskClick(task)}
                                                            title={t('cancelTask')}
                                                            size="small"
                                                        >
                                                            <Cancel />
                                                        </IconButton>
                                                    )}
                                                    {(task.status === 'active') && (
                                                        <IconButton
                                                            color="warning"
                                                            onClick={() => handlePauseTask(task)}
                                                            title={t('pauseTask')}
                                                            size="small"
                                                        >
                                                            <Pause />
                                                        </IconButton>
                                                    )}
                                                    {(task.status === 'paused') && (
                                                        <IconButton
                                                            color="success"
                                                            onClick={() => handleResumeTask(task)}
                                                            title={t('resumeTask')}
                                                            size="small"
                                                        >
                                                            <PlayArrow />
                                                        </IconButton>
                                                    )}
                                                    {(task.status === 'completed' || task.status === 'cancelled') && (
                                                        <IconButton
                                                            color="error"
                                                            onClick={() => handleDeleteTaskClick(task)}
                                                            title={t('deleteTask')}
                                                            size="small"
                                                        >
                                                            <DeleteOutline />
                                                        </IconButton>
                                                    )}
                                                </Box>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Box>
            )}

            <ConfirmationModal
                isOpen={isUnsubscribeModalOpen}
                onClose={() => setIsUnsubscribeModalOpen(false)}
                onConfirm={handleConfirmUnsubscribe}
                title={t('unsubscribe')}
                message={t('confirmUnsubscribe', { author: selectedSubscription?.author || '' })}
                confirmText={t('unsubscribe')}
                cancelText={t('cancel')}
                isDanger
            />
            <ConfirmationModal
                isOpen={isCancelTaskModalOpen}
                onClose={() => setIsCancelTaskModalOpen(false)}
                onConfirm={handleConfirmCancelTask}
                title={t('cancelTask')}
                message={t('confirmCancelTask', { author: selectedTask?.author || '' })}
                confirmText={t('cancelTask')}
                cancelText={t('cancel')}
                isDanger
            />
            <ConfirmationModal
                isOpen={isDeleteTaskModalOpen}
                onClose={() => setIsDeleteTaskModalOpen(false)}
                onConfirm={handleConfirmDeleteTask}
                title={t('deleteTask')}
                message={t('confirmDeleteTask', { author: selectedTask?.author || '' })}
                confirmText={t('deleteTask')}
                cancelText={t('cancel')}
                isDanger
            />
            <ConfirmationModal
                isOpen={isClearFinishedModalOpen}
                onClose={() => setIsClearFinishedModalOpen(false)}
                onConfirm={handleConfirmClearFinished}
                title={t('clearFinishedTasks')}
                message={t('confirmClearFinishedTasks')}
                confirmText={t('clear')}
                cancelText={t('cancel')}
                isDanger
            />
        </Container >
    );
};

export default SubscriptionsPage;
