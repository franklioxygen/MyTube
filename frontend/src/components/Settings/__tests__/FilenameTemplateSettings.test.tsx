import { describe, expect, it } from 'vitest';
import {
    deriveFilenameEffectiveTemplate,
    deriveFilenamePresetId,
    resolveFilenamePresetSelectValue,
    getFilenameTemplateWarningMessage
} from '../FilenameTemplateSettings';

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
            } as any)
        ).toBe('legacy');
    });

    it('derives a built-in preset from template mode and exact template match', () => {
        expect(
            deriveFilenamePresetId({
                downloadFilenameMode: 'template',
                downloadFilenameTemplate:
                    '{{ source_collection_name }}/{{ static_season__episode_by_index }} - {{ title }}.{{ ext }}',
            } as any)
        ).toBe('playlist_static_index');
    });

    it('derives custom when template mode does not match a built-in preset', () => {
        expect(
            deriveFilenamePresetId({
                downloadFilenameMode: 'template',
                downloadFilenameTemplate: '{{ title }}.{{ ext }}',
            } as any)
        ).toBe('custom');
    });
});

describe('deriveFilenameEffectiveTemplate', () => {
    it('returns the legacy template when mode is legacy', () => {
        expect(
            deriveFilenameEffectiveTemplate({
                downloadFilenameMode: 'legacy',
                downloadFilenameTemplate: '{{ title }}.{{ ext }}',
                downloadFilenamePresetId: 'custom',
            } as any)
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
