export interface Crop { zoom: number; x: number; y: number }
export const INITIAL_CROP: Crop = { zoom: 1, x: 0, y: 0 };

/** Inspect bounded file bytes before asking the browser to decode pixels. */
export async function validateAvatarImage(file: File): Promise<void> {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024)
        throw new Error('format');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const tag = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
    let width = 0, height = 0;
    if (file.type === 'image/png' && bytes.length >= 24 && tag(1, 3) === 'PNG' && view.getUint32(0) === 0x89504e47) {
        width = view.getUint32(16); height = view.getUint32(20);
        for (let i = 8; i + 12 <= bytes.length;) {
            const length = view.getUint32(i);
            if (tag(i + 4, 4) === 'acTL') throw new Error('format');
            i += length + 12;
        }
    } else if (file.type === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8) {
        for (let i = 2; i + 3 < bytes.length;) {
            if (bytes[i++] !== 0xff) break;
            while (bytes[i] === 0xff) i++;
            const marker = bytes[i++];
            if (marker === 0xda || marker === 0xd9) break;
            if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
            if (i + 2 > bytes.length) break;
            const length = view.getUint16(i);
            if (length < 2 || i + length > bytes.length) break;
            if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
                height = view.getUint16(i + 3); width = view.getUint16(i + 5); break;
            }
            i += length;
        }
    } else if (file.type === 'image/webp' && bytes.length >= 30 && tag(0, 4) === 'RIFF' && tag(8, 4) === 'WEBP') {
        const kind = tag(12, 4);
        const u24 = (i: number) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
        if (kind === 'VP8X') {
            if (bytes[20] & 2) throw new Error('format');
            width = u24(24) + 1; height = u24(27) + 1;
        } else if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
            width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
        } else if (kind === 'VP8L' && bytes[20] === 0x2f) {
            const packed = view.getUint32(21, true);
            width = (packed & 0x3fff) + 1; height = ((packed >>> 14) & 0x3fff) + 1;
        }
    }
    if (!width || !height) throw new Error('format');
    if (width > 8192 || height > 8192 || width * height > 16_000_000) throw new Error('dimensions');
}

export function cropRectangle(width: number, height: number, crop: Crop) {
    const side = Math.min(width, height) / crop.zoom;
    return { side, sx: (width - side) * (1 + crop.x) / 2, sy: (height - side) * (1 + crop.y) / 2 };
}

export async function exportAvatar(image: HTMLImageElement, crop: Crop): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    const { side, sx, sy } = cropRectangle(image.naturalWidth, image.naturalHeight, crop);
    context.fillStyle = '#fff'; context.fillRect(0, 0, 512, 512);
    context.drawImage(image, sx, sy, side, side, 0, 0, 512, 512);
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image export failed')), 'image/png'));
}
