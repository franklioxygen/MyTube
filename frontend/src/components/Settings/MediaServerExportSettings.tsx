import {
    Alert,
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControl,
    LinearProgress,
    MenuItem,
    Select,
    Tooltip,
    Typography,
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useSettingsJobPolling } from '../../hooks/useSettingsJobPolling';
import { Settings } from '../../types';
import { api } from '../../utils/apiClient';
import {
    MEDIA_SERVER_EXPORT_OPTIONS,
    MediaServerExportJob,
    getMediaServerExportErrorMessage,
    mediaServerExportJobUrl,
} from './filenameTemplateShared';

interface MediaServerExportSettingsProps {
    settings: Settings;
    onChange: (field: keyof Settings, value: any) => void;
    // True when the current filename template produces a Season/Episode-style
    // layout, which media servers expect for NFO export.
    recommendedTvLayout: boolean;
}

const SELECT_MAX_WIDTH = 400;

/**
 * Media-server export mode selector plus the rebuild/cleanup job runner.
 * Owns the export job state and its polling; the parent only supplies the
 * saved settings and whether the active template yields a TV-style layout.
 */
const MediaServerExportSettings: React.FC<MediaServerExportSettingsProps> = ({
    settings,
    onChange,
    recommendedTvLayout,
}) => {
    const { t } = useLanguage();
    const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
    const [exportJob, setExportJob] = useState<MediaServerExportJob | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);

    useSettingsJobPolling(exportJob, mediaServerExportJobUrl, setExportJob);

    const handleStartMediaServerExportRebuild = async () => {
        setExportConfirmOpen(false);
        setExportError(null);
        const mode = settings.mediaServerExportMode || 'off';
        try {
            const res = await api.post<{
                jobId: string;
                status: string;
                total: number;
                processed: number;
                succeeded: number;
                skipped: number;
                failed: number;
                action: 'rebuild' | 'cleanup';
                mode: 'off' | 'nfo' | 'nfo_and_source_json';
            }>(
                '/settings/media-server-export/rebuild',
                { mediaServerExportMode: mode }
            );
            const jobData = res.data;
            setExportJob({
                id: jobData.jobId,
                status: jobData.status as any,
                lockedAt: Date.now(),
                mode: jobData.mode,
                action: jobData.action,
                total: jobData.total,
                processed: jobData.processed,
                succeeded: jobData.succeeded,
                skipped: jobData.skipped,
                failed: jobData.failed,
                items: [],
            });
        } catch (e: unknown) {
            setExportError(getMediaServerExportErrorMessage(e, mode, t));
        }
    };

    const isExportRunning = exportJob?.status === 'running';
    const isExportComplete = exportJob?.status === 'completed';
    const exportMode = settings.mediaServerExportMode || 'off';
    const exportAction = exportMode === 'off' ? 'cleanup' : 'rebuild';
    const activeExportAction = exportJob?.action || exportAction;

    return (
        <Box sx={{ mt: 3 }}>
            <Typography variant="h6" gutterBottom>
                {t('mediaServerExportMode')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {exportMode === 'off'
                    ? t('mediaServerExportModeOffDescription')
                    : t('mediaServerExportModeDescription')}
            </Typography>

            <FormControl fullWidth sx={{ maxWidth: SELECT_MAX_WIDTH }}>
                <Select
                    value={settings.mediaServerExportMode || 'off'}
                    onChange={(e) => onChange('mediaServerExportMode', e.target.value)}
                >
                    {MEDIA_SERVER_EXPORT_OPTIONS.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                            {t(opt.labelKey)}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            {(settings.mediaServerExportMode || 'off') !== 'off' && !recommendedTvLayout && (
                <Alert severity="warning" sx={{ mt: 2, maxWidth: 920 }}>
                    {t('mediaServerExportRecommendedLayoutWarning')}
                </Alert>
            )}

            {exportMode === 'off' && (
                <Alert severity="info" sx={{ mt: 2, maxWidth: 920 }}>
                    {t('mediaServerExportCleanupHint')}
                </Alert>
            )}

            {exportError && (
                <Alert severity="error" sx={{ mt: 2, maxWidth: 920 }}>
                    {exportError}
                </Alert>
            )}

            {isExportRunning && exportJob && (
                <Box sx={{ mt: 2, maxWidth: 520 }}>
                    <Typography variant="body2" sx={{ mb: 0.75 }}>
                        {t(activeExportAction === 'cleanup'
                            ? 'mediaServerExportCleanupRunning'
                            : 'mediaServerExportRebuildRunning')} {exportJob.processed}/{exportJob.total}
                        {exportJob.currentTitle && ` – ${exportJob.currentTitle}`}
                    </Typography>
                    <LinearProgress
                        variant="determinate"
                        value={exportJob.total > 0 ? (exportJob.processed / exportJob.total) * 100 : 0}
                    />
                </Box>
            )}

            {isExportComplete && exportJob && (
                <Alert severity="success" sx={{ mt: 2, maxWidth: 920 }}>
                    {t(activeExportAction === 'cleanup'
                        ? 'mediaServerExportCleanupComplete'
                        : 'mediaServerExportRebuildComplete')} –{' '}
                    {t(activeExportAction === 'cleanup'
                        ? 'mediaServerExportCleanupSummary'
                        : 'mediaServerExportRebuildSummary')
                        .replace('{succeeded}', String(exportJob.succeeded))
                        .replace('{skipped}', String(exportJob.skipped))
                        .replace('{failed}', String(exportJob.failed))}
                </Alert>
            )}

            <Tooltip
                title={
                    isExportRunning
                            ? t('mediaServerExportRebuildDisabledRunning')
                            : ''
                }
                disableHoverListener={!isExportRunning}
            >
                <span>
                    <Button
                        variant="outlined"
                        onClick={() => setExportConfirmOpen(true)}
                        disabled={isExportRunning}
                        sx={{ mt: 2 }}
                    >
                        {t(exportAction === 'cleanup'
                            ? 'mediaServerExportCleanup'
                            : 'mediaServerExportRebuild')}
                    </Button>
                </span>
            </Tooltip>

            <Dialog open={exportConfirmOpen} onClose={() => setExportConfirmOpen(false)}>
                <DialogTitle>{t(exportAction === 'cleanup'
                    ? 'mediaServerExportCleanupConfirmTitle'
                    : 'mediaServerExportRebuildConfirmTitle')}</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {t(exportAction === 'cleanup'
                            ? 'mediaServerExportCleanupConfirmBody'
                            : 'mediaServerExportRebuildConfirmBody')}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setExportConfirmOpen(false)}>{t('cancel')}</Button>
                    <Button onClick={handleStartMediaServerExportRebuild} variant="contained">
                        {t(exportAction === 'cleanup'
                            ? 'mediaServerExportCleanup'
                            : 'mediaServerExportRebuild')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default MediaServerExportSettings;
