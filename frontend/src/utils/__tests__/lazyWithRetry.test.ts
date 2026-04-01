import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
    isDynamicImportFailure,
    registerVitePreloadErrorRecovery,
    retryDynamicImport,
} from '../lazyWithRetry';

type StorageMock = {
    getItem: Mock<(key: string) => string | null>;
    setItem: Mock<(key: string, value: string) => void>;
    removeItem: Mock<(key: string) => void>;
};

const createStorageMock = (): StorageMock => {
    const store = new Map<string, string>();

    return {
        getItem: vi.fn((key: string) => store.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
            store.set(key, value);
        }),
        removeItem: vi.fn((key: string) => {
            store.delete(key);
        }),
    };
};

describe('lazyWithRetry', () => {
    let cleanup: (() => void) | undefined;

    afterEach(() => {
        cleanup?.();
        cleanup = undefined;
    });

    it('detects dynamic import failures from browser module loading errors', () => {
        expect(
            isDynamicImportFailure(new TypeError('Importing a module script failed.'))
        ).toBe(true);
        expect(
            isDynamicImportFailure(
                new TypeError('Failed to fetch dynamically imported module')
            )
        ).toBe(true);
        expect(
            isDynamicImportFailure(new Error('Unable to preload CSS for /assets/page.css'))
        ).toBe(true);
        expect(isDynamicImportFailure(new Error('Plain render error'))).toBe(false);
    });

    it('reloads once on the first dynamic import failure', async () => {
        const storage = createStorageMock();
        const reload = vi.fn();
        const promise = retryDynamicImport(
            () => Promise.reject(new TypeError('Importing a module script failed.')),
            'video-player',
            { storage, reload },
        );
        const settled = vi.fn();

        promise.then(settled, settled);
        await Promise.resolve();
        await Promise.resolve();

        expect(reload).toHaveBeenCalledTimes(1);
        expect(storage.setItem).toHaveBeenCalledWith(
            'mytube:lazy-retry:video-player',
            'true',
        );
        expect(settled).not.toHaveBeenCalled();
    });

    it('throws after a reload was already attempted for the same chunk', async () => {
        const storage = createStorageMock();
        const reload = vi.fn();

        storage.setItem('mytube:lazy-retry:video-player', 'true');

        await expect(
            retryDynamicImport(
                () =>
                    Promise.reject(
                        new TypeError('Failed to fetch dynamically imported module')
                    ),
                'video-player',
                { storage, reload },
            )
        ).rejects.toThrow('Failed to fetch dynamically imported module');

        expect(reload).not.toHaveBeenCalled();
        expect(storage.removeItem).toHaveBeenCalledWith(
            'mytube:lazy-retry:video-player',
        );
    });

    it('clears stale retry markers after a successful import', async () => {
        const storage = createStorageMock();

        storage.setItem('mytube:lazy-retry:video-player', 'true');

        await expect(
            retryDynamicImport(
                () => Promise.resolve({ default: 'VideoPlayer' }),
                'video-player',
                { storage },
            )
        ).resolves.toEqual({ default: 'VideoPlayer' });

        expect(storage.removeItem).toHaveBeenCalledWith(
            'mytube:lazy-retry:video-player',
        );
    });

    it('does not reload on unrelated errors', async () => {
        const storage = createStorageMock();
        const reload = vi.fn();

        await expect(
            retryDynamicImport(
                () => Promise.reject(new Error('Unexpected runtime failure')),
                'video-player',
                { storage, reload },
            )
        ).rejects.toThrow('Unexpected runtime failure');

        expect(reload).not.toHaveBeenCalled();
        expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('throws immediately when storage is unavailable', async () => {
        const reload = vi.fn();

        await expect(
            retryDynamicImport(
                () => Promise.reject(new TypeError('Importing a module script failed.')),
                'video-player',
                { storage: null, reload },
            )
        ).rejects.toThrow('Importing a module script failed.');

        expect(reload).not.toHaveBeenCalled();
    });

    it('reloads once and prevents default for vite preload errors', () => {
        const storage = createStorageMock();
        const reload = vi.fn();

        cleanup = registerVitePreloadErrorRecovery({ storage, reload });

        const event = new Event('vite:preloadError', { cancelable: true }) as Event & {
            payload?: unknown;
        };
        event.payload = new Error('Unable to preload CSS for /assets/video.css');

        expect(window.dispatchEvent(event)).toBe(false);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(storage.setItem).toHaveBeenCalledWith(
            'mytube:lazy-retry:vite-preload',
            'true',
        );
    });

    it('stops reloading after one vite preload recovery attempt', () => {
        const storage = createStorageMock();
        const reload = vi.fn();

        storage.setItem('mytube:lazy-retry:vite-preload', 'true');
        cleanup = registerVitePreloadErrorRecovery({ storage, reload });

        const event = new Event('vite:preloadError', { cancelable: true }) as Event & {
            payload?: unknown;
        };
        event.payload = new Error('Unable to preload CSS for /assets/video.css');

        expect(window.dispatchEvent(event)).toBe(true);
        expect(reload).not.toHaveBeenCalled();
        expect(storage.removeItem).toHaveBeenCalledWith(
            'mytube:lazy-retry:vite-preload',
        );
    });
});
