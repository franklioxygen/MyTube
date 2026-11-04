import { Box, Typography } from '@mui/material';
import { useLanguage } from '../../contexts/LanguageContext';
import { formatMediaBytes, formatMediaCodec } from '../../utils/downloadMediaInfo';
import type { DownloadHistoryItem } from './HistoryItem';

export function DownloadSourceInfo({ author, sourceCollectionName }: { author?: string; sourceCollectionName?: string }) {
    const { t } = useLanguage();
    if (!author && !sourceCollectionName) return null;
    return <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, overflowWrap: 'anywhere' }}>
        {author && <Typography variant="caption" color="text.secondary">{t('author')}: {author}</Typography>}
        {sourceCollectionName && <Typography variant="caption" color="text.secondary">{t('downloadSourceCollection')}: {sourceCollectionName}</Typography>}
    </Box>;
}

/** Show historical output facts only for saved/existing files, never a failed task's selected format. */
export function DownloadMediaDetails({ item }: { item: DownloadHistoryItem }) {
    const { t } = useLanguage();
    if (!['success', 'deleted', 'skipped'].includes(item.status)) return null;
    const info = item.mediaInfo;
    const size = formatMediaBytes(info?.sizeBytes) ?? formatMediaBytes(item.totalSize) ?? item.totalSize;
    const measured = info?.state === 'measured';
    const resolution = measured && item.mediaType !== 'audio' && (info.width ?? 0) > 0 && (info.height ?? 0) > 0 ? `${info.width} × ${info.height}` : undefined;
    const codec = measured ? formatMediaCodec(item.mediaType === 'audio' ? info.audioCodec : info.videoCodec ?? info.audioCodec) : undefined;
    const details = measured ? [
        info.container?.replace('mov,mp4,m4a,3gp,3g2,mj2', 'MP4 / MOV').replace('matroska,webm', 'Matroska / WebM'),
        item.mediaType !== 'audio' && info.videoCodec && info.audioCodec ? formatMediaCodec(info.audioCodec) : undefined,
        info.bitrateBps && info.bitrateBps > 0 ? `${Number((info.bitrateBps / 1000).toFixed(1))} kbps` : undefined,
    ].filter(Boolean).join(' · ') : '';
    if (!info && !size && !(item.status === 'skipped' && item.videoPath)) return null;
    // A source-only snapshot, e.g. a members-only skip, is no evidence of an existing file.
    if (item.status === 'skipped' && !item.videoPath && !item.totalSize && !size && !measured) return null;
    return <Box aria-label={t('downloadMediaInfo')} sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, overflowWrap: 'anywhere' }}>
        {item.status === 'skipped' && <Typography variant="caption" color="text.secondary">{t('downloadExistingFile')}</Typography>}
        <Typography variant="caption" color="text.primary">{[size, resolution, codec].filter(Boolean).join(' · ') || t('downloadMediaInfoUnknown')}</Typography>
        {details && <Typography variant="caption" color="text.secondary">{details}</Typography>}
        {info?.state === 'unavailable' && size && <Typography variant="caption" color="text.secondary">{t('downloadMediaInfoUnknown')}</Typography>}
    </Box>;
}
