import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControl,
    LinearProgress,
    MenuItem,
    Select,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';
import { api } from '../../utils/apiClient';
import { TranslationKey } from '../../utils/translations';

interface FilenameTemplateSettingsProps {
    settings: Settings;
    onChange: (field: keyof Settings, value: any) => void;
}

interface PreviewResult {
    videoPath?: string;
    thumbnailPath?: string;
    subtitlePath?: string;
    warnings?: Array<{ code: string; message: string }>;
    errors?: string[];
    valid?: boolean;
}

export function getFilenameTemplateWarningMessage(
    warning: { code: string; message: string },
    t: (key: TranslationKey) => string
): string {
    switch (warning.code) {
        case 'media_playlist_index_unavailable':
            return t('filenameWarningMediaPlaylistIndexUnavailable');
        case 'source_collection_metadata_may_be_empty':
            return t('filenameWarningSourceCollectionMetadataMayBeEmpty');
        default:
            return warning.message;
    }
}

function getMediaServerExportErrorMessage(
    error: any,
    mode: 'off' | 'nfo' | 'nfo_and_source_json',
    t: (key: TranslationKey) => string
): string {
    const code = error?.response?.data?.code;
    const rawMessage = String(error?.response?.data?.error || '');

    if (code === 'active_downloads') {
        return t('mediaServerExportActiveDownloadsError');
    }
    if (code === 'queued_downloads') {
        return t('mediaServerExportQueuedDownloadsError');
    }
    if (code === 'unsupported_export_mode') {
        return t(mode === 'off'
            ? 'mediaServerExportCleanupUnsupportedModeError'
            : 'mediaServerExportUnsupportedModeError');
    }
    if (rawMessage.includes('requires NFO export mode')) {
        return t(mode === 'off'
            ? 'mediaServerExportCleanupUnsupportedModeError'
            : 'mediaServerExportUnsupportedModeError');
    }

    return t(mode === 'off'
        ? 'mediaServerExportCleanupError'
        : 'mediaServerExportRebuildError');
}

interface RenameJob {
    id: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    lockedAt: number;
    template: string;
    total: number;
    processed: number;
    succeeded: number;
    skipped: number;
    failed: number;
    currentTitle?: string;
    items: Array<{
        videoId: string;
        title: string;
        status: string;
        skipReason?: string;
        error?: string;
        oldVideoPath?: string;
        newVideoPath?: string;
    }>;
}

interface MediaServerExportJob {
    id: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    lockedAt: number;
    mode: 'off' | 'nfo' | 'nfo_and_source_json';
    action: 'rebuild' | 'cleanup';
    total: number;
    processed: number;
    succeeded: number;
    skipped: number;
    failed: number;
    currentTitle?: string;
    items: Array<{
        videoId: string;
        title: string;
        status: string;
        skipReason?: string;
        error?: string;
    }>;
}

const PRESET_OPTIONS = [
    { value: 'legacy', labelKey: 'filenamePresetLegacy' },
    { value: 'channel_year_date_index', labelKey: 'filenamePresetChannelYearDateIndex' },
    { value: 'playlist_static_index', labelKey: 'filenamePresetPlaylistStaticIndex' },
    { value: 'playlist_static_date', labelKey: 'filenamePresetPlaylistStaticDate' },
    { value: 'custom', labelKey: 'filenamePresetCustom' },
] as const;

const MEDIA_SERVER_EXPORT_OPTIONS = [
    { value: 'off', labelKey: 'mediaServerExportModeOff' },
    { value: 'nfo', labelKey: 'mediaServerExportModeNfo' },
    { value: 'nfo_and_source_json', labelKey: 'mediaServerExportModeNfoAndSourceJson' },
] as const;

const FilenameTemplateSettings: React.FC<FilenameTemplateSettingsProps> = ({
    settings,
    onChange,
}) => {
    const { t } = useLanguage();
    const queryClient = useQueryClient();

    const presetId = settings.downloadFilenamePresetId || 'legacy';
    const customTemplate = settings.downloadFilenameTemplate || '';

    const [preview, setPreview] = useState<PreviewResult | null>(null);
    const [isValidating, setIsValidating] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
    const [renameJob, setRenameJob] = useState<RenameJob | null>(null);
    const [renameError, setRenameError] = useState<string | null>(null);
    const [exportJob, setExportJob] = useState<MediaServerExportJob | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);
    const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const exportPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Batch rename uses the current form state shown above, not only the last
    // saved defaults used for future downloads.
    const currentTemplateInvalid =
        presetId === 'custom' && !!preview?.errors?.length;
    const recommendedTvLayout =
        !!preview?.videoPath && preview.videoPath.split('/').filter(Boolean).length >= 3;

    // Compute effective template for preview
    const effectiveTemplate = presetId === 'custom'
        ? customTemplate
        : PRESET_OPTIONS.find(p => p.value === presetId)
            ? getPresetTemplate(presetId)
            : '';

    function getPresetTemplate(id: string): string {
        const map: Record<string, string> = {
            legacy: '{{ title }}-{{ uploader }}-{{ upload_year }}.{{ ext }}',
            channel_year_date_index:
                '{{ source_collection_name }}/{{ season_by_year__episode_by_date_and_index }} - {{ title }}.{{ ext }}',
            playlist_static_index:
                '{{ source_collection_name }}/{{ static_season__episode_by_index }} - {{ title }}.{{ ext }}',
            playlist_static_date:
                '{{ source_collection_name }}/{{ static_season__episode_by_date }} - {{ title }}.{{ ext }}',
        };
        return map[id] || '';
    }

    // Debounced preview fetch
    useEffect(() => {
        const template = effectiveTemplate;
        if (!template) {
            setPreview(null);
            return;
        }
        setIsValidating(true);
        const timer = setTimeout(async () => {
            try {
                const res = await api.post<PreviewResult>(
                    '/settings/filename-template/preview',
                    { template }
                );
                setPreview(res.data);
            } catch (e: any) {
                setPreview({
                    errors: [e?.response?.data?.error || String(e)],
                    valid: false,
                });
            } finally {
                setIsValidating(false);
            }
        }, 600);
        return () => clearTimeout(timer);
    }, [effectiveTemplate]);

    // Poll rename job
    useEffect(() => {
        if (!renameJob || renameJob.status !== 'running') {
            if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
            return;
        }
        const poll = async () => {
            try {
                const res = await api.get<RenameJob>(
                    `/settings/filename-template/rename-jobs/${renameJob.id}`
                );
                setRenameJob(res.data);
                if (res.data.status === 'completed') {
                    queryClient.invalidateQueries({ queryKey: ['videos'] });
                    queryClient.invalidateQueries({ queryKey: ['collections'] });
                    queryClient.invalidateQueries({ queryKey: ['downloadHistory'] });
                }
                if (res.data.status === 'running') {
                    const delay = res.data.processed < (res.data.total * 0.25) ? 1000 : 3000;
                    pollTimerRef.current = setTimeout(poll, delay);
                }
            } catch {
                // silently retry
                pollTimerRef.current = setTimeout(poll, 3000);
            }
        };
        pollTimerRef.current = setTimeout(poll, 1000);
        return () => {
            if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        };
    }, [renameJob?.id, renameJob?.status]);

    // Poll media server export rebuild job
    useEffect(() => {
        if (!exportJob || exportJob.status !== 'running') {
            if (exportPollTimerRef.current) clearTimeout(exportPollTimerRef.current);
            return;
        }
        const poll = async () => {
            try {
                const res = await api.get<MediaServerExportJob>(
                    `/settings/media-server-export/jobs/${exportJob.id}`
                );
                setExportJob(res.data);
                if (res.data.status === 'running') {
                    const delay = res.data.processed < (res.data.total * 0.25) ? 1000 : 3000;
                    exportPollTimerRef.current = setTimeout(poll, delay);
                }
            } catch {
                exportPollTimerRef.current = setTimeout(poll, 3000);
            }
        };
        exportPollTimerRef.current = setTimeout(poll, 1000);
        return () => {
            if (exportPollTimerRef.current) clearTimeout(exportPollTimerRef.current);
        };
    }, [exportJob?.id, exportJob?.status]);

    const handlePresetChange = (value: string) => {
        if (value !== 'custom' && value !== 'legacy') {
            // Switch to a built-in preset
            onChange('downloadFilenamePresetId', value as any);
        } else {
            onChange('downloadFilenamePresetId', value as any);
        }
    };

    const handleCustomTemplateChange = (value: string) => {
        // When user edits template text, switch to custom preset
        onChange('downloadFilenameTemplate', value);
        if (presetId !== 'custom') {
            onChange('downloadFilenamePresetId', 'custom');
        }
    };

    const handleStartRename = async () => {
        setConfirmOpen(false);
        setRenameError(null);
        try {
            const res = await api.post<{ jobId: string; status: string; total: number }>(
                '/settings/filename-template/rename-all',
                {
                    downloadFilenamePresetId: presetId,
                    downloadFilenameTemplate:
                        presetId === 'custom' ? customTemplate : undefined,
                    moveThumbnailsToVideoFolder:
                        settings.moveThumbnailsToVideoFolder || false,
                    moveSubtitlesToVideoFolder:
                        settings.moveSubtitlesToVideoFolder || false,
                }
            );
            const jobData = res.data;
            setRenameJob({
                id: jobData.jobId,
                status: jobData.status as any,
                lockedAt: Date.now(),
                template: effectiveTemplate,
                total: jobData.total,
                processed: 0,
                succeeded: 0,
                skipped: 0,
                failed: 0,
                items: [],
            });
        } catch (e: any) {
            setRenameError(
                e?.response?.data?.error || t('filenameBatchRenameError')
            );
        }
    };

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
        } catch (e: any) {
            setExportError(getMediaServerExportErrorMessage(e, mode, t));
        }
    };

    const isRenameRunning = renameJob?.status === 'running';
    const isRenameComplete = renameJob?.status === 'completed';
    const isExportRunning = exportJob?.status === 'running';
    const isExportComplete = exportJob?.status === 'completed';
    const exportMode = settings.mediaServerExportMode || 'off';
    const exportAction = exportMode === 'off' ? 'cleanup' : 'rebuild';
    const activeExportAction = exportJob?.action || exportAction;
    const selectMaxWidth = 400;

    return (
        <Box sx={{ maxWidth: 960 }}>
            <Typography variant="h6" gutterBottom>{t('filenameTemplate')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('filenameTemplateDescription')}
            </Typography>

            <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>
                    {t('mediaServerExportMode')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {exportMode === 'off'
                        ? t('mediaServerExportModeOffDescription')
                        : t('mediaServerExportModeDescription')}
                </Typography>

                <FormControl fullWidth sx={{ maxWidth: selectMaxWidth }}>
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
                    <Alert severity="warning" sx={{ mt: 2, maxWidth: 860 }}>
                        {t('mediaServerExportRecommendedLayoutWarning')}
                    </Alert>
                )}

                {exportMode === 'off' && (
                    <Alert severity="info" sx={{ mt: 2, maxWidth: 860 }}>
                        {t('mediaServerExportCleanupHint')}
                    </Alert>
                )}

                {exportError && (
                    <Alert severity="error" sx={{ mt: 2, maxWidth: 860 }}>
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
                    <Alert severity="success" sx={{ mt: 2, maxWidth: 860 }}>
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
            </Box>

            <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>
                    {t('filenamePresetLabel')}
                </Typography>

                <FormControl fullWidth sx={{ maxWidth: selectMaxWidth }}>
                    <Select
                        value={presetId}
                        onChange={(e) => handlePresetChange(e.target.value)}
                    >
                        {PRESET_OPTIONS.map((opt) => (
                            <MenuItem key={opt.value} value={opt.value}>
                                {t(opt.labelKey)}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>

                {presetId === 'custom' && (
                    <Box sx={{ mt: 2, maxWidth: 760 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
                            {t('filenameCustomTemplateLabel')}
                        </Typography>
                        <TextField
                            fullWidth
                            multiline
                            rows={2}
                            size="small"
                            value={customTemplate}
                            onChange={(e) => handleCustomTemplateChange(e.target.value)}
                            placeholder={t('filenameCustomTemplatePlaceholder')}
                            error={!!preview?.errors?.length}
                        />
                        {preview?.errors && preview.errors.length > 0 && (
                            <Alert severity="error" sx={{ mt: 1 }}>
                                {preview.errors.join('\n')}
                            </Alert>
                        )}
                    </Box>
                )}

                {effectiveTemplate && (
                    <Box sx={{ mt: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1.5, maxWidth: 760 }}>
                        <Typography variant="body2" fontWeight="bold" gutterBottom>
                            {t('filenamePreviewTitle')}
                            {isValidating && (
                                <CircularProgress size={12} sx={{ ml: 1, verticalAlign: 'middle' }} />
                            )}
                        </Typography>
                        {preview?.videoPath && (
                            <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                {t('filenamePreviewVideo')}: {preview.videoPath}
                            </Typography>
                        )}
                        {preview?.thumbnailPath && (
                            <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                {t('filenamePreviewThumbnail')}: {preview.thumbnailPath}
                            </Typography>
                        )}
                        {preview?.subtitlePath && (
                            <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                {t('filenamePreviewSubtitle')}: {preview.subtitlePath}
                            </Typography>
                        )}
                        {preview?.warnings && preview.warnings.length > 0 && (
                            <Alert severity="warning" sx={{ mt: 1 }}>
                                {preview.warnings
                                    .map((warning) => getFilenameTemplateWarningMessage(warning, t))
                                    .join('\n')}
                            </Alert>
                        )}
                    </Box>
                )}
            </Box>

            <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>
                    {t('filenameBatchRenameButton')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('filenameBatchRenameDescription')}
                </Typography>

                {renameError && (
                    <Alert severity="error" sx={{ mb: 1 }}>
                        {renameError}
                    </Alert>
                )}

                {isRenameRunning && renameJob && (
                    <Box sx={{ mb: 2, maxWidth: 520 }}>
                        <Typography variant="body2" sx={{ mb: 0.5 }}>
                            {t('filenameBatchRenameRunning')} {renameJob.processed}/{renameJob.total}
                            {renameJob.currentTitle && ` – ${renameJob.currentTitle}`}
                        </Typography>
                        <LinearProgress
                            variant="determinate"
                            value={renameJob.total > 0 ? (renameJob.processed / renameJob.total) * 100 : 0}
                        />
                        {renameJob.lockedAt && (
                            <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.5 }}>
                                {t('filenameBatchRenamePaused')}
                            </Typography>
                        )}
                    </Box>
                )}

                {isRenameComplete && renameJob && (
                    <Alert severity="success" sx={{ mb: 2 }}>
                        {t('filenameBatchRenameComplete')} –{' '}
                        {t('filenameBatchRenameSummary')
                            .replace('{succeeded}', String(renameJob.succeeded))
                            .replace('{skipped}', String(renameJob.skipped))
                            .replace('{failed}', String(renameJob.failed))}
                    </Alert>
                )}

                <Tooltip
                    title={
                        currentTemplateInvalid
                            ? t('filenameBatchRenameDisabledInvalidTemplate')
                            : isRenameRunning
                                ? t('filenameBatchRenameDisabledRunning')
                                : ''
                    }
                    disableHoverListener={!currentTemplateInvalid && !isRenameRunning}
                >
                    <span>
                        <Button
                            variant="outlined"
                            color="warning"
                            onClick={() => setConfirmOpen(true)}
                            disabled={isRenameRunning || currentTemplateInvalid}
                        >
                            {t('filenameBatchRenameButton')}
                        </Button>
                    </span>
                </Tooltip>
            </Box>

            {/* Confirmation dialog */}
            <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
                <DialogTitle>{t('filenameBatchRenameConfirmTitle')}</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {t('filenameBatchRenameConfirmBody')}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmOpen(false)}>{t('cancel')}</Button>
                    <Button onClick={handleStartRename} color="warning" variant="contained">
                        {t('filenameBatchRenameConfirm')}
                    </Button>
                </DialogActions>
            </Dialog>

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

export default FilenameTemplateSettings;
