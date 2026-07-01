import { getApiErrorMessage } from '../../utils/errors';
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
    Tab,
    Tabs,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import CollapsibleSection from '../CollapsibleSection';
import { useLanguage } from '../../contexts/LanguageContext';
import { useSettingsJobPolling } from '../../hooks/useSettingsJobPolling';
import { Settings } from '../../types';
import { api } from '../../utils/apiClient';
import { createTranslateOrFallback } from '../../utils/translateOrFallback';
import { TranslationKey } from '../../utils/translations';
import {
    FilenameTemplateCatalogResponse,
    FilenameTemplatePreviewResponse,
    MEDIA_SERVER_EXPORT_OPTIONS,
    MediaServerExportJob,
    PRESET_FALLBACK_OPTIONS,
    PREVIEW_SCENARIO_ORDER,
    PreviewResult,
    PreviewScenario,
    RenameJob,
    deriveFilenameEffectiveTemplate,
    deriveFilenamePresetId,
    getFilenameTemplateWarningMessage,
    getMediaServerExportErrorMessage,
    getPresetLabelFallback,
    mediaServerExportJobUrl,
    previewResultSignature,
    renameJobUrl,
    resolveFilenamePresetSelectValue,
} from './filenameTemplateShared';

interface FilenameTemplateSettingsProps {
    settings: Settings;
    onChange: (field: keyof Settings, value: any) => void;
}

const FilenameTemplateSettings: React.FC<FilenameTemplateSettingsProps> = ({
    settings,
    onChange,
}) => {
    const { t } = useLanguage();
    const translateOrFallback = createTranslateOrFallback(t);
    const queryClient = useQueryClient();
    const [previewScenario, setPreviewScenario] = useState<PreviewScenario>('channel');
    const {
        data: catalog,
        isLoading: isCatalogLoading,
    } = useQuery<FilenameTemplateCatalogResponse>({
        queryKey: ['filename-template-catalog'],
        queryFn: async () => {
            const response = await api.get<FilenameTemplateCatalogResponse>(
                '/settings/filename-template/catalog'
            );
            return response.data;
        },
        staleTime: 5 * 60 * 1000,
    });
    const presetDefinitions = catalog?.presets || [];
    const deprecatedPresetAliases = catalog?.deprecatedPresetAliases || [];
    const informationNotes = catalog?.informationNotes || [];
    const referenceSections = catalog?.referenceSections || [];

    const derivedPresetId = deriveFilenamePresetId(
        settings,
        presetDefinitions,
        deprecatedPresetAliases
    );
    const customTemplate = settings.downloadFilenameTemplate || '';
    const namingMode = settings.downloadFilenameMode || (derivedPresetId === 'legacy' ? 'legacy' : 'template');
    const [forceCustomSelection, setForceCustomSelection] = useState(false);
    const presetId = resolveFilenamePresetSelectValue(
        derivedPresetId,
        namingMode,
        forceCustomSelection
    );

    const [preview, setPreview] = useState<FilenameTemplatePreviewResponse | null>(null);
    const [isValidating, setIsValidating] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
    const [renameJob, setRenameJob] = useState<RenameJob | null>(null);
    const [renameError, setRenameError] = useState<string | null>(null);
    const [exportJob, setExportJob] = useState<MediaServerExportJob | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);

    // Batch rename uses the current form state shown above, not only the last
    // saved defaults used for future downloads.
    const currentTemplateInvalid =
        namingMode === 'template' && !!preview?.errors?.length;
    const recommendedTvLayout =
        Object.values(preview?.previews || {}).some(
            (scenarioPreview) =>
                !!scenarioPreview?.videoPath &&
                scenarioPreview.videoPath.split('/').filter(Boolean).length >= 3
        );

    // Compute effective template for preview
    const effectiveTemplate = deriveFilenameEffectiveTemplate(settings, presetDefinitions);

    useEffect(() => {
        if (settings.downloadFilenameMode !== 'template') {
            setForceCustomSelection(false);
            return;
        }

        if (derivedPresetId === 'custom') {
            setForceCustomSelection(false);
        }
    }, [derivedPresetId, settings.downloadFilenameMode]);

    // Debounced preview fetch
    useEffect(() => {
        const template = effectiveTemplate;
        if (namingMode === 'template' && !template) {
            setPreview(null);
            return;
        }
        setIsValidating(true);
        const timer = setTimeout(async () => {
            try {
                const res = await api.post<FilenameTemplatePreviewResponse>(
                    '/settings/filename-template/preview',
                    {
                        mode: namingMode,
                        template: namingMode === 'template' ? template : undefined,
                    }
                );
                setPreview(res.data);
            } catch (e: unknown) {
                setPreview({
                    valid: false,
                    errors: [getApiErrorMessage(e) || String(e)],
                    resolved: {
                        mode: namingMode,
                        matchedPresetId: presetId,
                        template: namingMode === 'template' ? template : null,
                    },
                    previews: null,
                });
            } finally {
                setIsValidating(false);
            }
        }, 600);
        return () => clearTimeout(timer);
    }, [effectiveTemplate, namingMode, presetId]);

    // On rename completion the library's paths changed on disk: refresh every
    // query that renders them.
    const handleRenameCompleted = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['videos'] });
        queryClient.invalidateQueries({ queryKey: ['collections'] });
        queryClient.invalidateQueries({ queryKey: ['downloadHistory'] });
    }, [queryClient]);

    useSettingsJobPolling(renameJob, renameJobUrl, setRenameJob, handleRenameCompleted);
    useSettingsJobPolling(exportJob, mediaServerExportJobUrl, setExportJob);

    const handlePresetChange = (value: string) => {
        if (value === 'legacy') {
            setForceCustomSelection(false);
            onChange('downloadFilenameMode', 'legacy');
            return;
        }

        onChange('downloadFilenameMode', 'template');

        if (value === 'custom') {
            setForceCustomSelection(true);
            if (!customTemplate) {
                onChange('downloadFilenameTemplate', effectiveTemplate);
            }
            return;
        }

        setForceCustomSelection(false);
        onChange(
            'downloadFilenameTemplate',
            presetDefinitions.find((preset) => preset.id === value)?.template || ''
        );
    };

    const handleCustomTemplateChange = (value: string) => {
        setForceCustomSelection(true);
        onChange('downloadFilenameMode', 'template');
        onChange('downloadFilenameTemplate', value);
    };

    const handleStartRename = async () => {
        setConfirmOpen(false);
        setRenameError(null);
        try {
            const res = await api.post<{ jobId: string; status: string; total: number }>(
                '/settings/filename-template/rename-all',
                {
                    downloadFilenameMode: namingMode,
                    downloadFilenameTemplate:
                        namingMode === 'template' ? effectiveTemplate : undefined,
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
        } catch (e: unknown) {
            setRenameError(
                getApiErrorMessage(e) || t('filenameBatchRenameError')
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
        } catch (e: unknown) {
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
    const presetOptions = presetDefinitions.length > 0
        ? [
            ...presetDefinitions.map((preset) => ({
                value: preset.id,
                labelKey: preset.labelKey,
                fallbackLabel: getPresetLabelFallback(preset.labelKey),
            })),
            {
                value: 'custom',
                labelKey: 'filenamePresetCustom' as TranslationKey,
                fallbackLabel: getPresetLabelFallback('filenamePresetCustom'),
            },
        ]
        : PRESET_FALLBACK_OPTIONS;
    // Collapse scenarios that render identically so we don't show three tabs
    // with the same content. A tab is shown per distinct result; its label lists
    // every scenario it covers (e.g. "Channel / Single Video").
    const previewGroups = useMemo(() => {
        if (!preview?.previews) return [];
        const scenarioLabels: Record<PreviewScenario, string> = {
            channel: translateOrFallback('filenamePreviewScenarioChannel', 'Channel'),
            playlist: translateOrFallback('filenamePreviewScenarioPlaylist', 'Playlist'),
            single: translateOrFallback('filenamePreviewScenarioSingle', 'Single Video'),
        };
        const groups: Array<{
            value: PreviewScenario;
            scenarios: PreviewScenario[];
            label: string;
            result: PreviewResult;
        }> = [];
        for (const scenario of PREVIEW_SCENARIO_ORDER) {
            const result = preview.previews[scenario];
            const signature = previewResultSignature(result);
            const existing = groups.find(
                (group) => previewResultSignature(group.result) === signature
            );
            if (existing) {
                existing.scenarios.push(scenario);
            } else {
                groups.push({ value: scenario, scenarios: [scenario], label: '', result });
            }
        }
        return groups.map((group) => ({
            ...group,
            label: group.scenarios.map((scenario) => scenarioLabels[scenario]).join(' / '),
        }));
    }, [preview, translateOrFallback]);

    const activeGroup =
        previewGroups.find((group) => group.scenarios.includes(previewScenario)) ||
        previewGroups[0];
    const activePreview = activeGroup?.result;

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
            </Box>

            <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>
                    {t('filenamePresetLabel')}
                </Typography>

                <FormControl fullWidth sx={{ maxWidth: selectMaxWidth }}>
                    <Select
                        value={presetId}
                        onChange={(e) => handlePresetChange(e.target.value)}
                        disabled={isCatalogLoading}
                    >
                        {presetOptions.map((opt) => (
                            <MenuItem key={opt.value} value={opt.value}>
                                {translateOrFallback(opt.labelKey, opt.fallbackLabel)}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>

                {presetId === 'custom' && (
                    <Box sx={{ mt: 2, maxWidth: 920 }}>
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
                            error={currentTemplateInvalid}
                        />
                        {currentTemplateInvalid && preview?.errors && preview.errors.length > 0 && (
                            <Alert severity="error" sx={{ mt: 1 }}>
                                {preview.errors.join('\n')}
                            </Alert>
                        )}
                    </Box>
                )}

                {(effectiveTemplate || namingMode === 'legacy') && (
                    <Box sx={{ mt: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1.5, maxWidth: 920 }}>
                        <Typography variant="body2" fontWeight="bold" gutterBottom>
                            {t('filenamePreviewTitle')}
                            {isValidating && (
                                <CircularProgress size={12} sx={{ ml: 1, verticalAlign: 'middle' }} />
                            )}
                        </Typography>
                        {preview?.errors && preview.errors.length > 0 && (
                            <Alert severity="error" sx={{ mt: 1, mb: 1 }}>
                                {preview.errors.join('\n')}
                            </Alert>
                        )}
                        {preview?.previews && (
                            <>
                                {previewGroups.length > 1 && (
                                    <Tabs
                                        value={activeGroup?.value ?? previewScenario}
                                        onChange={(_event, value: PreviewScenario) => setPreviewScenario(value)}
                                        sx={{ minHeight: 36, mb: 1 }}
                                    >
                                        {previewGroups.map((group) => (
                                            <Tab
                                                key={group.value}
                                                value={group.value}
                                                label={group.label}
                                                sx={{ minHeight: 36 }}
                                            />
                                        ))}
                                    </Tabs>
                                )}
                                {activePreview?.videoPath && (
                                    <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                        {t('filenamePreviewVideo')}: {activePreview.videoPath}
                                    </Typography>
                                )}
                                {activePreview?.thumbnailPath && (
                                    <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                        {t('filenamePreviewThumbnail')}: {activePreview.thumbnailPath}
                                    </Typography>
                                )}
                                {activePreview?.subtitlePath && (
                                    <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                                        {t('filenamePreviewSubtitle')}: {activePreview.subtitlePath}
                                    </Typography>
                                )}
                            </>
                        )}
                        {activePreview?.warnings && activePreview.warnings.length > 0 && (
                            <Alert severity="warning" sx={{ mt: 1 }}>
                                {activePreview.warnings
                                    .map((warning) => getFilenameTemplateWarningMessage(warning, t))
                                    .join('\n')}
                            </Alert>
                        )}
                    </Box>
                )}
            </Box>

            <Box sx={{ mt: 3, maxWidth: 920 }}>
                <CollapsibleSection title={t('filenameRefInformationTitle')} defaultExpanded={false}>
                    <Box sx={{ mb: 2 }}>
                        {informationNotes.map((note) => (
                            <Typography
                                key={note.id}
                                variant="body2"
                                color="text.secondary"
                                sx={{ mb: 0.75 }}
                            >
                                {t(note.textKey)}
                            </Typography>
                        ))}
                    </Box>

                    {referenceSections.map((section) => (
                        <Box key={section.id} sx={{ mb: 2.5 }}>
                            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                                {t(section.titleKey)}
                            </Typography>
                            {section.descriptionKey && (
                                <Typography
                                    variant="body2"
                                    color="text.secondary"
                                    sx={{ mb: 1.25 }}
                                >
                                    {t(section.descriptionKey)}
                                </Typography>
                            )}
                            <Box
                                sx={{
                                    display: 'grid',
                                    gap: 1,
                                }}
                            >
                                {section.items.map((item) => (
                                    <Box
                                        key={item.key}
                                        sx={{
                                            display: 'grid',
                                            gridTemplateColumns: {
                                                xs: '1fr',
                                                md: '260px minmax(0, 1fr) 180px',
                                            },
                                            gap: 1,
                                            p: 1.25,
                                            borderRadius: 1.5,
                                            bgcolor: 'action.hover',
                                        }}
                                    >
                                        <Typography
                                            variant="body2"
                                            sx={{
                                                fontFamily: 'monospace',
                                                wordBreak: 'break-all',
                                            }}
                                        >
                                            {item.token}
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            {t(item.descriptionKey)}
                                        </Typography>
                                        <Typography
                                            variant="body2"
                                            color="text.secondary"
                                            sx={{
                                                fontFamily: item.example ? 'monospace' : undefined,
                                                wordBreak: 'break-all',
                                            }}
                                        >
                                            {item.example || ''}
                                        </Typography>
                                    </Box>
                                ))}
                            </Box>
                        </Box>
                    ))}
                </CollapsibleSection>
            </Box>

            <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>
                    {t('filenameBatchRenameButton')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('filenameBatchRenameDescription')}
                </Typography>

                {renameError && (
                    <Alert severity="error" sx={{ mb: 1, maxWidth: 920 }}>
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
                    <Alert severity="success" sx={{ mb: 2, maxWidth: 920 }}>
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
