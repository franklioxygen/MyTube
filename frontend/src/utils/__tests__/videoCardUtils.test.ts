import { describe, expect, it } from 'vitest';
import { Collection, Video } from '../../types';
import { getVideoCardCollectionInfo, isNewVideo } from '../videoCardUtils';

describe('videoCardUtils', () => {
    describe('isNewVideo', () => {
        it('should return true for video with 0 views and added within 7 days', () => {
            const video = {
                viewCount: 0,
                addedAt: new Date().toISOString(),
            } as Video;
            expect(isNewVideo(video)).toBe(true);
        });

        it('should return true for video with string "0" views', () => {
            const video = {
                viewCount: "0",
                addedAt: new Date().toISOString(),
            } as any;
            expect(isNewVideo(video)).toBe(true);
        });

        it('should return false for video with views > 0', () => {
            const video = {
                viewCount: 1,
                addedAt: new Date().toISOString(),
            } as Video;
            expect(isNewVideo(video)).toBe(false);
        });

        it('should return false for video added more than 7 days ago', () => {
            const date = new Date();
            date.setDate(date.getDate() - 8);
            const video = {
                viewCount: 0,
                addedAt: date.toISOString(),
            } as Video;
            expect(isNewVideo(video)).toBe(false);
        });

        it('should return false if addedAt is missing', () => {
             const video = {
                viewCount: 0,
            } as Video;
            expect(isNewVideo(video)).toBe(false);
        });
    });

    describe('getVideoCardCollectionInfo', () => {
        const mockVideo: Video = { id: 'v1', title: 'Video 1' } as Video;
        const mockCollections: Collection[] = [
            { id: 'c1', name: 'Collection 1', videos: ['v1', 'v2'] } as Collection,
            { id: 'c2', name: 'Collection 2', videos: ['v2', 'v1'] } as Collection,
        ];

        it('should return correct collection info', () => {
            const info = getVideoCardCollectionInfo(mockVideo, mockCollections, false);
            
            expect(info.videoCollections).toHaveLength(2);
            expect(info.isFirstInAnyCollection).toBe(true);
            expect(info.firstInCollectionNames).toContain('Collection 1');
            expect(info.firstCollectionId).toBe('c1');
        });

        it('should respect disableCollectionGrouping', () => {
            const info = getVideoCardCollectionInfo(mockVideo, mockCollections, true);

            expect(info.isFirstInAnyCollection).toBe(false);
            expect(info.firstCollectionId).toBeNull();
        });

        it('should handle video not being first in any collection', () => {
             // Create a scenario where video is present but not first
            const info = getVideoCardCollectionInfo(
                { id: 'v2' } as Video,
                [{ id: 'c1', name: 'C1', videos: ['v1', 'v2'] } as Collection],
                false
            );

            expect(info.isFirstInAnyCollection).toBe(false);
            expect(info.firstCollectionId).toBeNull();
        });

         it('should return empty info if video is in no collections', () => {
            const video3 = { id: 'v3' } as Video;
            const info = getVideoCardCollectionInfo(video3, mockCollections, false);

            expect(info.videoCollections).toHaveLength(0);
            expect(info.isFirstInAnyCollection).toBe(false);
        });
    });
});
