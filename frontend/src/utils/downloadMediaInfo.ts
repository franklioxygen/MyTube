export interface DownloadMediaInfo {
    version: 1;
    state: 'measured' | 'unavailable';
    capturedAt: number;
    sizeBytes?: string;
    width?: number;
    height?: number;
    videoCodec?: string;
    audioCodec?: string;
    container?: string;
    bitrateBps?: number;
    sourceCollectionName?: string;
}

const CODECS: Record<string, string> = {
    h264: 'H.264', avc1: 'H.264', hevc: 'HEVC', h265: 'HEVC', av1: 'AV1',
    vp9: 'VP9', vp8: 'VP8', aac: 'AAC', opus: 'Opus', mp3: 'MP3', flac: 'FLAC', vorbis: 'Vorbis',
};
export const formatMediaCodec = (value?: string) => value ? CODECS[value.toLowerCase()] ?? value : undefined;

/** File sizes use binary units; bitrate is a separate decimal quantity. */
export function formatMediaBytes(raw?: string): string | undefined {
    if (!raw || !/^\d+$/.test(raw)) return undefined;
    const size = Number(raw);
    if (!Number.isFinite(size) || size <= 0) return undefined;
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
    return `${Number((size / 1024 ** index).toFixed(2))} ${units[index]}`;
}
