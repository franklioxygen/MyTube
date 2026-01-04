
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted to ensure mocks are available for vi.mock factory
const mocks = vi.hoisted(() => {
    return {
        executeYtDlpSpawn: vi.fn(),
        executeYtDlpJson: vi.fn(),
        getUserYtDlpConfig: vi.fn(),
        getSettings: vi.fn(),
        readdirSync: vi.fn(),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        unlinkSync: vi.fn(),
        remove: vi.fn(),
    };
});

// Setup default return values in the factory or beforeEach
mocks.executeYtDlpJson.mockResolvedValue({
    title: 'Test Video',
    uploader: 'Test Author',
    upload_date: '20230101',
    thumbnail: 'http://example.com/thumb.jpg',
    extractor: 'youtube'
});
mocks.getUserYtDlpConfig.mockReturnValue({});
mocks.getSettings.mockReturnValue({});
mocks.readdirSync.mockReturnValue([]);
mocks.readFileSync.mockReturnValue('WEBVTT');

vi.mock('../../../config/paths', () => ({
    VIDEOS_DIR: '/mock/videos',
    IMAGES_DIR: '/mock/images',
    SUBTITLES_DIR: '/mock/subtitles',
}));

vi.mock('../../../utils/ytDlpUtils', () => ({
    executeYtDlpSpawn: (...args: any[]) => mocks.executeYtDlpSpawn(...args),
    executeYtDlpJson: (...args: any[]) => mocks.executeYtDlpJson(...args),
    getUserYtDlpConfig: (...args: any[]) => mocks.getUserYtDlpConfig(...args),
    getNetworkConfigFromUserConfig: () => ({})
}));

vi.mock('../../../services/storageService', () => ({
    updateActiveDownload: vi.fn(),
    saveVideo: vi.fn(),
    getVideoBySourceUrl: vi.fn(),
    updateVideo: vi.fn(),
    getSettings: () => mocks.getSettings(),
}));

// Mock processSubtitles to verify it receives correct arguments
// We need to access the actual implementation in logic but for this test checking arguments might be enough
// However, the real test is seeing if paths are correct in downloadVideo
// And we want to test processSubtitles logic too.

// Let's mock fs-extra completely
vi.mock('fs-extra', () => {
    return {
        default: {
            pathExists: vi.fn().mockResolvedValue(false),
            ensureDirSync: vi.fn(),
            existsSync: vi.fn().mockReturnValue(false),
            createWriteStream: vi.fn().mockReturnValue({
                on: (event: string, cb: any) => {
                    if (event === 'finish') cb();
                    return { on: vi.fn() };
                }
            }),
            readdirSync: (...args: any[]) => mocks.readdirSync(...args),
        readFileSync: (...args: any[]) => mocks.readFileSync(...args),
        writeFileSync: (...args: any[]) => mocks.writeFileSync(...args),
        copyFileSync: vi.fn(),
        unlinkSync: (...args: any[]) => mocks.unlinkSync(...args),
        remove: (...args: any[]) => mocks.remove(...args),
            statSync: vi.fn().mockReturnValue({ size: 1000 }),
        }
    };
});

vi.mock('axios', () => ({
    default: vi.fn().mockResolvedValue({
        data: {
            pipe: (writer: any) => {
                // Simulate write finish if writer has on method
                if (writer.on) {
                    // Find and call finish handler manually if needed
                     // But strictly relying on the createWriteStream mock above handling it
                }
            }
        }
    })
}));

vi.mock('../../../services/metadataService', () => ({
    getVideoDuration: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../utils/downloadUtils', () => ({
    isDownloadActive: vi.fn().mockReturnValue(true), // Always active
    isCancellationError: vi.fn().mockReturnValue(false),
    cleanupSubtitleFiles: vi.fn(),
    cleanupVideoArtifacts: vi.fn(),
}));

// Import the modules under test
import { processSubtitles } from '../../../services/downloaders/ytdlp/ytdlpSubtitle';

describe('File Location Logic', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.executeYtDlpSpawn.mockReturnValue({
            stdout: { on: vi.fn() },
            kill: vi.fn(),
            then: (resolve: any) => resolve()
        });
        mocks.readdirSync.mockReturnValue([]);
        // Reset default mock implementations if needed, but they are set on the object so clearer to set logic in test
    });

    // describe('downloadVideo', () => {});

    describe('processSubtitles', () => {
        it('should move subtitles to SUBTITLES_DIR by default', async () => {
            const baseFilename = 'video_123';
            mocks.readdirSync.mockReturnValue(['video_123.en.vtt']);
            mocks.readFileSync.mockReturnValue('WEBVTT');

            await processSubtitles(baseFilename, 'download_id', false);

            expect(mocks.writeFileSync).toHaveBeenCalledWith(
                path.join('/mock/subtitles', 'video_123.en.vtt'),
                expect.any(String),
                'utf-8'
            );
            expect(mocks.unlinkSync).toHaveBeenCalledWith(
                path.join('/mock/videos', 'video_123.en.vtt')
            );
        });

        it('should keep subtitles in VIDEOS_DIR if moveSubtitlesToVideoFolder is true', async () => {
            const baseFilename = 'video_123';
            mocks.readdirSync.mockReturnValue(['video_123.en.vtt']);
            mocks.readFileSync.mockReturnValue('WEBVTT');

            await processSubtitles(baseFilename, 'download_id', true);

            // Expect destination to be VIDEOS_DIR
            expect(mocks.writeFileSync).toHaveBeenCalledWith(
                path.join('/mock/videos', 'video_123.en.vtt'),
                expect.any(String),
                'utf-8'
            );
            
            // source and dest are technically same dir (but maybe different filenames if lang was parsed differently?)
            // In typical case: source = /videos/video_123.en.vtt, dest = /videos/video_123.en.vtt
            // Code says: if (sourceSubPath !== destSubPath) unlinkSync
            
            // Using mock path.join, let's trace:
            // source = /mock/videos/video_123.en.vtt
            // dest = /mock/videos/video_123.en.vtt
            // So unlinkSync should NOT be called
            expect(mocks.unlinkSync).not.toHaveBeenCalled();
        });
    });
});
