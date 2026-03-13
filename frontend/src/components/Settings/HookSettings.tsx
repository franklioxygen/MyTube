import { CheckCircle, CloudUpload, Delete, ErrorOutline, InfoOutlined } from '@mui/icons-material';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Paper, Typography } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';
import { api } from '../../utils/apiClient';
import ConfirmationModal from '../ConfirmationModal';
import PasswordModal from '../PasswordModal';

interface HookSettingsProps {
    settings: Settings;
    disabled?: boolean;
    onChange: (field: keyof Settings, value: any) => void;
}

const HOOK_GUIDE_EXAMPLE = `{
  "version": 1,
  "actions": [
    {
      "type": "notify_webhook",
      "url": "https://example.com/mytube-hook",
      "method": "POST",
      "timeoutMs": 5000,
      "headers": {
        "X-App": "MyTube"
      },
      "bodyTemplate": "Task {{taskTitle}} ({{taskId}}) -> {{status}}"
    }
  ]
}`;

const HOOK_TEMPLATE_VARIABLES = [
    'eventName',
    'taskId',
    'taskTitle',
    'sourceUrl',
    'status',
    'videoPath',
    'thumbnailPath',
    'error'
] as const;

const HookSettings: React.FC<HookSettingsProps> = ({ settings, disabled = false }) => {
    const { t } = useLanguage();
    const isLegacyMode = settings.securityModel !== 'strict';
    const hooksDisabled =
        disabled ||
        settings.securityModel === 'strict' ||
        settings.highRiskFeaturesDisabled?.hooks === true;
    const [deleteHookName, setDeleteHookName] = useState<string | null>(null);
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [showGuideModal, setShowGuideModal] = useState(false);
    const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
    const [isVerifying, setIsVerifying] = useState(false);
    const [pendingUpload, setPendingUpload] = useState<{ hookName: string; file: File } | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);

    const getText = (key: Parameters<typeof t>[0], fallback: string) => {
        const translated = t(key);
        return translated === key ? fallback : translated;
    };
    const uploadLabel = isLegacyMode
        ? getText('uploadLegacyHook', 'Upload .json or .sh')
        : getText('uploadJsonHook', 'Upload .json');
    const uploadPasswordMessage = isLegacyMode
        ? getText('enterPasswordToUploadLegacyHook', 'Please enter your password to upload this hook definition or shell script.')
        : (t('enterPasswordToUploadHook') || 'Please enter your password to upload this hook definition.');
    const hookDescription = isLegacyMode
        ? getText(
            'legacyTaskHooksDescription',
            'Legacy mode supports declarative JSON hooks and legacy shell scripts for each task event. Strict mode disables task hooks.'
        )
        : t('taskHooksDescription');
    const hookWarning = isLegacyMode
        ? getText(
            'legacyHookShellWarning',
            'Legacy mode accepts .json hooks and .sh scripts. Shell hooks run with the server OS permissions, so only upload trusted scripts.'
        )
        : (t('taskHooksWarning') || 'JSON hook actions are validated before execution.');

    const { data: hookStatus, refetch: refetchHooks, isLoading } = useQuery({
        queryKey: ['hookStatus'],
        queryFn: async () => {
            const response = await api.get('/settings/hooks/status');
            return response.data as Record<string, boolean>;
        }
    });

    const uploadMutation = useMutation({
        mutationFn: async ({ hookName, file }: { hookName: string; file: File }) => {
            const formData = new FormData();
            formData.append('file', file);
            await api.post(`/settings/hooks/${hookName}`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
        },
        onSuccess: () => {
            refetchHooks();
            setPendingUpload(null);
            setUploadError(null);
        },
        onError: (error: any) => {
            console.error('Upload failed:', error);
            const message = error.response?.data?.message || error.message;
            setUploadError(message || t('uploadFailed'));
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (hookName: string) => {
            await api.delete(`/settings/hooks/${hookName}`);
        },
        onSuccess: () => {
            refetchHooks();
            setDeleteHookName(null);
        }
    });

    const handleFileUpload = (hookName: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
        if (hooksDisabled) {
            return;
        }

        const file = e.target.files?.[0];
        if (!file) return;

        const isJsonFile = file.name.endsWith('.json');
        const isShellFile = file.name.endsWith('.sh') || file.name.endsWith('.bash');
        const canUpload = isLegacyMode ? (isJsonFile || isShellFile) : isJsonFile;

        if (!canUpload) {
            alert(isLegacyMode ? 'Only .json, .sh, or .bash files are allowed' : 'Only .json files are allowed');
            return;
        }

        // Reset input so the same file can be selected again
        e.target.value = '';

        setPendingUpload({ hookName, file });
        setPasswordError(undefined);
        setUploadError(null);
        setShowPasswordModal(true);
    };

    const handlePasswordConfirm = async (password: string) => {
        setIsVerifying(true);
        setPasswordError(undefined);
        try {
            await api.post('/settings/verify-password', { password });
            setShowPasswordModal(false);
            if (pendingUpload) {
                uploadMutation.mutate(pendingUpload);
            }
        } catch (error: any) {
            console.error('Password verification failed:', error);
            if (error.response?.status === 429) {
                const waitTime = error.response.data.waitTime;
                setPasswordError(t('tooManyAttempts') + ` Try again in ${Math.ceil(waitTime / 1000)}s`);
            } else {
                setPasswordError(t('incorrectPassword'));
            }
        } finally {
            setIsVerifying(false);
        }
    };

    const handleDelete = (hookName: string) => {
        if (hooksDisabled) {
            return;
        }
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
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: { xs: 'flex-start', sm: 'center' },
                        justifyContent: 'space-between',
                        gap: 2,
                        flexWrap: 'wrap',
                        mb: 1
                    }}
                >
                    <Box>
                        <Typography variant="h6" gutterBottom>{t('taskHooks')}</Typography>
                        <Typography variant="body2" color="text.secondary" paragraph>
                            {hookDescription}
                        </Typography>
                    </Box>

                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<InfoOutlined />}
                        onClick={() => setShowGuideModal(true)}
                    >
                        {getText('hookGuideButton', 'JSON Hook Guide')}
                    </Button>
                </Box>

                <Alert severity={isLegacyMode ? 'warning' : 'info'} sx={{ mb: 3 }}>
                    {hookWarning}
                </Alert>

                {hooksDisabled && (
                    <Alert severity="warning" sx={{ mb: 3 }}>
                        {t('featureDisabledInStrictMode') || 'Task hooks are disabled in strict security model.'}
                    </Alert>
                )}

                {uploadError && (
                    <Alert severity="error" sx={{ mb: 3 }} onClose={() => setUploadError(null)}>
                        {uploadError}
                    </Alert>
                )}

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
                                                disabled={uploadMutation.isPending || hooksDisabled}
                                            >
                                                {uploadMutation.isPending ? 'Up...' : uploadLabel}
                                                <input
                                                    type="file"
                                                    hidden
                                                    accept={isLegacyMode
                                                        ? '.json,application/json,text/json,.sh,.bash,text/x-shellscript'
                                                        : '.json,application/json,text/json'}
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
                                                    disabled={deleteMutation.isPending || hooksDisabled}
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
                title={t('deleteHook') || 'Delete Hook Definition'}
                message={t('confirmDeleteHook') || 'Are you sure you want to delete this hook definition?'}
                confirmText={t('delete') || 'Delete'}
                cancelText={t('cancel') || 'Cancel'}
                isDanger={true}
            />

            <PasswordModal
                isOpen={showPasswordModal}
                onClose={() => {
                    setShowPasswordModal(false);
                    setPendingUpload(null);
                    setPasswordError(undefined);
                }}
                onConfirm={handlePasswordConfirm}
                title={t('enterPassword')}
                message={uploadPasswordMessage}
                error={passwordError}
                isLoading={isVerifying}
            />

            <Dialog
                open={showGuideModal}
                onClose={() => setShowGuideModal(false)}
                maxWidth="md"
                fullWidth
            >
                <DialogTitle>{getText('hookGuideTitle', 'How JSON Hooks Run')}</DialogTitle>
                <DialogContent dividers>
                    <Typography variant="body2" color="text.secondary" paragraph>
                        {getText(
                            'hookGuideIntro',
                            'JSON hooks are declarative definitions. When a task event fires, MyTube loads the matching .json hook file, validates each action, and executes only allowlisted actions.'
                        )}
                    </Typography>

                    {isLegacyMode && (
                        <Alert severity="warning" sx={{ mb: 2 }}>
                            {getText(
                                'hookGuideLegacyShellNote',
                                'Legacy mode also supports .sh hooks. Shell scripts are executed by bash with MYTUBE_* environment variables and are not limited to the JSON action model described below.'
                            )}
                        </Alert>
                    )}

                    <Typography variant="subtitle2" gutterBottom>
                        {getText('hookGuideExecutionTitle', 'Execution Flow')}
                    </Typography>
                    <Box component="ul" sx={{ mt: 0, mb: 2, pl: 3 }}>
                        <Box component="li" sx={{ mb: 0.75 }}>
                            <Typography variant="body2">
                                {getText('hookGuideExecutionQueue', 'Event -> queue -> restricted executor. Hooks do not run arbitrary shell commands.')}
                            </Typography>
                        </Box>
                        <Box component="li" sx={{ mb: 0.75 }}>
                            <Typography variant="body2">
                                {getText('hookGuideExecutionSerial', 'Actions inside one hook are executed serially in the order they appear in the JSON file.')}
                            </Typography>
                        </Box>
                        <Box component="li">
                            <Typography variant="body2">
                                {getText('hookGuideExecutionValidation', 'Invalid JSON, unsupported action types, or disallowed fields are rejected before execution.')}
                            </Typography>
                        </Box>
                    </Box>

                    <Typography variant="subtitle2" gutterBottom>
                        {getText('hookGuideEventsTitle', 'Available Events')}
                    </Typography>
                    <Box component="ul" sx={{ mt: 0, mb: 2, pl: 3 }}>
                        {hooksConfig.map((hook) => (
                            <Box component="li" key={hook.name} sx={{ mb: 0.75 }}>
                                <Typography variant="body2">
                                    <Box component="span" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                                        {hook.name}
                                    </Box>
                                    {' - '}
                                    {hook.helper}
                                </Typography>
                            </Box>
                        ))}
                    </Box>

                    <Typography variant="subtitle2" gutterBottom>
                        {getText('hookGuideModesTitle', 'Execution Modes')}
                    </Typography>
                    <Box component="ul" sx={{ mt: 0, mb: 2, pl: 3 }}>
                        <Box component="li" sx={{ mb: 0.75 }}>
                            <Typography variant="body2">
                                {getText('hookGuideInlineMode', '`HOOK_EXECUTION_MODE=inline`: backend queues and executes the hook locally. Best for local development or single-process deployments.')}
                            </Typography>
                        </Box>
                        <Box component="li">
                            <Typography variant="body2">
                                {getText('hookGuideWorkerMode', '`HOOK_EXECUTION_MODE=worker`: backend writes jobs to `hook_worker_jobs`, and a separate `hook-worker` process or container polls and executes them. Recommended for production isolation.')}
                            </Typography>
                        </Box>
                    </Box>

                    <Typography variant="subtitle2" gutterBottom>
                        {getText('hookGuideActionTitle', 'Supported Action')}
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                        {getText('hookGuideActionBody', 'Currently only `notify_webhook` is supported. It sends an HTTP request to your endpoint after a hook event is triggered.')}
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                        {getText('hookGuideActionDetails', '`method` may be `POST`, `PUT`, or `PATCH`. If `bodyTemplate` is omitted, MyTube sends a JSON request body with the task context automatically.')}
                    </Typography>

                    <Typography variant="subtitle2" gutterBottom>
                        {getText('hookGuideVariablesTitle', 'Template Variables')}
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
                        {HOOK_TEMPLATE_VARIABLES.map((variable) => (
                            <Box
                                key={variable}
                                component="code"
                                sx={{
                                    px: 1,
                                    py: 0.5,
                                    borderRadius: 1,
                                    bgcolor: 'action.hover',
                                    fontFamily: 'monospace',
                                    fontSize: '0.8125rem'
                                }}
                            >
                                {`{{${variable}}}`}
                            </Box>
                        ))}
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        {getText('hookGuideTemplateFallback', 'If you do not provide `bodyTemplate`, the webhook receives these fields as JSON plus `emittedAt`.')}
                    </Typography>

                    <Typography variant="subtitle2" gutterBottom>
                        {getText('hookGuideExampleTitle', 'Example JSON')}
                    </Typography>
                    <Box
                        component="pre"
                        sx={{
                            m: 0,
                            p: 2,
                            borderRadius: 1.5,
                            bgcolor: 'grey.100',
                            color: 'text.primary',
                            overflowX: 'auto',
                            fontFamily: 'monospace',
                            fontSize: '0.8125rem',
                            lineHeight: 1.5,
                            whiteSpace: 'pre'
                        }}
                    >
                        {HOOK_GUIDE_EXAMPLE}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowGuideModal(false)}>
                        {t('close')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default HookSettings;
