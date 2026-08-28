import {
    Alert,
    Box,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControl,
    FormControlLabel,
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
    MEDIA_SERVER_EXPORT_DETAIL_LIMIT,
    MEDIA_SERVER_EXPORT_PHASE_LABEL_KEYS,
    MEDIA_SERVER_EXPORT_LAYOUT_OPTIONS,
    MEDIA_SERVER_EXPORT_OPTIONS,
    MediaServerExportJob,
    MediaServerExportLayout,
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
 * Media-server export selectors plus the rebuild/cleanup job runner. Owns the
 * export job state and its polling; the parent only supplies the saved settings
 * and whether the active filename template yields a TV-style layout.
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
    const [startingExport, setStartingExport] = useState(false);
    const [pathCopied, setPathCopied] = useState(false);

    useSettingsJobPolling(exportJob, mediaServerExportJobUrl, setExportJob);

    const exportMode = settings.mediaServerExportMode || 'off';
    const exportLayout: MediaServerExportLayout = settings.mediaServerExportLayout || 'adjacent';
    const isPlaylistTv = exportLayout === 'playlist_tv';
    const exportAction = exportMode === 'off' ? 'cleanup' : 'rebuild';
    const libraryPath = settings.mediaServerLibraryPath;

    const handleStartMediaServerExportRebuild = async () => {
        setStartingExport(true);
        setExportError(null);
        try {
            const res = await api.post<
                Omit<MediaServerExportJob, 'id' | 'lockedAt' | 'items'> & { jobId: string }
            >('/settings/media-server-export/rebuild', {
                mediaServerExportMode: exportMode,
                mediaServerExportLayout: exportLayout,
            });
            const jobData = res.data;
            setExportJob({ ...jobData, id: jobData.jobId, lockedAt: Date.now(), items: [] });
            setExportConfirmOpen(false);
        } catch (e: unknown) {
            setExportError(getMediaServerExportErrorMessage(e, exportMode, t));
        } finally {
            setStartingExport(false);
        }
    };

    const handleCopyLibraryPath = async () => {
        if (!libraryPath) return;
        try {
            await navigator.clipboard.writeText(libraryPath);
            setPathCopied(true);
        } catch {
            // Clipboard access can be denied; the path stays selectable on screen.
        }
    };

    const isExportRunning = exportJob?.status === 'running';
    const isExportComplete = exportJob?.status === 'completed';
    const activeExportAction = exportJob?.action || exportAction;
    const counts = exportJob?.counts;
    const reportedItems = exportJob?.items ?? [];
    const failedItems = reportedItems
        .filter((item) => item.status === 'failed')
        .slice(0, MEDIA_SERVER_EXPORT_DETAIL_LIMIT);
    const skippedItems = reportedItems
        .filter((item) => item.status === 'skipped')
        .slice(0, MEDIA_SERVER_EXPORT_DETAIL_LIMIT);

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
                    value={exportMode}
                    onChange={(e) => onChange('mediaServerExportMode', e.target.value)}
                >
                    {MEDIA_SERVER_EXPORT_OPTIONS.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                            {t(opt.labelKey)}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            <Typography variant="subtitle1" sx={{ mt: 3 }}>
                {t('mediaServerExportLayout')}
            </Typography>
            <FormControl fullWidth sx={{ maxWidth: SELECT_MAX_WIDTH, mt: 1 }}>
                <Select
                    value={exportLayout}
                    onChange={(e) => onChange('mediaServerExportLayout', e.target.value)}
                    inputProps={{ 'aria-label': t('mediaServerExportLayout') }}
                >
                    {MEDIA_SERVER_EXPORT_LAYOUT_OPTIONS.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                            {t(opt.labelKey)}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            {isPlaylistTv && (
                <Box sx={{ mt: 2, maxWidth: 920 }}>
                    <Typography variant="body2" color="text.secondary">
                        {t('mediaServerExportLayoutPlaylistTvDescription')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        {t('mediaServerSeasonZeroHint')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        {t('mediaServerStableOrderHint')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        {t('mediaServerHardLinkHint')}
                    </Typography>

                    {libraryPath && (
                        <Box sx={{ mt: 2 }}>
                            <Typography variant="body2">{t('mediaServerLibraryPath')}</Typography>
                            <Typography
                                variant="body2"
                                component="code"
                                sx={{ wordBreak: 'break-all', display: 'block', mt: 0.5 }}
                            >
                                {libraryPath}
                            </Typography>
                            <Button size="small" onClick={() => { void handleCopyLibraryPath(); }} sx={{ mt: 0.5 }}>
                                {t(pathCopied ? 'copied' : 'mediaServerLibraryPathCopy')}
                            </Button>
                        </Box>
                    )}

                    <FormControlLabel
                        sx={{ mt: 1 }}
                        control={
                            <Checkbox
                                checked={settings.mediaServerCopyFallback !== false}
                                onChange={(e) => onChange('mediaServerCopyFallback', e.target.checked)}
                            />
                        }
                        label={t('mediaServerCopyFallback')}
                    />
                    <Typography variant="body2" color="text.secondary">
                        {t('mediaServerCopyFallbackDescription')}
                    </Typography>
                </Box>
            )}

            {exportMode !== 'off' && !isPlaylistTv && !recommendedTvLayout && (
                <Alert severity="warning" sx={{ mt: 2, maxWidth: 920 }}>
                    {t('mediaServerExportRecommendedLayoutWarning')}
                </Alert>
            )}

            {exportMode !== 'off' && isPlaylistTv && (
                <Alert severity="info" sx={{ mt: 2, maxWidth: 920 }}>
                    {t('mediaServerExportLayoutPlaylistTvNamingNote')}
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
                        {exportJob.phase && ` – ${t(MEDIA_SERVER_EXPORT_PHASE_LABEL_KEYS[exportJob.phase])}`}
                        {exportJob.currentTitle && ` – ${exportJob.currentTitle}`}
                    </Typography>
                    <LinearProgress
                        variant="determinate"
                        value={exportJob.total > 0 ? (exportJob.processed / exportJob.total) * 100 : 0}
                    />
                </Box>
            )}

            {isExportComplete && exportJob && (
                <Box sx={{ mt: 2, maxWidth: 920 }}>
                    <Alert severity="success">
                        {t(activeExportAction === 'cleanup'
                            ? 'mediaServerExportCleanupComplete'
                            : 'mediaServerExportRebuildComplete')} –{' '}
                        {t(activeExportAction === 'cleanup'
                            ? 'mediaServerExportCleanupSummary'
                            : 'mediaServerExportRebuildSummary')
                            .replace('{succeeded}', String(exportJob.succeeded))
                            .replace('{skipped}', String(exportJob.skipped))
                            .replace('{failed}', String(exportJob.failed))}
                        {exportJob.sweptFiles && exportJob.sweptFiles > 0
                            ? ` ${t('mediaServerExportSweptSummary').replace('{count}', String(exportJob.sweptFiles))}`
                            : ''}
                        {counts && (
                            <Typography variant="body2" sx={{ mt: 1 }}>
                                {t('mediaServerExportMirrorSummary')
                                    .replace('{shows}', String(counts.shows))
                                    .replace('{seasons}', String(counts.seasons))
                                    .replace('{episodes}', String(counts.episodes))
                                    .replace('{linked}', String(counts.linkedMedia))
                                    .replace('{copied}', String(counts.copiedMedia))
                                    .replace('{removed}', String(counts.removedArtifacts))}
                            </Typography>
                        )}
                    </Alert>

                    {counts && counts.copiedMedia > 0 && (
                        <Alert severity="warning" sx={{ mt: 1 }}>
                            {t('mediaServerCopiedMediaWarning').replace('{count}', String(counts.copiedMedia))}
                        </Alert>
                    )}

                    {failedItems.length > 0 && (
                        <Box sx={{ mt: 1 }} component="ul" aria-label={t('mediaServerExportFailedDetails')}>
                            {failedItems.map((item, index) => (
                                <Typography key={`${item.videoId}-${index}`} component="li" variant="body2">
                                    {item.title} – {item.errorCode || item.error}
                                </Typography>
                            ))}
                        </Box>
                    )}

                    {skippedItems.length > 0 && (
                        <Box sx={{ mt: 1 }} component="ul" aria-label={t('mediaServerExportSkippedDetails')}>
                            {skippedItems.map((item, index) => (
                                <Typography key={`${item.videoId}-${index}`} component="li" variant="body2">
                                    {item.title} – {item.skipReason}
                                </Typography>
                            ))}
                        </Box>
                    )}
                </Box>
            )}

            <Tooltip
                title={isExportRunning ? t('mediaServerExportRebuildDisabledRunning') : ''}
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

            <Dialog
                open={exportConfirmOpen}
                onClose={() => {
                    if (!startingExport) {
                        setExportConfirmOpen(false);
                    }
                }}
                disableEscapeKeyDown={startingExport}
            >
                <DialogTitle>{t(exportAction === 'cleanup'
                    ? 'mediaServerExportCleanupConfirmTitle'
                    : 'mediaServerExportRebuildConfirmTitle')}</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {isPlaylistTv
                            ? t(exportAction === 'cleanup'
                                ? 'mediaServerExportPlaylistTvCleanupConfirmBody'
                                : 'mediaServerExportPlaylistTvRebuildConfirmBody')
                            : t(exportAction === 'cleanup'
                                ? 'mediaServerExportCleanupConfirmBody'
                                : 'mediaServerExportRebuildConfirmBody')}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setExportConfirmOpen(false)} disabled={startingExport}>{t('cancel')}</Button>
                    <Button
                        onClick={() => { void handleStartMediaServerExportRebuild(); }}
                        variant="contained"
                        loading={startingExport}
                        loadingPosition="start"
                    >
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
