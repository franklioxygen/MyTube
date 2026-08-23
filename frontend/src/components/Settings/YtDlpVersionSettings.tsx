import { Refresh, SystemUpdateAlt } from '@mui/icons-material';
import { Alert, Box, Button, Chip, Skeleton, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { api } from '../../utils/apiClient';

// A pip install pulls wheels over the network, which regularly outruns the
// 30s default timeout of the shared api client.
const UPDATE_TIMEOUT_MS = 300000;

interface YtDlpStatus {
    version: string | null;
    path: string;
    available: boolean;
    isStale: boolean;
    staleAfterDays: number;
    latestVersion: string | null;
    updateAvailable: boolean;
    updateSupported: boolean;
    customPathConfigured: boolean;
    errorMessage?: string;
}

interface YtDlpUpdateResult {
    previousVersion: string | null;
    status: YtDlpStatus;
    /** True when the reported version actually changed. */
    changed: boolean;
}

interface YtDlpVersionSettingsProps {
    /** False in application trust mode, where the backend refuses the update. */
    canUpdate?: boolean;
}

type FeedbackMessage = { type: 'success' | 'info' | 'error'; text: string };

const getErrorText = (error: unknown, fallback: string): string => {
    const responseError = (error as { response?: { data?: { error?: string } } })
        .response?.data?.error;
    return responseError || fallback;
};

const YtDlpVersionSettings: React.FC<YtDlpVersionSettingsProps> = ({ canUpdate = true }) => {
    const { t } = useLanguage();
    const queryClient = useQueryClient();
    const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);

    const {
        data: status,
        isFetching,
        error: statusError,
        refetch,
    } = useQuery<YtDlpStatus | null>({
        queryKey: ['ytDlpVersion'],
        queryFn: async () => {
            const response = await api.get('/settings/ytdlp/version');
            return (response.data?.data ?? null) as YtDlpStatus | null;
        },
        // The version only changes when someone updates it, so do not re-probe
        // the binary every time the Settings tab regains focus.
        refetchOnWindowFocus: false,
    });

    const checkMutation = useMutation({
        mutationFn: async () => {
            const response = await api.get('/settings/ytdlp/version?checkLatest=true');
            return (response.data?.data ?? null) as YtDlpStatus | null;
        },
        onSuccess: (loaded) => {
            if (loaded) {
                queryClient.setQueryData(['ytDlpVersion'], loaded);
            }
            if (loaded?.latestVersion && !loaded.updateAvailable) {
                setFeedback({ type: 'info', text: t('ytDlpUpToDate') });
            }
        },
        onError: (error: unknown) => {
            setFeedback({
                type: 'error',
                text: getErrorText(error, t('ytDlpVersionCheckFailed')),
            });
        },
    });

    const updateMutation = useMutation({
        mutationFn: async () => {
            const response = await api.post(
                '/settings/ytdlp/update',
                {},
                { timeout: UPDATE_TIMEOUT_MS }
            );
            return response.data?.data as YtDlpUpdateResult | undefined;
        },
        onSuccess: (result) => {
            setFeedback(
                result?.changed
                    ? {
                        type: 'success',
                        text: t('ytDlpUpdateSuccess', {
                            version: result.status?.version || '',
                        }),
                    }
                    : { type: 'info', text: t('ytDlpUpdateNoChange') }
            );
            if (result?.status) {
                queryClient.setQueryData(['ytDlpVersion'], result.status);
            } else {
                void refetch();
            }
        },
        onError: (error: unknown) => {
            setFeedback({
                type: 'error',
                text: getErrorText(error, t('ytDlpUpdateFailed')),
            });
        },
    });

    const isUpdating = updateMutation.isPending;
    const isCheckingLatest = checkMutation.isPending;

    const handleCheck = () => {
        setFeedback(null);
        checkMutation.mutate();
    };

    const updateDisabled =
        isUpdating ||
        isFetching ||
        isCheckingLatest ||
        !canUpdate ||
        status?.updateSupported === false;

    const renderVersion = () => {
        if (isFetching && !status) {
            return <Skeleton variant="text" width={140} />;
        }
        if (statusError) {
            return (
                <Typography variant="body2" color="error">
                    {t('ytDlpVersionCheckFailed')}
                </Typography>
            );
        }
        if (!status?.available) {
            return (
                <Typography variant="body2" color="error">
                    {t('ytDlpVersionUnavailable')}
                </Typography>
            );
        }
        return (
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {status.version || t('ytDlpVersionUnknown')}
            </Typography>
        );
    };

    return (
        <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                <Typography variant="body2" color="text.secondary">
                    {t('ytDlpVersion')}
                </Typography>
                {renderVersion()}
                {status?.updateAvailable && status.latestVersion && (
                    <Chip
                        size="small"
                        color="warning"
                        label={t('ytDlpUpdateAvailable', { version: status.latestVersion })}
                    />
                )}
                {status?.available && !status.updateAvailable && status.latestVersion && (
                    <Chip size="small" color="success" label={t('ytDlpUpToDate')} />
                )}
            </Box>

            {status?.path && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {t('ytDlpBinaryPath', { path: status.path })}
                </Typography>
            )}

            <Box sx={{ display: 'flex', gap: 2, mt: 1.5, flexWrap: 'wrap' }}>
                <Button
                    variant="outlined"
                    size="small"
                    startIcon={<Refresh />}
                    onClick={handleCheck}
                    loading={isFetching || isCheckingLatest}
                    loadingPosition="start"
                    disabled={isUpdating}
                >
                    {t('ytDlpCheckUpdate')}
                </Button>
                <Button
                    variant="outlined"
                    size="small"
                    startIcon={<SystemUpdateAlt />}
                    onClick={() => updateMutation.mutate()}
                    loading={isUpdating}
                    loadingPosition="start"
                    disabled={updateDisabled}
                >
                    {t('ytDlpUpdate')}
                </Button>
            </Box>

            {status?.customPathConfigured && (
                <Alert severity="info" sx={{ mt: 2 }}>
                    {t('ytDlpUpdateCustomPathNotice')}
                </Alert>
            )}

            {!canUpdate && (
                <Alert severity="info" sx={{ mt: 2 }}>
                    {t('ytDlpUpdatePolicyNotice')}
                </Alert>
            )}

            {isUpdating && (
                <Alert severity="info" sx={{ mt: 2 }}>
                    {t('ytDlpUpdateInProgress')}
                </Alert>
            )}

            {feedback && (
                <Alert severity={feedback.type} sx={{ mt: 2 }} onClose={() => setFeedback(null)}>
                    {feedback.text}
                </Alert>
            )}
        </Box>
    );
};

export default YtDlpVersionSettings;
