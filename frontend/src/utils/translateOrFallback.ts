import type { TranslationKey } from './translations';

export type TranslateFn = (
    key: TranslationKey,
    replacements?: Record<string, string | number>
) => string;

export const translateOrFallback = (
    t: TranslateFn,
    key: TranslationKey,
    fallback: string
): string => {
    const translated = t(key);
    return translated === key ? fallback : translated;
};

export const createTranslateOrFallback = (t: TranslateFn) => (
    key: TranslationKey,
    fallback: string
): string => translateOrFallback(t, key, fallback);
