import { getApiErrorMessage } from '../../utils/errors';
import {
    Alert,
    Box,
    CircularProgress,
    FormControl,
    MenuItem,
    Select,
    Tab,
    Tabs,
    TextField,
    Typography,
} from '@mui/material';
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';
import { api } from '../../utils/apiClient';
import { createTranslateOrFallback } from '../../utils/translateOrFallback';
import { TranslationKey } from '../../utils/translations';
import FilenameBatchRenameSection from './FilenameBatchRenameSection';
import FilenameTemplateReference from './FilenameTemplateReference';
import MediaServerExportSettings from './MediaServerExportSettings';
import {
    FilenameTemplateCatalogResponse,
    FilenameTemplatePreviewResponse,
    PRESET_FALLBACK_OPTIONS,
    PREVIEW_SCENARIO_ORDER,
    PreviewResult,
    PreviewScenario,
    deriveFilenameEffectiveTemplate,
    deriveFilenamePresetId,
    getFilenameTemplateWarningMessage,
    getPresetLabelFallback,
    previewResultSignature,
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

            <MediaServerExportSettings
                settings={settings}
                onChange={onChange}
                recommendedTvLayout={recommendedTvLayout}
            />

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

            <FilenameTemplateReference
                informationNotes={informationNotes}
                referenceSections={referenceSections}
            />

            <FilenameBatchRenameSection
                settings={settings}
                namingMode={namingMode}
                effectiveTemplate={effectiveTemplate}
                currentTemplateInvalid={currentTemplateInvalid}
            />
        </Box>
    );
};

export default FilenameTemplateSettings;
