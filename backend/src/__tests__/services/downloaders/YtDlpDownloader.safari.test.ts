import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
const mockExecuteYtDlpSpawn = vi.fn();
const mockExecuteYtDlpJson = vi.fn().mockResolvedValue({
    title: 'Test Video',
    uploader: 'Test Author',
    upload_date: '20230101',
    thumbnail: 'http://example.com/thumb.jpg',
    extractor: 'youtube'
});
const mockGetUserYtDlpConfig = vi.fn().mockReturnValue({});

vi.mock('../../../utils/ytDlpUtils', () => ({
    executeYtDlpSpawn: (...args: any[]) => mockExecuteYtDlpSpawn(...args),
    executeYtDlpJson: (...args: any[]) => mockExecuteYtDlpJson(...args),
    getUserYtDlpConfig: (...args: any[]) => mockGetUserYtDlpConfig(...args),
    getNetworkConfigFromUserConfig: () => ({})
}));

vi.mock('../../../services/storageService', () => ({
    updateActiveDownload: vi.fn(),
    saveVideo: vi.fn(),
    getVideoBySourceUrl: vi.fn(),
    updateVideo: vi.fn(),
}));

// Mock fs-extra - define mockWriter inside the factory
vi.mock('fs-extra', () => {
    const mockWriter = {
        on: vi.fn((event: string, cb: any) => {
            if (event === 'finish') {
                // Call callback immediately to simulate successful write
                setTimeout(() => cb(), 0);
            }
            return mockWriter;
        })
    };

    return {
        default: {
            pathExists: vi.fn().mockResolvedValue(false),
            ensureDirSync: vi.fn(),
            existsSync: vi.fn().mockReturnValue(false),
            createWriteStream: vi.fn().mockReturnValue(mockWriter),
            readdirSync: vi.fn().mockReturnValue([]),
            statSync: vi.fn().mockReturnValue({ size: 1000 }),
        }
    };
});

// Mock axios - define mock inside factory
vi.mock('axios', () => {
    const mockAxios = vi.fn().mockResolvedValue({
        data: {
            pipe: vi.fn((writer: any) => {
                // Simulate stream completion
                setTimeout(() => {
                    // Find the finish handler and call it
                    const finishCall = (writer.on as any).mock?.calls?.find((call: any[]) => call[0] === 'finish');
                    if (finishCall && finishCall[1]) {
                        finishCall[1]();
                    }
                }, 0);
                return writer;
            })
        }
    });
    
    return {
        default: mockAxios,
    };
});

// Mock metadataService to avoid file system errors
vi.mock('../../../services/metadataService', () => ({
    getVideoDuration: vi.fn().mockResolvedValue(null),
}));

import { YtDlpDownloader } from '../../../services/downloaders/YtDlpDownloader';

describe('YtDlpDownloader Safari Compatibility', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockExecuteYtDlpSpawn.mockReturnValue({
            stdout: { on: vi.fn() },
            kill: vi.fn(),
            then: (resolve: any) => resolve()
        });
    });

    it('should use H.264 compatible format for YouTube videos by default', async () => {
        await YtDlpDownloader.downloadVideo('https://www.youtube.com/watch?v=123456');

        expect(mockExecuteYtDlpSpawn).toHaveBeenCalledTimes(1);
        const args = mockExecuteYtDlpSpawn.mock.calls[0][1];
        
        expect(args.format).toContain('vcodec^=avc1');
        // Expect m4a audio which implies AAC for YouTube
        expect(args.format).toContain('ext=m4a');
    });

    it('should relax H.264 preference when formatSort is provided to allow higher resolutions', async () => {
        // Mock user config with formatSort
        mockGetUserYtDlpConfig.mockReturnValue({
            S: 'res:2160'
        });

        await YtDlpDownloader.downloadVideo('https://www.youtube.com/watch?v=123456');

        expect(mockExecuteYtDlpSpawn).toHaveBeenCalledTimes(1);
        const args = mockExecuteYtDlpSpawn.mock.calls[0][1];
        
        // Should have formatSort
        expect(args.formatSort).toBe('res:2160');
        // Should NOT be restricted to avc1/h264 anymore
        expect(args.format).not.toContain('vcodec^=avc1');
        // Should use the permissive format, but prioritizing VP9/WebM
        expect(args.format).toBe('bestvideo[vcodec^=vp9][ext=webm]+bestaudio/bestvideo[ext=webm]+bestaudio/bestvideo+bestaudio/best');
        // Should default to WebM to support VP9/AV1 codecs better than MP4 and compatible with Safari 14+
        expect(args.mergeOutputFormat).toBe('webm');
    });

    it('should NOT force generic avc1 string if user provides custom format', async () => {
        // Mock user config with custom format
        mockGetUserYtDlpConfig.mockReturnValue({
            f: 'bestvideo+bestaudio'
        });

        await YtDlpDownloader.downloadVideo('https://www.youtube.com/watch?v=123456');

        expect(mockExecuteYtDlpSpawn).toHaveBeenCalledTimes(1);
        const args = mockExecuteYtDlpSpawn.mock.calls[0][1];
        
        // Should use user's format
        expect(args.format).toBe('bestvideo+bestaudio');
    });
});
