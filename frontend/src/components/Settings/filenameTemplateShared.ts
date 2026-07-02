// Types, pure helpers, and static catalogs for the filename-template settings
// UI. Kept outside FilenameTemplateSettings.tsx so the component file only
// exports a component (react-refresh) and the helpers stay unit-testable.
import { Settings } from '../../types';
import { TranslationKey } from '../../utils/translations';

export type PreviewScenario = 'channel' | 'playlist' | 'single';

export const PREVIEW_SCENARIO_ORDER: PreviewScenario[] = ['channel', 'playlist', 'single'];

export interface PreviewResult {
    videoPath?: string;
    thumbnailPath?: string;
    subtitlePath?: string;
    warnings?: Array<{ code: string; message: string }>;
}

// Two scenarios are equivalent when they render the same paths and warnings.
// Used to collapse identical preview tabs (e.g. templates that don't reference
// any source-type-specific token produce the same result for all scenarios).
export function previewResultSignature(result: PreviewResult | undefined): string {
    return JSON.stringify({
        v: result?.videoPath || '',
        t: result?.thumbnailPath || '',
        s: result?.subtitlePath || '',
        w: (result?.warnings || []).map((warning) => warning.code),
    });
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

export function getMediaServerExportErrorMessage(
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

export interface FilenameTemplatePresetCatalogItem {
    id: string;
    kind: 'legacy' | 'template';
    labelKey: TranslationKey;
    descriptionKey: string;
    template: string;
    examplePath: string;
    recommendedSourceTypes: PreviewScenario[];
}

export interface DeprecatedPresetAlias {
    id: string;
    labelKey: TranslationKey;
    mapsToCurrentPresetId?: string;
}

export interface FilenameTemplateReferenceItem {
    key: string;
    token: string;
    descriptionKey: TranslationKey;
    example?: string;
    kind: 'liquid' | 'pattern';
}

export interface FilenameTemplateReferenceSection {
    id: string;
    titleKey: TranslationKey;
    descriptionKey?: TranslationKey;
    items: FilenameTemplateReferenceItem[];
}

export interface FilenameTemplateInformationNote {
    id: string;
    textKey: TranslationKey;
}

export interface FilenameTemplateCatalogResponse {
    presets: FilenameTemplatePresetCatalogItem[];
    deprecatedPresetAliases: DeprecatedPresetAlias[];
    informationNotes: FilenameTemplateInformationNote[];
    referenceSections: FilenameTemplateReferenceSection[];
}

export interface FilenameTemplatePreviewResponse {
    valid: boolean;
    errors: string[];
    resolved: {
        mode: 'legacy' | 'template';
        matchedPresetId: string;
        template: string | null;
    };
    previews: Record<PreviewScenario, PreviewResult> | null;
}

export interface RenameJob {
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

export interface MediaServerExportJob {
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

// Stable URL builders for the job-polling hook (module scope = stable identity).
export function renameJobUrl(jobId: string): string {
    return `/settings/filename-template/rename-jobs/${jobId}`;
}

export function mediaServerExportJobUrl(jobId: string): string {
    return `/settings/media-server-export/jobs/${jobId}`;
}

export const PRESET_FALLBACK_OPTIONS = [
    { value: 'legacy', labelKey: 'filenamePresetLegacy', fallbackLabel: 'Current compatible mode (Title-Author-Year)' },
    { value: 'media_center_date_index', labelKey: 'filenamePresetMediaCenterDateIndex', fallbackLabel: 'Media center - Season/Episode by date and index' },
    { value: 'playlist_static_index', labelKey: 'filenamePresetPlaylistStaticIndex', fallbackLabel: 'Playlist - Season 1 / Episode by index' },
    { value: 'playlist_static_date', labelKey: 'filenamePresetPlaylistStaticDate', fallbackLabel: 'Playlist - Season 1 / Episode by date' },
    { value: 'source_date_flat', labelKey: 'filenamePresetSourceDateFlat', fallbackLabel: 'Source - Date then title' },
    { value: 'custom', labelKey: 'filenamePresetCustom', fallbackLabel: 'Custom template' },
] as const;

export const LEGACY_TEMPLATE = '{{ title }}-{{ uploader }}-{{ upload_year }}.{{ ext }}';

export function getPresetLabelFallback(labelKey: TranslationKey): string {
    switch (labelKey) {
        case 'filenamePresetLegacy':
            return 'Current compatible mode (Title-Author-Year)';
        case 'filenamePresetMediaCenterDateIndex':
            return 'Media center - Season/Episode by date and index';
        case 'filenamePresetPlaylistStaticIndex':
            return 'Playlist - Season 1 / Episode by index';
        case 'filenamePresetPlaylistStaticDate':
            return 'Playlist - Season 1 / Episode by date';
        case 'filenamePresetSourceDateFlat':
            return 'Source - Date then title';
        case 'filenamePresetCustom':
            return 'Custom template';
        default:
            return labelKey;
    }
}

export function resolveVisiblePresetId(
    presetId: string,
    deprecatedPresetAliases: DeprecatedPresetAlias[]
): string {
    return deprecatedPresetAliases.find((alias) => alias.id === presetId)?.mapsToCurrentPresetId || presetId;
}

export function deriveFilenamePresetId(
    settings: Pick<Settings, 'downloadFilenameMode' | 'downloadFilenameTemplate' | 'downloadFilenamePresetId'>,
    presets: FilenameTemplatePresetCatalogItem[] = [],
    deprecatedPresetAliases: DeprecatedPresetAlias[] = []
): string {
    if (settings.downloadFilenameMode === 'legacy') {
        return 'legacy';
    }

    if (settings.downloadFilenameMode === 'template') {
        const template = settings.downloadFilenameTemplate || '';
        const matchedBuiltIn = presets.find(
            (preset) =>
                preset.kind === 'template' &&
                preset.template === template
        );
        if (matchedBuiltIn) {
            return matchedBuiltIn.id;
        }
        if (settings.downloadFilenamePresetId && settings.downloadFilenamePresetId !== 'custom') {
            return resolveVisiblePresetId(settings.downloadFilenamePresetId, deprecatedPresetAliases);
        }
        return 'custom';
    }

    return resolveVisiblePresetId(settings.downloadFilenamePresetId || 'legacy', deprecatedPresetAliases);
}

export function deriveFilenameEffectiveTemplate(
    settings: Pick<Settings, 'downloadFilenameMode' | 'downloadFilenameTemplate' | 'downloadFilenamePresetId'>,
    presets: FilenameTemplatePresetCatalogItem[] = []
): string {
    if (settings.downloadFilenameMode === 'legacy') {
        return presets.find((preset) => preset.id === 'legacy')?.template || LEGACY_TEMPLATE;
    }

    if (settings.downloadFilenameMode === 'template') {
        return settings.downloadFilenameTemplate || '';
    }

    const presetId = settings.downloadFilenamePresetId || 'legacy';
    return presetId === 'custom'
        ? settings.downloadFilenameTemplate || ''
        : presets.find((preset) => preset.id === presetId)?.template || '';
}

export function resolveFilenamePresetSelectValue(
    derivedPresetId: string,
    namingMode: 'legacy' | 'template',
    forceCustomSelection: boolean
): string {
    return forceCustomSelection && namingMode === 'template'
        ? 'custom'
        : derivedPresetId;
}

export const MEDIA_SERVER_EXPORT_OPTIONS = [
    { value: 'off', labelKey: 'mediaServerExportModeOff' },
    { value: 'nfo', labelKey: 'mediaServerExportModeNfo' },
    { value: 'nfo_and_source_json', labelKey: 'mediaServerExportModeNfoAndSourceJson' },
] as const;
