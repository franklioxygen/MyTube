import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
const mockExecuteYtDlpSpawn = vi.fn();
const mockUnlinkSync = vi.fn();
const mockExecuteYtDlpJson = vi.fn().mockResolvedValue({
    title: 'Test Video',
    uploader: 'Test Author',
    upload_date: '20230101',
    thumbnail: 'http://example.com/thumb.jpg',
    extractor: 'youtube'
});
const mockGetUserYtDlpConfig = vi.fn().mockReturnValue({});
const videoPathExistsChecks = vi.hoisted(() => new Map<string, number>());
const additionalExistingPaths = vi.hoisted(() => new Set<string>());

vi.mock('../../../utils/ytDlpUtils', () => ({
    executeYtDlpSpawn: (...args: any[]) => mockExecuteYtDlpSpawn(...args),
    executeYtDlpJson: (...args: any[]) => mockExecuteYtDlpJson(...args),
    getUserYtDlpConfig: (...args: any[]) => mockGetUserYtDlpConfig(...args),
    // No subscription override in these tests → effective config == global config.
    getEffectiveUserYtDlpConfig: (url: any) => mockGetUserYtDlpConfig(url),
    getNetworkConfigFromUserConfig: () => ({}),
    getChannelUrlFromVideo: vi.fn().mockResolvedValue('https://youtube.com/channel/test'),
    downloadChannelAvatar: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../services/storageService', () => ({
    updateActiveDownload: vi.fn(),
    saveVideo: vi.fn(),
    persistDownloadedMediaIdentity: vi.fn(({ video }) => video),
    getVideos: vi.fn().mockReturnValue([]),
    getVideoById: vi.fn(),
    getVideoBySourceUrl: vi.fn(),
    updateVideo: vi.fn(),
    organizeVideoByAuthor: vi.fn(),
    isThumbnailReferencedByOtherVideo: vi.fn().mockReturnValue(false),
    isVideoFileReferencedByOtherVideo: vi.fn().mockReturnValue(false),
    getSettings: vi.fn().mockReturnValue({}),
    getDownloadStatus: vi.fn().mockReturnValue({
        activeDownloads: [{ id: 'download-yt' }],
        queuedDownloads: [],
    }),
}));

vi.mock('../../../services/filenameTemplate/outputPathAllocator', () => ({
    allocateOutputFamilySync: vi.fn((input: any) => ({
        videoRelativePath: input.videoRelativePath,
        thumbnailRelativePath: input.thumbnailRelativePath,
        subtitleBaseRelativePath: input.subtitleBaseRelativePath,
        collisionStrategy: 'none',
        release: vi.fn(),
    })),
    planOwnedReplacementStagingPathSync: vi.fn(() => null),
    promoteFileNoOverwriteSync: vi.fn(),
    replaceOwnedFileWithBackupSync: vi.fn(),
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
            ensureFileSync: vi.fn(),
            existsSync: vi.fn((target: any) => {
                const value = String(target);
                if (additionalExistingPaths.has(value)) {
                    return true;
                }
                if (
                    !/[\\/]uploads[\\/]videos[\\/]Test\.Video-Test\.Author-2023(?:_\d+)?\.(mp4|webm)$/.test(
                        value
                    )
                ) {
                    return false;
                }

                videoPathExistsChecks.set(value, (videoPathExistsChecks.get(value) ?? 0) + 1);
                return true;
            }),
            createWriteStream: vi.fn().mockReturnValue(mockWriter),
            readdirSync: vi.fn().mockReturnValue([]),
            statSync: vi.fn().mockReturnValue({ size: 1000 }),
            unlinkSync: (...args: any[]) => mockUnlinkSync(...args),
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
    getVideoDimensions: vi.fn().mockResolvedValue({ width: 1920, height: 1080 }),
}));

import { YtDlpDownloader } from '../../../services/downloaders/YtDlpDownloader';
import * as storageService from '../../../services/storageService';

describe('YtDlpDownloader format defaults', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        videoPathExistsChecks.clear();
        additionalExistingPaths.clear();
        mockGetUserYtDlpConfig.mockReturnValue({});
        vi.mocked(storageService.getVideoById).mockReturnValue(undefined);
        vi.mocked(storageService.getVideoBySourceUrl).mockReturnValue(undefined);
        vi.mocked(storageService.updateVideo).mockReturnValue(null);
        vi.mocked(storageService.isVideoFileReferencedByOtherVideo).mockReturnValue(false);
        mockExecuteYtDlpSpawn.mockReturnValue({
            stdout: { on: vi.fn() },
            kill: vi.fn(),
            then: (resolve: any) => resolve()
        });
    });

    it('should use high-quality playable YouTube formats by default', async () => {
        await YtDlpDownloader.downloadVideo('https://www.youtube.com/watch?v=123456');

        expect(mockExecuteYtDlpSpawn).toHaveBeenCalledTimes(1);
        const args = mockExecuteYtDlpSpawn.mock.calls[0][1];

        expect(args.format).toContain('vcodec^=vp9');
        expect(args.format).not.toContain('av01');
        expect(args.mergeOutputFormat).toBe('webm/mp4');
        expect(args.output).toContain('.%(ext)s');
    });

    it('persists a generic extractor row with an identity validateIdentity accepts', async () => {
        // For extractors outside the recognized set, extractSourceVideoId falls
        // back to the full URL while info.id is the extractor's own id. The row
        // and the identity must agree, or validateIdentity throws and the
        // downloaded media never reaches the library.
        const genericUrl = 'https://vimeo.com/987654321';
        mockExecuteYtDlpJson.mockResolvedValueOnce({
            id: '987654321',
            title: 'Test Video',
            uploader: 'Test Author',
            upload_date: '20230101',
            thumbnail: 'http://example.com/thumb.jpg',
            extractor: 'vimeo',
        });

        await YtDlpDownloader.downloadVideo(genericUrl);

        expect(storageService.persistDownloadedMediaIdentity).toHaveBeenCalledTimes(1);
        const persistCall = vi.mocked(
            storageService.persistDownloadedMediaIdentity
        ).mock.calls[0][0] as any;
        expect(persistCall.identity.sourceVideoId).toBe(genericUrl);
        expect(persistCall.video.sourceVideoId).toBe(
            persistCall.identity.sourceVideoId
        );
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
        // Should prefer VP9 instead of being restricted to avc1/h264.
        expect(args.format.indexOf('vcodec^=vp9')).toBeLessThan(args.format.indexOf('vcodec^=avc1'));
        // Should use the high-quality browser-playable format.
        expect(args.format).toContain('vcodec^=vp9');
        expect(args.format).not.toContain('av01');
        // Should prefer WebM while still allowing MP4 fallback.
        expect(args.mergeOutputFormat).toBe('webm/mp4');
        expect(args.output).toContain('.%(ext)s');
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

    it('should fetch metadata with skipDownload before starting the actual download', async () => {
        await YtDlpDownloader.downloadVideo('https://www.youtube.com/watch?v=123456');

        expect(mockExecuteYtDlpJson).toHaveBeenCalledTimes(1);
        expect(mockExecuteYtDlpJson).toHaveBeenCalledWith(
            'https://www.youtube.com/watch?v=123456',
            expect.objectContaining({
                noWarnings: true,
                skipDownload: true,
            }),
        );

        const metadataFlags = mockExecuteYtDlpJson.mock.calls[0][1];
        expect(metadataFlags.preferFreeFormats).toBeUndefined();
    });

    it('should update the active download title after metadata is fetched', async () => {
        await YtDlpDownloader.downloadVideo(
            'https://www.youtube.com/watch?v=123456',
            'download-yt',
        );

        expect(storageService.updateActiveDownload).toHaveBeenCalledWith(
            'download-yt',
            expect.objectContaining({
                title: 'Test Video',
                filename: 'Test Video',
                progress: 0,
            }),
        );
    });

    it('persists an explicit redownload into the selected local row', async () => {
        const sourceUrl = 'https://www.youtube.com/watch?v=123456';
        const selectedVideo = {
            id: 'selected-row',
            title: 'Selected damaged row',
            sourceUrl,
            mediaType: 'video' as const,
            videoFilename: 'Test.Video-Test.Author-2023.webm',
            videoPath: '/videos/Test.Video-Test.Author-2023.webm',
            createdAt: '2026-01-01T00:00:00.000Z',
        };
        const unorderedSourceMatch = {
            ...selectedVideo,
            id: 'different-row',
            title: 'Different intact row',
        };

        vi.mocked(storageService.getVideoById).mockReturnValue(selectedVideo);
        vi.mocked(storageService.getVideoBySourceUrl).mockReturnValue(
            unorderedSourceMatch,
        );
        vi.mocked(storageService.updateVideo).mockImplementation((id, updates) => ({
            ...(id === selectedVideo.id ? selectedVideo : unorderedSourceMatch),
            ...updates,
            id,
        }));

        const result = await YtDlpDownloader.downloadVideo(sourceUrl, {
            existingLocalVideoId: selectedVideo.id,
        });

        expect(storageService.getVideoById).toHaveBeenCalledWith(selectedVideo.id);
        expect(storageService.getVideoBySourceUrl).not.toHaveBeenCalled();
        expect(storageService.updateVideo).toHaveBeenCalledWith(
            selectedVideo.id,
            expect.objectContaining({
                videoPath: '/videos/Test.Video-Test.Author-2023.webm',
            }),
        );
        expect(result.id).toBe(selectedVideo.id);
    });

    it('does not delete an old video file still referenced by another row', async () => {
        const sourceUrl = 'https://www.youtube.com/watch?v=123456';
        const selectedVideo = {
            id: 'selected-row',
            title: 'Selected damaged row',
            sourceUrl,
            mediaType: 'video' as const,
            videoFilename: 'shared.mp4',
            videoPath: '/videos/shared.mp4',
            createdAt: '2026-01-01T00:00:00.000Z',
        };
        additionalExistingPaths.add(
            `${process.cwd()}/uploads/videos/shared.mp4`,
        );
        vi.mocked(storageService.getVideoById).mockReturnValue(selectedVideo);
        vi.mocked(
            storageService.isVideoFileReferencedByOtherVideo,
        ).mockReturnValue(true);
        vi.mocked(storageService.updateVideo).mockImplementation((id, updates) => ({
            ...selectedVideo,
            ...updates,
            id,
        }));

        await YtDlpDownloader.downloadVideo(sourceUrl, {
            existingLocalVideoId: selectedVideo.id,
        });

        expect(
            storageService.isVideoFileReferencedByOtherVideo,
        ).toHaveBeenCalledWith(selectedVideo, selectedVideo.id);
        expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it('rejects an explicit redownload when the selected row is missing', async () => {
        const sourceUrl = 'https://www.youtube.com/watch?v=123456';

        await expect(
            YtDlpDownloader.downloadVideo(sourceUrl, {
                existingLocalVideoId: 'missing-row',
            }),
        ).rejects.toThrow(
            'Requested yt-dlp redownload target missing-row was not found',
        );

        expect(mockExecuteYtDlpSpawn).not.toHaveBeenCalled();
        expect(storageService.getVideoBySourceUrl).not.toHaveBeenCalled();
        expect(storageService.updateVideo).not.toHaveBeenCalled();
        expect(storageService.persistDownloadedMediaIdentity).not.toHaveBeenCalled();
    });

    it('rejects an explicit redownload when the selected row has the wrong media type', async () => {
        const sourceUrl = 'https://www.youtube.com/watch?v=123456';
        vi.mocked(storageService.getVideoById).mockReturnValue({
            id: 'audio-row',
            title: 'Audio row',
            sourceUrl,
            mediaType: 'audio',
            createdAt: '2026-01-01T00:00:00.000Z',
        });

        await expect(
            YtDlpDownloader.downloadVideo(sourceUrl, {
                existingLocalVideoId: 'audio-row',
            }),
        ).rejects.toThrow(
            'Requested yt-dlp redownload target audio-row has media type audio, expected video',
        );

        expect(mockExecuteYtDlpSpawn).not.toHaveBeenCalled();
        expect(storageService.getVideoBySourceUrl).not.toHaveBeenCalled();
        expect(storageService.updateVideo).not.toHaveBeenCalled();
        expect(storageService.persistDownloadedMediaIdentity).not.toHaveBeenCalled();
    });
});
