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
    Typography,
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';
import { api } from '../../utils/apiClient';

interface FilenameTemplateSettingsProps {
    settings: Settings;
    onChange: (field: keyof Settings, value: any) => void;
    savedSettings: Settings;
}

interface PreviewResult {
    videoPath?: string;
    thumbnailPath?: string;
    subtitlePath?: string;
    warnings?: Array<{ code: string; message: string }>;
    errors?: string[];
    valid?: boolean;
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

const PRESET_OPTIONS = [
    { value: 'legacy', labelKey: 'filenamePresetLegacy' },
    { value: 'channel_year_date_index', labelKey: 'filenamePresetChannelYearDateIndex' },
    { value: 'playlist_static_index', labelKey: 'filenamePresetPlaylistStaticIndex' },
    { value: 'playlist_static_date', labelKey: 'filenamePresetPlaylistStaticDate' },
    { value: 'custom', labelKey: 'filenamePresetCustom' },
] as const;

const FilenameTemplateSettings: React.FC<FilenameTemplateSettingsProps> = ({
    settings,
    onChange,
    savedSettings,
}) => {
    const { t } = useLanguage();
    const queryClient = useQueryClient();

    const presetId = settings.downloadFilenamePresetId || 'legacy';
    const customTemplate = settings.downloadFilenameTemplate || '';

    const [preview, setPreview] = useState<PreviewResult | null>(null);
    const [isValidating, setIsValidating] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [renameJob, setRenameJob] = useState<RenameJob | null>(null);
    const [renameError, setRenameError] = useState<string | null>(null);
    const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Show batch rename button only when saved settings are non-legacy
    const savedPresetId = savedSettings.downloadFilenamePresetId || 'legacy';
    const showBatchRenameButton = savedPresetId !== 'legacy';

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
                '/settings/filename-template/rename-all'
            );
            const jobData = res.data;
            setRenameJob({
                id: jobData.jobId,
                status: jobData.status as any,
                lockedAt: Date.now(),
                template: savedSettings.downloadFilenameTemplate || '',
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

    const isRenameRunning = renameJob?.status === 'running';
    const isRenameComplete = renameJob?.status === 'completed';

    return (
        <Box>
            <Typography variant="h6" gutterBottom>{t('filenameTemplate')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('filenameTemplateDescription')}
            </Typography>

            {/* Preset selector */}
            <FormControl fullWidth sx={{ maxWidth: 500, mb: 2 }}>
                <Typography variant="body2" sx={{ mb: 0.5 }}>{t('filenamePresetLabel')}</Typography>
                <Select
                    value={presetId}
                    onChange={(e) => handlePresetChange(e.target.value)}
                    size="small"
                >
                    {PRESET_OPTIONS.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                            {t(opt.labelKey)}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            {/* Custom template input */}
            {presetId === 'custom' && (
                <Box sx={{ mb: 2, maxWidth: 600 }}>
                    <Typography variant="body2" sx={{ mb: 0.5 }}>{t('filenameCustomTemplateLabel')}</Typography>
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

            {/* Preview panel */}
            {effectiveTemplate && (
                <Box sx={{ mb: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, maxWidth: 600 }}>
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
                            {preview.warnings.map((w) => w.message).join('\n')}
                        </Alert>
                    )}
                </Box>
            )}

            {/* Batch rename section */}
            {showBatchRenameButton && (
                <Box sx={{ mt: 3 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        {t('filenameBatchRenameDescription')}
                    </Typography>

                    {renameError && (
                        <Alert severity="error" sx={{ mb: 1 }}>
                            {renameError}
                        </Alert>
                    )}

                    {isRenameRunning && renameJob && (
                        <Box sx={{ mb: 2 }}>
                            <Typography variant="body2" sx={{ mb: 0.5 }}>
                                {t('filenameBatchRenameRunning')} {renameJob.processed}/{renameJob.total}
                                {renameJob.currentTitle && ` – ${renameJob.currentTitle}`}
                            </Typography>
                            <LinearProgress
                                variant="determinate"
                                value={renameJob.total > 0 ? (renameJob.processed / renameJob.total) * 100 : 0}
                                sx={{ maxWidth: 400 }}
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

                    <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => setConfirmOpen(true)}
                        disabled={isRenameRunning}
                    >
                        {t('filenameBatchRenameButton')}
                    </Button>
                </Box>
            )}

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
        </Box>
    );
};

export default FilenameTemplateSettings;
