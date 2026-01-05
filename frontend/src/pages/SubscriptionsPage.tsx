import { Cancel, Delete, DeleteOutline, Pause, PlayArrow } from '@mui/icons-material';
import {
    Box,
    Button,
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
    Typography
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import React, { useState } from 'react';
import ConfirmationModal from '../components/ConfirmationModal';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { TranslationKey } from '../utils/translations';

const API_URL = import.meta.env.VITE_API_URL;

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

const SubscriptionsPage: React.FC = () => {
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

    // Use React Query for better caching and memory management
    const { data: subscriptions = [], refetch: refetchSubscriptions } = useQuery({
        queryKey: ['subscriptions'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/subscriptions`);
            return response.data as Subscription[];
        },
        refetchInterval: 30000, // Refetch every 30 seconds (less frequent)
        staleTime: 10000, // Consider data fresh for 10 seconds
        gcTime: 10 * 60 * 1000, // Garbage collect after 10 minutes
    });

    const { data: tasks = [], refetch: refetchTasks } = useQuery({
        queryKey: ['subscriptionTasks'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/subscriptions/tasks`);
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

    const handleUnsubscribeClick = (id: string, author: string) => {
        setSelectedSubscription({ id, author });
        setIsUnsubscribeModalOpen(true);
    };

    const handleConfirmUnsubscribe = async () => {
        if (!selectedSubscription) return;

        try {
            await axios.delete(`${API_URL}/subscriptions/${selectedSubscription.id}`);
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

    const formatDate = (timestamp?: number) => {
        if (!timestamp) return t('never');
        return new Date(timestamp).toLocaleString();
    };

    const handleCancelTaskClick = (task: ContinuousDownloadTask) => {
        setSelectedTask(task);
        setIsCancelTaskModalOpen(true);
    };

    const handleConfirmCancelTask = async () => {
        if (!selectedTask) return;

        try {
            await axios.delete(`${API_URL}/subscriptions/tasks/${selectedTask.id}`);
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
            await axios.delete(`${API_URL}/subscriptions/tasks/${selectedTask.id}/delete`);
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
            await axios.delete(`${API_URL}/subscriptions/tasks/clear-finished`);
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
            await axios.put(`${API_URL}/subscriptions/${id}/pause`);
            showSnackbar(t('subscriptionPaused'));
            refetchSubscriptions();
        } catch (error) {
            console.error('Error pausing subscription:', error);
            showSnackbar(t('error'));
        }
    };

    const handleResumeSubscription = async (id: string) => {
        try {
            await axios.put(`${API_URL}/subscriptions/${id}/resume`);
            showSnackbar(t('subscriptionResumed'));
            refetchSubscriptions();
        } catch (error) {
            console.error('Error resuming subscription:', error);
            showSnackbar(t('error'));
        }
    };

    const handlePauseTask = async (task: ContinuousDownloadTask) => {
        try {
            await axios.put(`${API_URL}/subscriptions/tasks/${task.id}/pause`);
            showSnackbar(t('taskPaused'));
            refetchTasks();
        } catch (error) {
            console.error('Error pausing task:', error);
            showSnackbar(t('error'));
        }
    };

    const handleResumeTask = async (task: ContinuousDownloadTask) => {
        try {
            await axios.put(`${API_URL}/subscriptions/tasks/${task.id}/resume`);
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
                            <TableCell>{t('platform')}</TableCell>
                            <TableCell>{t('interval')}</TableCell>
                            <TableCell>{t('lastCheck')}</TableCell>
                            <TableCell>{t('downloads')}</TableCell>
                            {!isVisitor && <TableCell align="right">{t('actions')}</TableCell>}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {subscriptions.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={isVisitor ? 5 : 6} align="center">
                                    <Typography color="text.secondary" sx={{ py: 4 }}>
                                        {t('noVideos')} {/* Reusing "No videos found" or similar if "No subscriptions" key missing */}
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        ) : (
                            subscriptions.map((sub) => (
                                <TableRow key={sub.id}>
                                    <TableCell>
                                        <Button
                                            href={sub.authorUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            sx={{ textTransform: 'none', justifyContent: 'flex-start', p: 0 }}
                                        >
                                            {sub.author}
                                        </Button>
                                    </TableCell>
                                    <TableCell>{sub.platform}</TableCell>
                                    <TableCell>{sub.interval} {t('minutes')}</TableCell>
                                    <TableCell>{formatDate(sub.lastCheck)}</TableCell>
                                    <TableCell>{sub.downloadCount}</TableCell>
                                    {!isVisitor && (
                                        <TableCell align="right">
                                            <IconButton
                                                color="error"
                                                onClick={() => handleUnsubscribeClick(sub.id, sub.author)}
                                                title={t('unsubscribe')}
                                            >
                                                <Delete />
                                            </IconButton>
                                            {sub.paused ? (
                                                <IconButton
                                                    color="success"
                                                    onClick={() => handleResumeSubscription(sub.id)}
                                                    title={t('resumeSubscription')}
                                                >
                                                    <PlayArrow />
                                                </IconButton>
                                            ) : (
                                                <IconButton
                                                    color="warning"
                                                    onClick={() => handlePauseSubscription(sub.id)}
                                                    title={t('pauseSubscription')}
                                                >
                                                    <Pause />
                                                </IconButton>
                                            )}
                                        </TableCell>
                                    )}
                                </TableRow>
                            ))
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
                                    <TableCell>{t('platform')}</TableCell>
                                    <TableCell>{t('status')}</TableCell>
                                    <TableCell>{t('progress')}</TableCell>
                                    <TableCell>{t('downloaded')}</TableCell>
                                    <TableCell>{t('skipped')}</TableCell>
                                    <TableCell>{t('failed')}</TableCell>
                                    {!isVisitor && <TableCell align="right">{t('actions')}</TableCell>}
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {tasks.slice().reverse().map((task) => (
                                    <TableRow key={task.id}>
                                        <TableCell>{task.playlistName || task.author}</TableCell>
                                        <TableCell>{task.platform}</TableCell>
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
                                        <TableCell>{task.downloadedCount}</TableCell>
                                        <TableCell>{task.skippedCount}</TableCell>
                                        <TableCell>{task.failedCount}</TableCell>
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
