import { Download, FactCheck } from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    LinearProgress,
    Link,
    List,
    ListItem,
    Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import React from 'react';
import { Link as RouterLink } from 'react-router';
import { useLanguage } from '../../contexts/LanguageContext';
import { api } from '../../utils/apiClient';
import { getApiErrorMessage, hasAxiosStatus } from '../../utils/errors';
import type { TranslationKey } from '../../utils/translations';
import { useVideoReDownload } from '../ManagePage/hooks/useVideoReDownload';

// The audit probes every local file, which on a large library can take
// minutes. Match the /api proxy's read timeout in nginx.conf so the browser does
// not give up first.
const AUDIT_TIMEOUT_MS = 300000;

type RecommendedAction = 'redownload' | 'refresh_duration' | 'manual_review';

interface MediaIntegrityAuditItem {
    localVideoId: string;
    title: string;
    sourceUrl: string | null;
    detail: string;
    recommendedAction: RecommendedAction;
}

interface MediaIntegrityAuditSummary {
    totalVideos: number;
    /** cloud:, mount: and remote rows, which the audit does not open. */
    skippedExternal: number;
}

// The response's humanSummary is English prose, so the summary is worded here
// from the counts instead.
interface MediaIntegrityAudit {
    items: MediaIntegrityAuditItem[];
    summary: MediaIntegrityAuditSummary;
}

const ACTION_LABEL_KEYS: Record<RecommendedAction, TranslationKey> = {
    redownload: 'mediaIntegrityAuditActionRedownload',
    refresh_duration: 'mediaIntegrityAuditActionRefreshDuration',
    manual_review: 'mediaIntegrityAuditActionManualReview',
};

// The browser's own timeout, or nginx answering 504 when it stops waiting.
const isTimeout = (error: unknown): boolean =>
    hasAxiosStatus(error, 504) ||
    (axios.isAxiosError(error) && error.code === 'ECONNABORTED');

const MediaIntegrityAuditSettings: React.FC = () => {
    const { t } = useLanguage();
    const { handleReDownload, isReDownloading } = useVideoReDownload();

    // A query rather than a mutation so a running or finished audit survives
    // switching settings tabs. It runs only when asked, and never retries: a
    // retry would repeat a scan that already took minutes.
    const { data: audit, error, isFetching, refetch } = useQuery({
        queryKey: ['mediaIntegrityAudit'],
        queryFn: async () => {
            const response = await api.get('/media-integrity-audit', { timeout: AUDIT_TIMEOUT_MS });
            return response.data.audit as MediaIntegrityAudit;
        },
        enabled: false,
        retry: false,
    });

    const renderItem = (item: MediaIntegrityAuditItem) => {
        const needsRedownload = item.recommendedAction === 'redownload';
        const sourceUrl = item.sourceUrl;
        return (
            <ListItem key={item.localVideoId} divider disableGutters sx={{ display: 'block' }}>
                <Link
                    component={RouterLink}
                    to={`/video/${item.localVideoId}`}
                    underline="hover"
                    sx={{ overflowWrap: 'anywhere' }}
                >
                    {item.title || item.localVideoId}
                </Link>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                    {item.detail}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mt: 1 }}>
                    <Typography variant="body2">
                        {t(ACTION_LABEL_KEYS[item.recommendedAction] ?? ACTION_LABEL_KEYS.manual_review)}
                    </Typography>
                    {needsRedownload && sourceUrl && (
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<Download />}
                            onClick={() => void handleReDownload({ sourceUrl })}
                            loading={isReDownloading(sourceUrl)}
                            loadingPosition="start"
                        >
                            {t('downloadAgain')}
                        </Button>
                    )}
                    {needsRedownload && !sourceUrl && (
                        <Typography variant="body2" color="text.secondary">
                            {t('noSourceUrlAvailable')}
                        </Typography>
                    )}
                </Box>
            </ListItem>
        );
    };

    const renderOutcome = () => {
        if (isFetching) {
            return (
                <Alert severity="info" sx={{ mt: 2 }}>
                    {t('mediaIntegrityAuditRunning')}
                    <LinearProgress sx={{ mt: 1 }} />
                </Alert>
            );
        }
        if (error) {
            return isTimeout(error) ? (
                <Alert severity="warning" sx={{ mt: 2 }}>
                    {t('mediaIntegrityAuditTimeout')}
                </Alert>
            ) : (
                <Alert severity="error" sx={{ mt: 2 }}>
                    {getApiErrorMessage(error) || t('mediaIntegrityAuditFailed')}
                </Alert>
            );
        }
        if (!audit) {
            return null;
        }
        const checked = audit.summary.totalVideos - audit.summary.skippedExternal;
        return (
            <>
                <Alert severity={audit.items.length === 0 ? 'success' : 'warning'} sx={{ mt: 2 }}>
                    {audit.items.length === 0
                        ? t('mediaIntegrityAuditSummaryClean', { checked })
                        : t('mediaIntegrityAuditSummaryProblems', { checked, count: audit.items.length })}
                </Alert>
                {audit.items.length > 0 && (
                    <List disablePadding sx={{ mt: 1 }}>
                        {audit.items.map(renderItem)}
                    </List>
                )}
            </>
        );
    };

    return (
        <Box id="mediaIntegrityAudit-setting">
            <Typography variant="h6" gutterBottom>{t('mediaIntegrityAudit')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('mediaIntegrityAuditDescription')}
            </Typography>
            <Button
                variant="outlined"
                startIcon={<FactCheck />}
                onClick={() => void refetch()}
                loading={isFetching}
                loadingPosition="start"
            >
                {t('mediaIntegrityAuditRun')}
            </Button>
            {renderOutcome()}
        </Box>
    );
};

export default MediaIntegrityAuditSettings;
