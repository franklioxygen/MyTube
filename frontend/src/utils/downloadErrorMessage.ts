import type { TranslationKey } from './translations';

/**
 * Backend failure messages that have a translation. Each key must match the
 * backend text exactly - see YOUTUBE_COOKIES_EXPIRED_MESSAGE in
 * backend/src/utils/ytdlp/errorClassification.ts.
 */
const LOCALIZED_DOWNLOAD_ERRORS: Record<string, TranslationKey> = {
    'YouTube refused the download (HTTP 403). Your YouTube cookies may have expired; please re-upload them.':
        'youtubeCookiesMayHaveExpired',
};

/** The translation key for a stored download error, if it has one. */
export function getDownloadErrorKey(error: string): TranslationKey | undefined {
    return LOCALIZED_DOWNLOAD_ERRORS[error];
}
