import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const RETRY_STORAGE_PREFIX = 'mytube:lazy-retry';
const VITE_PRELOAD_RETRY_KEY = 'vite-preload';
const DYNAMIC_IMPORT_ERROR_PATTERNS = [
    // Safari and some Chromium variants when an ESM chunk URL no longer exists.
    'Importing a module script failed',
    // Standard browser dynamic import failure surfaced by Vite.
    'Failed to fetch dynamically imported module',
    // Firefox wording for the same failure class.
    'error loading dynamically imported module',
    // Webpack-style chunk load failures seen in some browsers and wrappers.
    'ChunkLoadError',
    'Loading chunk',
    // Vite preload helper when a route CSS dependency is missing after deploy.
    'Unable to preload CSS',
];

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type ModuleLoader<T> = () => Promise<{ default: T }>;

type RetryDynamicImportOptions = {
    storage?: StorageLike | null;
    reload?: () => void;
};

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }

    return typeof error === 'string' ? error : '';
};

const getSessionStorage = (): StorageLike | null => {
    try {
        return typeof window !== 'undefined' ? window.sessionStorage : null;
    } catch {
        return null;
    }
};

const reloadPage = (): void => {
    if (typeof window !== 'undefined') {
        window.location.reload();
    }
};

const getRetryKey = (key: string): string => `${RETRY_STORAGE_PREFIX}:${key}`;

const clearRetryMarker = (storage: StorageLike | null, key: string): void => {
    storage?.removeItem(getRetryKey(key));
};

const triggerSingleReload = (
    key: string,
    storage: StorageLike | null,
    reload: (() => void) | undefined,
): boolean => {
    if (!storage) {
        return false;
    }

    const retryKey = getRetryKey(key);

    if (storage.getItem(retryKey) === 'true') {
        storage.removeItem(retryKey);
        return false;
    }

    storage.setItem(retryKey, 'true');
    (reload ?? reloadPage)();
    return true;
};

const waitForReload = (): Promise<never> =>
    new Promise(() => {
        // Intentionally stay pending so React keeps the boundary suspended until reload.
    });

export const isDynamicImportFailure = (error: unknown): boolean => {
    const message = getErrorMessage(error).toLowerCase();

    return DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) =>
        message.includes(pattern.toLowerCase())
    );
};

export const retryDynamicImport = async <T>(
    loader: () => Promise<T>,
    key: string,
    options: RetryDynamicImportOptions = {},
): Promise<T> => {
    const storage = options.storage === undefined ? getSessionStorage() : options.storage;

    try {
        const module = await loader();
        clearRetryMarker(storage, key);
        clearRetryMarker(storage, VITE_PRELOAD_RETRY_KEY);
        return module;
    } catch (error) {
        if (!isDynamicImportFailure(error)) {
            throw error;
        }

        if (!triggerSingleReload(key, storage, options.reload)) {
            throw error;
        }

        return waitForReload();
    }
};

export const registerVitePreloadErrorRecovery = (
    options: RetryDynamicImportOptions = {},
): (() => void) => {
    if (typeof window === 'undefined') {
        return () => {};
    }

    const handler = (event: Event): void => {
        const handled = triggerSingleReload(
            VITE_PRELOAD_RETRY_KEY,
            options.storage === undefined ? getSessionStorage() : options.storage,
            options.reload,
        );

        // Only suppress Vite's throw when we are actually recovering via reload.
        if (handled) {
            event.preventDefault();
        }
    };

    window.addEventListener('vite:preloadError', handler);

    return () => {
        window.removeEventListener('vite:preloadError', handler);
    };
};

export const lazyWithRetry = <T extends ComponentType<any>>(
    loader: ModuleLoader<T>,
    key: string,
): LazyExoticComponent<T> => lazy(() => retryDynamicImport(loader, key));
