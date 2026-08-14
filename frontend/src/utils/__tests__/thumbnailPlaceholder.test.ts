import {
    THUMBNAIL_PLACEHOLDER_SRC,
    handleThumbnailError,
} from '../thumbnailPlaceholder';

const createImage = (src: string): HTMLImageElement => {
    const image = document.createElement('img');
    image.src = src;
    return image;
};

describe('handleThumbnailError', () => {
    it('advances to the next candidate instead of giving up on the first failure', () => {
        const candidates = ['/images-small/thumb.jpg', '/images/thumb.jpg'];
        const image = createImage(candidates[0]);

        handleThumbnailError(image, candidates);

        expect(image.src).toBe(`${window.location.origin}/images/thumb.jpg`);
    });

    it('walks an absolute backend candidate down to the same-origin one', () => {
        const candidates = [
            'http://backend:5551/images-small/thumb.jpg',
            '/images-small/thumb.jpg',
        ];
        const image = createImage(candidates[0]);

        handleThumbnailError(image, candidates);

        expect(image.src).toBe(`${window.location.origin}/images-small/thumb.jpg`);
    });

    it('falls back to the placeholder once the last candidate fails', () => {
        const candidates = ['/images-small/thumb.jpg', '/images/thumb.jpg'];
        const image = createImage(candidates[1]);

        handleThumbnailError(image, candidates);

        expect(image.src).toBe(THUMBNAIL_PLACEHOLDER_SRC);
    });

    it('uses the placeholder when there are no candidates', () => {
        const image = createImage('/images-small/thumb.jpg');

        handleThumbnailError(image, []);

        expect(image.src).toBe(THUMBNAIL_PLACEHOLDER_SRC);
    });

    it('never re-tries the url that just failed', () => {
        const candidates = ['/images-small/thumb.jpg', '/images-small/thumb.jpg'];
        const image = createImage(candidates[0]);

        handleThumbnailError(image, candidates);

        expect(image.src).toBe(THUMBNAIL_PLACEHOLDER_SRC);
    });

    it('clears srcset/sizes so the failed candidate cannot be re-selected', () => {
        const candidates = ['/images-small/thumb.jpg', '/images/thumb.jpg'];
        const image = createImage(candidates[0]);
        image.srcset = '/images-small/thumb.jpg 480w';
        image.sizes = '480px';

        handleThumbnailError(image, candidates);

        expect(image.hasAttribute('srcset')).toBe(false);
        expect(image.hasAttribute('sizes')).toBe(false);
    });
});
