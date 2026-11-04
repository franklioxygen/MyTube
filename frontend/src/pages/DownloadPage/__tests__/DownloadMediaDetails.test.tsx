import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { HistoryItem, type DownloadHistoryItem } from '../HistoryItem';
import { ActiveDownloadsTab } from '../ActiveDownloadsTab';
import { QueueTab } from '../QueueTab';
import { formatMediaBytes, formatMediaCodec } from '../../../utils/downloadMediaInfo';
vi.mock('../../../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key, language: 'en' }) }));
const item: DownloadHistoryItem = {
    id: 'history', title: 'Downloaded media', author: 'Creator', status: 'success', finishedAt: 100,
    mediaInfo: { version: 1, state: 'measured', capturedAt: 100, sizeBytes: '1073741824', width: 3840, height: 2160,
        videoCodec: 'hevc', audioCodec: 'aac', container: 'matroska,webm', bitrateBps: 2500000, sourceCollectionName: 'Source playlist' },
};
const show = (overrides: Partial<DownloadHistoryItem> = {}) => render(<BrowserRouter><HistoryItem item={{ ...item, ...overrides }}
    onRemove={vi.fn()} onCancelRetry={vi.fn()} onRetry={vi.fn()} onReDownload={vi.fn()} onViewVideo={vi.fn()} isDownloadInProgress={() => false} /></BrowserRouter>);

describe('download output information', () => {
    it.each(['success', 'deleted'] as const)('shows the %s output snapshot with source and separate bitrate units', status => {
        show({ status });
        expect(screen.getByText('author: Creator')).toBeInTheDocument();
        expect(screen.getByText('downloadSourceCollection: Source playlist')).toBeInTheDocument();
        expect(screen.queryByText('downloadFinalFile')).not.toBeInTheDocument();
        expect(screen.getByText('1 GiB · 3840 × 2160 · HEVC')).toBeInTheDocument();
        expect(screen.getByText('Matroska / WebM · AAC · 2500 kbps')).toBeInTheDocument();
    });
    it('keeps output facts in the metadata stack between the source and its link', () => {
        show({ sourceUrl: 'https://example.com/watch' });
        const facts = screen.getByLabelText('downloadMediaInfo');
        expect(facts.closest('.MuiListItemText-root')).not.toBeNull();
        expect(screen.getByText('author: Creator').compareDocumentPosition(facts)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(facts.compareDocumentPosition(screen.getByRole('link', { name: 'https://example.com/watch' }))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });
    it('omits video dimensions and cover-art codecs for audio-only media', () => {
        show({ mediaType: 'audio', mediaInfo: { ...item.mediaInfo!, videoCodec: 'mjpeg', audioCodec: 'flac' } });
        expect(screen.getByText('1 GiB · FLAC')).toBeInTheDocument();
        expect(screen.queryByText(/3840 × 2160/)).not.toBeInTheDocument();
        expect(screen.queryByText(/mjpeg/i)).not.toBeInTheDocument();
    });
    it.each(['failed', 'partial', 'pending_retry'] as const)('does not show final parameters on a %s row', status => {
        show({ status });
        expect(screen.queryByLabelText('downloadMediaInfo')).not.toBeInTheDocument();
        expect(screen.getByText('downloadSourceCollection: Source playlist')).toBeInTheDocument();
    });
    it('shows legacy size without an extra label or invented technical metadata', () => {
        show({ mediaInfo: undefined, totalSize: '1048576' });
        expect(screen.queryByText('downloadRecordedSize')).not.toBeInTheDocument();
        expect(screen.getByText('1 MiB')).toBeInTheDocument();
        expect(screen.queryByText('downloadFinalFile')).not.toBeInTheDocument();
    });
    it('keeps a successful row successful when the technical probe failed', () => {
        show({ mediaInfo: { version: 1, state: 'unavailable', capturedAt: 100, sizeBytes: '1048576' } });
        expect(screen.getByText('success')).toBeInTheDocument();
        expect(screen.getByText('downloadMediaInfoUnknown')).toBeInTheDocument();
        expect(screen.getByText('1 MiB')).toBeInTheDocument();
    });
    it.each([undefined, 'invalid'])('uses the recorded size when the snapshot size is %s', sizeBytes => {
        show({ totalSize: '1048576', mediaInfo: { version: 1, state: 'unavailable', capturedAt: 100, sizeBytes } });
        expect(screen.getByText('1 MiB')).toBeInTheDocument();
        expect(screen.getByText('downloadMediaInfoUnknown')).toBeInTheDocument();
    });
    it('prefers the captured size over an older recorded size', () => {
        show({ totalSize: '1048576' });
        expect(screen.getByText('1 GiB · 3840 × 2160 · HEVC')).toBeInTheDocument();
        expect(screen.queryByText('1 MiB')).not.toBeInTheDocument();
    });
    it('retains a previously formatted recorded size when no snapshot size is available', () => {
        show({ totalSize: '1.5 MiB', mediaInfo: { version: 1, state: 'unavailable', capturedAt: 100 } });
        expect(screen.getByText('1.5 MiB')).toBeInTheDocument();
    });
    it('identifies skipped output as an existing file', () => {
        show({ status: 'skipped' });
        expect(screen.getByText('downloadExistingFile')).toBeInTheDocument();
        expect(screen.queryByText('downloadFinalFile')).not.toBeInTheDocument();
    });
    it('identifies a duplicate skip with only a saved path without inventing media facts', () => {
        show({ status: 'skipped', videoPath: '/videos/existing.mp4', mediaInfo: undefined, totalSize: undefined });
        expect(screen.getByText('downloadExistingFile')).toBeInTheDocument();
        expect(screen.getByText('downloadMediaInfoUnknown')).toBeInTheDocument();
        expect(screen.queryByText(/3840 × 2160|HEVC|GiB/)).not.toBeInTheDocument();
    });
    it('does not claim an existing file for a skip with only a source snapshot', () => {
        show({ status: 'skipped', error: 'Skipped members-only content', mediaInfo: { version: 1, state: 'unavailable', capturedAt: 100, sourceCollectionName: 'Source playlist' } });
        expect(screen.queryByLabelText('downloadMediaInfo')).not.toBeInTheDocument();
        expect(screen.queryByText('downloadExistingFile')).not.toBeInTheDocument();
        expect(screen.getByText('downloadSourceCollection: Source playlist')).toBeInTheDocument();
    });
    it.each([
        ['a saved path', { videoPath: '/videos/existing.mp4' }],
        ['a recorded size', { totalSize: '1048576' }],
    ])('keeps the existing-file label for a source snapshot skip with %s', (_evidence, overrides) => {
        show({ status: 'skipped', mediaInfo: { version: 1, state: 'unavailable', capturedAt: 100, sourceCollectionName: 'Source playlist' }, ...overrides });
        expect(screen.getByText('downloadExistingFile')).toBeInTheDocument();
    });
    it('formats known codecs, retains unknown codecs and never invents a zero size', () => {
        expect(['h264','hevc','av1','future'].map(formatMediaCodec)).toEqual(['H.264','HEVC','AV1','future']);
        expect(formatMediaBytes('0')).toBeUndefined();
        expect(formatMediaBytes(undefined)).toBeUndefined();
    });
    it('shows only known source fields and estimated sizes for active downloads', () => {
        render(<ActiveDownloadsTab downloads={[{ id: 'active', title: 'Running', author: 'Creator', sourceCollectionName: 'Source playlist', totalSize: '20 MiB' }]} onCancel={vi.fn()} />);
        expect(screen.getByText('author: Creator')).toBeInTheDocument();
        expect(screen.getByText(/20 MiB.*downloadEstimatedSize/)).toBeInTheDocument();
        expect(screen.queryByText('downloadFinalFile')).not.toBeInTheDocument();
    });
    it('shows known queued sources without inventing a media format', () => {
        render(<QueueTab downloads={[{ id: 'queued', title: 'Waiting', author: 'Creator', sourceCollectionName: 'Source playlist' }]} onRemove={vi.fn()} onClear={vi.fn()} />);
        expect(screen.getByText('author: Creator')).toBeInTheDocument();
        expect(screen.getByText('downloadSourceCollection: Source playlist')).toBeInTheDocument();
        expect(screen.queryByLabelText('downloadMediaInfo')).not.toBeInTheDocument();
    });
});
