import { describe, expect, it } from 'vitest';
import { ar } from '../ar';
import { de } from '../de';
import { en } from '../en';
import { es } from '../es';
import { fr } from '../fr';
import { ja } from '../ja';
import { ko } from '../ko';
import { pt } from '../pt';
import { ru } from '../ru';
import { zh } from '../zh';

/**
 * English is the reference set: `t()` has no cross-locale fallback, so a key
 * missing from one locale renders as the raw key for those users.
 */
const translations: Record<string, Record<string, string>> = {
    ar,
    de,
    es,
    fr,
    ja,
    ko,
    pt,
    ru,
    zh,
};

const englishKeys = Object.keys(en);

/**
 * Keys that were already untranslated outside English and Chinese when this
 * test was introduced. The test locks the gap in place rather than widening it:
 * anything not on this list must exist in every locale. Translating these and
 * emptying the list is a standalone cleanup.
 */
const KNOWN_UNTRANSLATED = new Set([
    'audioFormat',
    'audioFormatM4a',
    'audioFormatMp3',
    'audioFormatOpus',
    'downloadAudioOnly',
    'downloadAudioOnlyHint',
    'preferredVideoResolution',
    'preferredVideoResolutionAuto',
    'preferredVideoResolutionDescription',
    'preferredVideoResolutionStrict',
    'preferredVideoResolutionStrictDescription',
    'showAudioDownloadButton',
]);

describe('locale parity', () => {
    it.each(Object.keys(translations))('%s covers every English key', (locale) => {
        const keys = new Set(Object.keys(translations[locale]));
        const missing = englishKeys.filter(
            (key) => !keys.has(key) && !KNOWN_UNTRANSLATED.has(key)
        );
        expect(missing).toEqual([]);
    });

    it.each(Object.keys(translations))('%s defines no key English lacks', (locale) => {
        const english = new Set(englishKeys);
        expect(
            Object.keys(translations[locale]).filter((key) => !english.has(key))
        ).toEqual([]);
    });

    it('has no duplicate English keys after object construction', () => {
        expect(new Set(englishKeys).size).toBe(englishKeys.length);
    });

    /**
     * Guards the collection-as-show flow specifically: these keys were added
     * across ten files in one change, which is exactly where a locale is missed.
     */
    it('defines every collection-as-show key in every locale', () => {
        const showKeys = englishKeys.filter((key) => key.startsWith('collectionShow'));
        expect(showKeys.length).toBeGreaterThan(0);

        for (const [locale, table] of Object.entries(translations)) {
            for (const key of showKeys) {
                expect(table[key], `${locale} is missing ${key}`).toBeTruthy();
            }
        }
    });
});
