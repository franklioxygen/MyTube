import { getErrorMessage } from '../../utils/apiClient';
import type { TranslateFn } from '../../utils/translateOrFallback';
import { getWebAuthnErrorTranslationKey } from '../../utils/translations';

type HttpErrorShape = {
    response?: {
        status?: unknown;
        data?: {
            error?: unknown;
            message?: unknown;
        };
    };
    message?: unknown;
};

const readString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;

export const getResponseStatus = (error: unknown): number | undefined => {
    const status = (error as HttpErrorShape | undefined)?.response?.status;
    return typeof status === 'number' ? status : undefined;
};

export const isAuthOrRateLimitStatus = (error: unknown): boolean => {
    const status = getResponseStatus(error);
    return status === 401 || status === 429;
};

export const formatWaitTime = (ms: number): string => {
    if (ms < 1000) return 'a moment';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''}`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''}`;
    const days = Math.floor(hours / 24);
    return `${days} day${days !== 1 ? 's' : ''}`;
};

export const getPasswordErrorMessage = (
    error: unknown,
    fallbackMessage: string
): string => {
    const message = getErrorMessage(error);
    if (
        message === 'Incorrect password' ||
        message === 'Incorrect admin password' ||
        message === 'Incorrect visitor password'
    ) {
        return fallbackMessage;
    }
    return message || fallbackMessage;
};

export const getPasskeyErrorMessage = (
    error: unknown,
    fallbackMessage: string,
    t: TranslateFn
): string => {
    const errorShape = error as HttpErrorShape;
    let errorMessage =
        readString(errorShape.response?.data?.error) ||
        readString(errorShape.response?.data?.message) ||
        readString(errorShape.message) ||
        fallbackMessage;

    const translationKey = getWebAuthnErrorTranslationKey(errorMessage);
    if (translationKey) {
        errorMessage = t(translationKey) || errorMessage;
    }

    return errorMessage;
};

export const isLocalWebAuthnHost = (hostname: string): boolean =>
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

export const isWebAuthnSupported = (): boolean =>
    typeof window.PublicKeyCredential !== 'undefined' ||
    (
        typeof navigator !== 'undefined' &&
        'credentials' in navigator &&
        'create' in navigator.credentials
    );
