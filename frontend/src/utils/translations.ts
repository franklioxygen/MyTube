import { ar } from './locales/ar';
import { de } from './locales/de';
import { en } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { pt } from './locales/pt';
import { ru } from './locales/ru';
import { zh } from './locales/zh';

export const translations = {
    en,
    zh,
    es,
    de,
    ja,
    fr,
    ko,
    ar,
    pt,
    ru
};

export type Language = 'en' | 'zh' | 'es' | 'de' | 'ja' | 'fr' | 'ko' | 'ar' | 'pt' | 'ru';
export type TranslationKey = keyof typeof translations.en;
