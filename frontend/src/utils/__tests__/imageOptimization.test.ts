import {
    buildSmallThumbnailAbsoluteUrl,
    buildSmallThumbnailUrl,
    extractThumbnailCacheSuffix,
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
    });
});
