import { parseIncompleteDownloadNote } from '../../utils/incompleteDownloadNote';
import type { DownloadHistoryItem } from './HistoryItem';

/**
 * A download that was saved although part of its content is missing: the video
 * is in the library, so the row stays a success, and its note says what is gone.
 */
export const isIncompleteSave = (item: DownloadHistoryItem): boolean =>
    item.status === 'success' && parseIncompleteDownloadNote(item.error) !== undefined;
