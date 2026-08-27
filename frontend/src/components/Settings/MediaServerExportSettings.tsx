import ContentCopyIcon from '@mui/icons-material/ContentCopy';
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
    IconButton,
    LinearProgress,
    List,
    ListItem,
    ListItemText,
    MenuItem,
    Select,
    Tooltip,
    Typography,
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useSettingsJobPolling } from '../../hooks/useSettingsJobPolling';
import { MediaServerExportLayout, Settings } from '../../types';
import { api } from '../../utils/apiClient';
import {
    MEDIA_SERVER_EXPORT_FAILURE_DETAIL_LIMIT,
    MEDIA_SERVER_EXPORT_LAYOUT_OPTIONS,
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
const ALERT_MAX_WIDTH = 920;

/**
 * Media-server export settings plus the rebuild/cleanup job runner.
 *
 * Two independent choices (issue #411): the export *mode* (what metadata is
 * written) and the export *layout* — `adjacent` sidecars next to the original
 * media, or the MyTube-managed `playlist_tv` mirror of author shows and playlist
 * seasons. Original files are never moved or renamed in either layout.
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
    const [scope, setScope] = useState<{
        videoCount: number;
        showCount: number;
        collectionShowCount: number;
    } | null>(null);
    const [scopeLoading, setScopeLoading] = useState(false);

    useSettingsJobPolling(exportJob, mediaServerExportJobUrl, setExportJob);

    const exportMode = settings.mediaServerExportMode || 'off';
    const exportLayout: MediaServerExportLayout =
        settings.mediaServerExportLayout === 'playlist_tv' ? 'playlist_tv' : 'adjacent';
    const isPlaylistTv = exportLayout === 'playlist_tv';
    const copyFallbackEnabled = settings.mediaServerCopyFallback !== false;
    const libraryPath = settings.mediaServerLibraryPath || '';

    /**
     * The managed layout materializes the whole library, so the confirmation
     * has to state that size. Fetched on open rather than kept live: it is only
     * ever read to answer "what am I about to trigger?".
     */
    const openExportConfirm = async () => {
        setExportConfirmOpen(true);
        if (!isPlaylistTv || exportAction === 'cleanup') return;
        setScope(null);
        setScopeLoading(true);
        try {
            const res = await api.get<{
                videoCount: number;
                showCount: number;
                collectionShowCount: number;
            }>('/settings/media-server-export/scope');
            setScope(res.data);
        } catch {
            // A failed projection must not block the action; the dialog simply
            // falls back to the qualitative warning.
            setScope(null);
        } finally {
            setScopeLoading(false);
        }
    };

    const handleStartMediaServerExportRebuild = async () => {
        setStartingExport(true);
        setExportError(null);
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
                layout?: MediaServerExportLayout;
            }>(
                '/settings/media-server-export/rebuild',
                // The layout is sent explicitly so the action cannot change
                // between this confirmation and execution.
                { mediaServerExportMode: exportMode, mediaServerExportLayout: exportLayout }
            );
            const jobData = res.data;
            setExportJob({
                id: jobData.jobId,
                status: jobData.status as any,
                lockedAt: Date.now(),
                mode: jobData.mode,
                layout: jobData.layout,
                action: jobData.action,
                total: jobData.total,
                processed: jobData.processed,
                succeeded: jobData.succeeded,
                skipped: jobData.skipped,
                failed: jobData.failed,
                items: [],
            });
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
            window.setTimeout(() => setPathCopied(false), 2000);
        } catch {
            // Clipboard access can be denied; the path is still selectable.
        }
    };

    const isExportRunning = exportJob?.status === 'running';
    const isExportComplete = exportJob?.status === 'completed';
    const exportAction = exportMode === 'off' ? 'cleanup' : 'rebuild';
    const activeExportAction = exportJob?.action || exportAction;

    const failedItems = (exportJob?.items || []).filter(
        (item) => item.status === 'failed'
    );
    const skippedItems = (exportJob?.items || []).filter(
        (item) => item.status === 'skipped'
    );

    const renderReasonList = (
        items: MediaServerExportJob['items'],
        headingKey: 'mediaServerExportFailedItems' | 'mediaServerExportSkippedItems'
    ) => {
        if (items.length === 0) return null;
        const shown = items.slice(0, MEDIA_SERVER_EXPORT_FAILURE_DETAIL_LIMIT);
        const remaining = items.length - shown.length;

        return (
            <Box sx={{ mt: 1 }}>
                <Typography variant="subtitle2" component="h4">
                    {t(headingKey).replace('{count}', String(items.length))}
                </Typography>
                <List dense disablePadding>
                    {shown.map((item, index) => (
                        <ListItem key={`${item.videoId}-${index}`} disableGutters>
                            <ListItemText
                                primary={item.title || item.videoId}
                                secondary={item.errorCode || item.skipReason || item.error}
                            />
                        </ListItem>
                    ))}
                </List>
                {remaining > 0 && (
                    <Typography variant="caption" color="text.secondary">
                        {t('mediaServerExportMoreItems').replace('{count}', String(remaining))}
                    </Typography>
                )}
            </Box>
        );
    };

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

            {/* Layout selector (issue #411). Always rendered so the choice is
                discoverable even before an export mode is picked. */}
            <Typography variant="subtitle1" sx={{ mt: 3 }} gutterBottom>
                {t('mediaServerExportLayout')}
            </Typography>
            <FormControl fullWidth sx={{ maxWidth: SELECT_MAX_WIDTH }}>
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

            {/* The layout is inert while the export mode is off — the exporter
                returns before it ever looks at the layout. Without this warning
                a user can pick the managed-library layout, save, and reasonably
                believe it is active. */}
            {isPlaylistTv && exportMode === 'off' && (
                <Alert severity="warning" sx={{ mt: 2, maxWidth: ALERT_MAX_WIDTH }}>
                    {t('mediaServerExportLayoutInactiveWarning')}
                </Alert>
            )}

            {isPlaylistTv && (
                <>
                    <Alert severity="info" sx={{ mt: 2, maxWidth: ALERT_MAX_WIDTH }}>
                        <Typography variant="body2">
                            {t('mediaServerExportLayoutPlaylistTvDescription')}
                        </Typography>
                        <Typography variant="body2" sx={{ mt: 1 }}>
                            {t('mediaServerSeasonZeroHint')}
                        </Typography>
                        <Typography variant="body2" sx={{ mt: 1 }}>
                            {t('mediaServerStableOrderHint')}
                        </Typography>
                    </Alert>

                    {libraryPath && (
                        <Box sx={{ mt: 2, maxWidth: ALERT_MAX_WIDTH }}>
                            <Typography variant="subtitle2" component="h4">
                                {t('mediaServerLibraryPath')}
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography
                                    variant="body2"
                                    sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                                >
                                    {libraryPath}
                                </Typography>
                                <Tooltip title={pathCopied ? t('copied') : t('copyLink')}>
                                    <IconButton
                                        size="small"
                                        onClick={() => { void handleCopyLibraryPath(); }}
                                        aria-label={t('copyLink')}
                                    >
                                        <ContentCopyIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            </Box>
                        </Box>
                    )}

                    <FormControlLabel
                        sx={{ mt: 1, display: 'block' }}
                        control={
                            <Checkbox
                                checked={copyFallbackEnabled}
                                onChange={(e) =>
                                    onChange('mediaServerCopyFallback', e.target.checked)
                                }
                            />
                        }
                        label={t('mediaServerCopyFallback')}
                    />
                    <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                        {t('mediaServerCopyFallbackDescription')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ ml: 4, mt: 0.5 }}>
                        {t('mediaServerHardLinkHint')}
                    </Typography>
                </>
            )}

            {/* The filename-template warning only applies to the adjacent layout:
                the managed mirror builds its own TV structure regardless of the
                user's naming settings. */}
            {exportMode !== 'off' && !isPlaylistTv && !recommendedTvLayout && (
                <Alert severity="warning" sx={{ mt: 2, maxWidth: ALERT_MAX_WIDTH }}>
                    {t('mediaServerExportRecommendedLayoutWarning')}
                </Alert>
            )}

            {exportMode !== 'off' && isPlaylistTv && (
                <Alert severity="info" sx={{ mt: 2, maxWidth: ALERT_MAX_WIDTH }}>
                    {t('mediaServerExportLayoutPlaylistTvNamingNote')}
                </Alert>
            )}

            {exportMode === 'off' && (
                <Alert severity="info" sx={{ mt: 2, maxWidth: ALERT_MAX_WIDTH }}>
                    {t('mediaServerExportCleanupHint')}
                </Alert>
            )}

            {exportError && (
                <Alert severity="error" sx={{ mt: 2, maxWidth: ALERT_MAX_WIDTH }}>
                    {exportError}
                </Alert>
            )}

            {isExportRunning && exportJob && (
                <Box sx={{ mt: 2, maxWidth: 520 }}>
                    <Typography variant="body2" sx={{ mb: 0.75 }}>
                        {t(activeExportAction === 'cleanup'
                            ? 'mediaServerExportCleanupRunning'
                            : 'mediaServerExportRebuildRunning')} {exportJob.processed}/{exportJob.total}
                        {exportJob.phase && ` – ${t(`mediaServerExportPhase_${exportJob.phase}` as never)}`}
                        {exportJob.currentTitle && ` – ${exportJob.currentTitle}`}
                    </Typography>
                    <LinearProgress
                        variant="determinate"
                        value={exportJob.total > 0 ? (exportJob.processed / exportJob.total) * 100 : 0}
                    />
                </Box>
            )}

            {isExportComplete && exportJob && (
                <Alert severity="success" sx={{ mt: 2, maxWidth: ALERT_MAX_WIDTH }}>
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

                    {exportJob.counts && (
                        <Typography variant="body2" sx={{ mt: 1 }}>
                            {t('mediaServerExportMirrorSummary')
                                .replace('{shows}', String(exportJob.counts.shows))
                                .replace('{seasons}', String(exportJob.counts.seasons))
                                .replace('{episodes}', String(exportJob.counts.episodes))
                                .replace('{linked}', String(exportJob.counts.linkedMedia))
                                .replace('{copied}', String(exportJob.counts.copiedMedia))
                                .replace('{removed}', String(exportJob.counts.removedArtifacts))}
                        </Typography>
                    )}

                    {exportJob.counts && exportJob.counts.copiedMedia > 0 && (
                        <Typography variant="body2" sx={{ mt: 1 }}>
                            {t('mediaServerCopiedMediaWarning').replace(
                                '{count}',
                                String(exportJob.counts.copiedMedia)
                            )}
                        </Typography>
                    )}

                    {renderReasonList(failedItems, 'mediaServerExportFailedItems')}
                    {renderReasonList(skippedItems, 'mediaServerExportSkippedItems')}
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
                        onClick={() => { void openExportConfirm(); }}
                        disabled={isExportRunning}
                        sx={{ mt: 2 }}
                    >
                        {/* "Sidecars" describes the adjacent layout only; the
                            managed layout builds a whole mirror tree. */}
                        {t(exportAction === 'cleanup'
                            ? (isPlaylistTv
                                ? 'mediaServerExportCleanupManagedLibrary'
                                : 'mediaServerExportCleanup')
                            : (isPlaylistTv
                                ? 'mediaServerExportRebuildManagedLibrary'
                                : 'mediaServerExportRebuild'))}
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
                    ? (isPlaylistTv
                        ? 'mediaServerExportCleanupManagedLibraryConfirmTitle'
                        : 'mediaServerExportCleanupConfirmTitle')
                    : (isPlaylistTv
                        ? 'mediaServerExportRebuildManagedLibraryConfirmTitle'
                        : 'mediaServerExportRebuildConfirmTitle'))}</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {t(exportAction === 'cleanup'
                            ? (isPlaylistTv
                                ? 'mediaServerExportCleanupManagedLibraryConfirmBody'
                                : 'mediaServerExportCleanupConfirmBody')
                            : (isPlaylistTv
                                ? 'mediaServerExportRebuildManagedLibraryConfirmBody'
                                : 'mediaServerExportRebuildConfirmBody'))}
                    </DialogContentText>

                    {/* The concrete size of the run. Stated before confirmation
                        because the managed layout can add dozens of shows to a
                        media server in one click. */}
                    {isPlaylistTv && exportAction !== 'cleanup' && (
                        <Alert severity="info" sx={{ mt: 2 }}>
                            {scopeLoading
                                ? t('mediaServerExportScopeLoading')
                                : scope
                                    ? t('mediaServerExportScope')
                                        .replace('{videos}', String(scope.videoCount))
                                        .replace('{shows}', String(scope.showCount))
                                    : t('mediaServerExportScopeUnavailable')}
                        </Alert>
                    )}

                    {isPlaylistTv && (
                        <DialogContentText sx={{ mt: 2 }}>
                            {t(exportAction === 'cleanup'
                                ? 'mediaServerExportPlaylistTvCleanupConfirmBody'
                                : 'mediaServerExportPlaylistTvRebuildConfirmBody')}
                        </DialogContentText>
                    )}
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
                            ? (isPlaylistTv
                                ? 'mediaServerExportCleanupManagedLibrary'
                                : 'mediaServerExportCleanup')
                            : (isPlaylistTv
                                ? 'mediaServerExportRebuildManagedLibrary'
                                : 'mediaServerExportRebuild'))}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default MediaServerExportSettings;
