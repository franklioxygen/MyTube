import { CheckCircle, CloudUpload, Delete, ErrorOutline } from '@mui/icons-material';
import { Alert, Box, Button, CircularProgress, Grid, Paper, Typography } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';
import ConfirmationModal from '../ConfirmationModal';

interface HookSettingsProps {
    settings: Settings;
    onChange: (field: keyof Settings, value: any) => void;
}

const API_URL = import.meta.env.VITE_API_URL;

const HookSettings: React.FC<HookSettingsProps> = () => {
    const { t } = useLanguage();
    const [deleteHookName, setDeleteHookName] = useState<string | null>(null);

    const { data: hookStatus, refetch: refetchHooks, isLoading } = useQuery({
        queryKey: ['hookStatus'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/settings/hooks/status`);
            return response.data as Record<string, boolean>;
        }
    });

    const uploadMutation = useMutation({
        mutationFn: async ({ hookName, file }: { hookName: string; file: File }) => {
            const formData = new FormData();
            formData.append('file', file);
            await axios.post(`${API_URL}/settings/hooks/${hookName}`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
        },
        onSuccess: () => {
            refetchHooks();
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (hookName: string) => {
            await axios.delete(`${API_URL}/settings/hooks/${hookName}`);
        },
        onSuccess: () => {
            refetchHooks();
            setDeleteHookName(null);
        }
    });

    const handleFileUpload = (hookName: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.name.endsWith('.sh') && !file.name.endsWith('.bash')) {
            alert('Only .sh files are allowed');
            return;
        }

        uploadMutation.mutate({ hookName, file });

        // Reset input so the same file can be selected again
        e.target.value = '';
    };

    const handleDelete = (hookName: string) => {
        setDeleteHookName(hookName);
    };

    const confirmDelete = () => {
        if (deleteHookName) {
            deleteMutation.mutate(deleteHookName);
        }
    };

    const hooksConfig = [
        {
            name: 'task_before_start',
            label: t('hookTaskBeforeStart'),
            helper: t('hookTaskBeforeStartHelper'),
        },
        {
            name: 'task_success',
            label: t('hookTaskSuccess'),
            helper: t('hookTaskSuccessHelper'),
        },
        {
            name: 'task_fail',
            label: t('hookTaskFail'),
            helper: t('hookTaskFailHelper'),
        },
        {
            name: 'task_cancel',
            label: t('hookTaskCancel'),
            helper: t('hookTaskCancelHelper'),
        }
    ];

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
                <Typography variant="h6" gutterBottom>{t('taskHooks')}</Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                    {t('taskHooksDescription')}
                </Typography>

                <Alert severity="info" sx={{ mb: 3 }}>
                    {t('taskHooksWarning')}
                </Alert>

                {isLoading ? (
                    <CircularProgress />
                ) : (
                    <Grid container spacing={2}>
                        {hooksConfig.map((hook) => {
                            const exists = hookStatus?.[hook.name];
                            return (
                                <Grid size={{ xs: 12, md: 6 }} key={hook.name}>
                                    <Paper variant="outlined" sx={{ p: 2 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
                                            <Typography variant="subtitle1" fontWeight="bold">
                                                {hook.label}
                                            </Typography>
                                            {exists ? (
                                                <Alert icon={<CheckCircle fontSize="inherit" />} severity="success" sx={{ py: 0, px: 1 }}>
                                                    {t('found') || 'Found'}
                                                </Alert>
                                            ) : (
                                                <Alert icon={<ErrorOutline fontSize="inherit" />} severity="warning" sx={{ py: 0, px: 1 }}>
                                                    {t('notFound') || 'Not Set'}
                                                </Alert>
                                            )}
                                        </Box>

                                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, minHeight: 40 }}>
                                            {hook.helper}
                                        </Typography>

                                        <Box sx={{ display: 'flex', gap: 1 }}>
                                            <Button
                                                variant="outlined"
                                                component="label"
                                                size="small"
                                                startIcon={<CloudUpload />}
                                                disabled={uploadMutation.isPending}
                                            >
                                                {uploadMutation.isPending ? 'Up...' : (t('uploadHook') || 'Upload .sh')}
                                                <input
                                                    type="file"
                                                    hidden
                                                    accept=".sh,.bash"
                                                    onChange={handleFileUpload(hook.name)}
                                                />
                                            </Button>

                                            {exists && (
                                                <Button
                                                    variant="outlined"
                                                    color="error"
                                                    size="small"
                                                    startIcon={<Delete />}
                                                    onClick={() => handleDelete(hook.name)}
                                                    disabled={deleteMutation.isPending}
                                                >
                                                    {t('delete') || 'Delete'}
                                                </Button>
                                            )}
                                        </Box>
                                    </Paper>
                                </Grid>
                            );
                        })}
                    </Grid>
                )}
            </Box>

            <ConfirmationModal
                isOpen={!!deleteHookName}
                onClose={() => setDeleteHookName(null)}
                onConfirm={confirmDelete}
                title={t('deleteHook') || 'Delete Hook Script'}
                message={t('confirmDeleteHook') || 'Are you sure you want to delete this hook script?'}
                confirmText={t('delete') || 'Delete'}
                cancelText={t('cancel') || 'Cancel'}
                isDanger={true}
            />
        </Box>
    );
};

export default HookSettings;
