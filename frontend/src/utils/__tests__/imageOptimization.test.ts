import {
    buildSmallThumbnailAbsoluteUrl,
    buildSmallThumbnailUrl,
    buildThumbnailCandidates,
    extractThumbnailCacheSuffix,
    toOriginalThumbnailPath,
    toSmallThumbnailPath,
} from '../imageOptimization';

describe('imageOptimization', () => {
    it('maps local images paths to images-small', () => {
        expect(toSmallThumbnailPath('/images/folder/thumb.jpg')).toBe('/images-small/folder/thumb.jpg');
    });

    it('maps video-folder thumbnails to images-small using the same relative path', () => {
        expect(toSmallThumbnailPath('/videos/Collection/thumb.jpg')).toBe('/images-small/Collection/thumb.jpg');
    });

    it('preserves cache-busting query strings when thumbnailUrl matches thumbnailPath', () => {
        expect(
            extractThumbnailCacheSuffix('/images/thumb.jpg', '/images/thumb.jpg?t=123'),
        ).toBe('?t=123');
        expect(
            buildSmallThumbnailUrl('/images/thumb.jpg', '/images/thumb.jpg?t=123'),
        ).toBe('/images-small/thumb.jpg?t=123');
    });

    it('returns undefined for non-local thumbnail paths', () => {
        expect(toSmallThumbnailPath('cloud:thumb.jpg')).toBeUndefined();
        expect(buildSmallThumbnailAbsoluteUrl('http://localhost:3000', 'cloud:thumb.jpg')).toBeUndefined();
        expect(toOriginalThumbnailPath('cloud:thumb.jpg')).toBeUndefined();
    });

    describe('buildThumbnailCandidates', () => {
        it('falls back from the small mirror to the original image on the page origin', () => {
            expect(buildThumbnailCandidates('', '/images/folder/thumb.jpg')).toEqual([
                '/images-small/folder/thumb.jpg',
                '/images/folder/thumb.jpg',
            ]);
        });

        it('tries the backend origin first, then the page origin, for every path', () => {
            expect(
                buildThumbnailCandidates('http://backend:5551', '/images/thumb.jpg'),
            ).toEqual([
                'http://backend:5551/images-small/thumb.jpg',
                '/images-small/thumb.jpg',
                'http://backend:5551/images/thumb.jpg',
                '/images/thumb.jpg',
            ]);
        });

        it('keeps the cache-busting suffix on every local candidate and drops duplicates', () => {
            expect(
                buildThumbnailCandidates('', '/videos/thumb.jpg', '/videos/thumb.jpg?t=9'),
            ).toEqual([
                '/images-small/thumb.jpg?t=9',
                '/videos/thumb.jpg?t=9',
            ]);
        });

        it('offers only the remote url for cloud-stored thumbnails', () => {
            expect(
                buildThumbnailCandidates('', 'cloud:thumb.jpg', 'https://cdn.example/thumb.jpg'),
            ).toEqual(['https://cdn.example/thumb.jpg']);
        });

        it('returns nothing when there is no thumbnail at all', () => {
            expect(buildThumbnailCandidates('', undefined, undefined)).toEqual([]);
        });
    });
});
