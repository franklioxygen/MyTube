import { describe, expect, it } from 'vitest';
import {
    deriveFilenameEffectiveTemplate,
    deriveFilenamePresetId,
    resolveFilenamePresetSelectValue,
    getFilenameTemplateWarningMessage
} from '../FilenameTemplateSettings';

const catalogPresets = [
    {
        id: 'legacy',
        kind: 'legacy',
        labelKey: 'filenamePresetLegacy',
        descriptionKey: 'filenamePresetLegacy',
        template: '{{ title }}-{{ uploader }}-{{ upload_year }}.{{ ext }}',
        examplePath: 'Sample Video-Sample Channel-2026.mp4',
        recommendedSourceTypes: ['channel', 'playlist', 'single'],
    },
    {
        id: 'media_center_date_index',
        kind: 'template',
        labelKey: 'filenamePresetMediaCenterDateIndex',
        descriptionKey: 'filenamePresetMediaCenterDateIndex',
        template:
            '{{ source_custom_name }}/Season {{ season_from_date }}/{{ season_episode_index_from_date }} - {{ title }}.{{ ext }}',
        examplePath: 'Sample Channel/Season 2026/s2026e043001 - Sample Video.mp4',
        recommendedSourceTypes: ['channel'],
    },
] as any;

const deprecatedPresetAliases = [
    {
        id: 'channel_year_date_index',
        labelKey: 'filenamePresetChannelYearDateIndex',
        mapsToCurrentPresetId: 'media_center_date_index',
    },
] as any;

describe('getFilenameTemplateWarningMessage', () => {
    const t = (key: string) => `translated:${key}`;

    it('maps media playlist index warnings to a translation key', () => {
        expect(
            getFilenameTemplateWarningMessage(
                {
                    code: 'media_playlist_index_unavailable',
                    message: 'fallback message',
                },
                t as any
            )
        ).toBe('translated:filenameWarningMediaPlaylistIndexUnavailable');
    });

    it('maps source collection metadata warnings to a translation key', () => {
        expect(
            getFilenameTemplateWarningMessage(
                {
                    code: 'source_collection_metadata_may_be_empty',
                    message: 'fallback message',
                },
                t as any
            )
        ).toBe('translated:filenameWarningSourceCollectionMetadataMayBeEmpty');
    });

    it('falls back to the backend message for unknown warning codes', () => {
        expect(
            getFilenameTemplateWarningMessage(
                {
                    code: 'unknown_code',
                    message: 'backend fallback',
                },
                t as any
            )
        ).toBe('backend fallback');
    });
});

describe('deriveFilenamePresetId', () => {
    it('prefers legacy mode over stale deprecated preset ids', () => {
        expect(
            deriveFilenamePresetId({
                downloadFilenameMode: 'legacy',
                downloadFilenamePresetId: 'custom',
                downloadFilenameTemplate: '{{ title }}.{{ ext }}',
            } as any, catalogPresets)
        ).toBe('legacy');
    });

    it('derives a built-in preset from template mode and exact template match', () => {
        expect(
            deriveFilenamePresetId({
                downloadFilenameMode: 'template',
                downloadFilenameTemplate:
                    '{{ source_custom_name }}/Season {{ season_from_date }}/{{ season_episode_index_from_date }} - {{ title }}.{{ ext }}',
            } as any, catalogPresets)
        ).toBe('media_center_date_index');
    });

    it('derives custom when template mode does not match a built-in preset', () => {
        expect(
            deriveFilenamePresetId({
                downloadFilenameMode: 'template',
                downloadFilenameTemplate: '{{ title }}.{{ ext }}',
            } as any, catalogPresets)
        ).toBe('custom');
    });

    it('maps deprecated preset ids to the current visible preset when provided by the server', () => {
        expect(
            deriveFilenamePresetId({
                downloadFilenameMode: 'template',
                downloadFilenamePresetId: 'channel_year_date_index',
                downloadFilenameTemplate:
                    '{{ source_collection_name }}/{{ season_by_year__episode_by_date_and_index }} - {{ title }}.{{ ext }}',
            } as any, catalogPresets, deprecatedPresetAliases)
        ).toBe('media_center_date_index');
    });
});

describe('deriveFilenameEffectiveTemplate', () => {
    it('returns the legacy template when mode is legacy', () => {
        expect(
            deriveFilenameEffectiveTemplate({
                downloadFilenameMode: 'legacy',
                downloadFilenameTemplate: '{{ title }}.{{ ext }}',
                downloadFilenamePresetId: 'custom',
            } as any, catalogPresets)
        ).toBe('{{ title }}-{{ uploader }}-{{ upload_year }}.{{ ext }}');
    });
});

describe('resolveFilenamePresetSelectValue', () => {
    it('shows custom while the user has explicitly selected custom mode in template mode', () => {
        expect(
            resolveFilenamePresetSelectValue(
                'playlist_static_index',
                'template',
                true
            )
        ).toBe('custom');
    });

    it('does not override legacy mode with custom', () => {
        expect(
            resolveFilenamePresetSelectValue(
                'legacy',
                'legacy',
                true
            )
        ).toBe('legacy');
    });
});
