import { describe, expect, it } from 'vitest';
import { getFilenameTemplateWarningMessage } from '../FilenameTemplateSettings';

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
