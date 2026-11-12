import { describe, expect, it } from 'vitest';
import { cropRectangle, validateAvatarImage } from '../avatarCrop';

const file = (bytes: Uint8Array, type: string) => ({ type, size: bytes.length, arrayBuffer: async () => bytes.buffer }) as File;
const png = (width: number, height: number, animated = false) => {
    const bytes = new Uint8Array(45); const view = new DataView(bytes.buffer);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    view.setUint32(8, 13); bytes.set([73, 72, 68, 82], 12);
    view.setUint32(16, width); view.setUint32(20, height);
    if (animated) { view.setUint32(33, 0); bytes.set([97, 99, 84, 76], 37); }
    return file(bytes, 'image/png');
};
describe('avatar crop validation', () => {
    it('checks dimensions before decoding image pixels', async () => {
        await expect(validateAvatarImage(png(512, 512))).resolves.toBeUndefined();
        await expect(validateAvatarImage(png(8193, 1))).rejects.toThrow('dimensions');
        await expect(validateAvatarImage(png(5000, 5000))).rejects.toThrow('dimensions');
        await expect(validateAvatarImage(png(0, 512))).rejects.toThrow('format');
    });
    it('rejects animated or mislabeled images', async () => {
        await expect(validateAvatarImage(png(512, 512, true))).rejects.toThrow('format');
        await expect(validateAvatarImage(file(new Uint8Array(100), 'image/jpeg'))).rejects.toThrow('format');
        await expect(validateAvatarImage(file(new Uint8Array(100), 'image/svg+xml'))).rejects.toThrow('format');
    });
    it('keeps zoomed crops within portrait and landscape bounds', () => {
        expect(cropRectangle(1200, 600, { zoom: 1, x: 0, y: 0 })).toEqual({ side: 600, sx: 300, sy: 0 });
        expect(cropRectangle(600, 1200, { zoom: 2, x: 1, y: -1 })).toEqual({ side: 300, sx: 300, sy: 0 });
    });
});
