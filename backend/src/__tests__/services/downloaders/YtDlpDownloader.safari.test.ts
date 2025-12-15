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

vi.mock('fs-extra', () => ({
    default: {
        pathExists: vi.fn().mockResolvedValue(false),
        ensureDirSync: vi.fn(),
        existsSync: vi.fn().mockReturnValue(false),
        createWriteStream: vi.fn().mockReturnValue({
            on: (event: string, cb: any) => {
                if (event === 'finish') cb();
                return { on: () => {} };
            }
        }),
        readdirSync: vi.fn().mockReturnValue([]),
    }
}));

vi.mock('axios', () => ({
    default: {
        get: vi.fn().mockResolvedValue({ data: {} }),
        create: vi.fn().mockReturnValue({ get: vi.fn(), post: vi.fn() }),
    }
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

    it('should maintain H.264 preference even when formatSort is provided', async () => {
        // Mock user config with formatSort
        mockGetUserYtDlpConfig.mockReturnValue({
            S: 'res:1080'
        });

        await YtDlpDownloader.downloadVideo('https://www.youtube.com/watch?v=123456');

        expect(mockExecuteYtDlpSpawn).toHaveBeenCalledTimes(1);
        const args = mockExecuteYtDlpSpawn.mock.calls[0][1];
        
        // Should have both formatSort AND the specific format
        expect(args.formatSort).toBe('res:1080');
        expect(args.format).toContain('vcodec^=avc1');
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
