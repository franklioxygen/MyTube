import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { defaultTranslations, Language, loadLocale, TranslationKey } from '../utils/translations';
import { api } from '../utils/apiClient';

interface LanguageContextType {
    language: Language;
    setLanguage: (lang: Language) => Promise<void>;
    t: (key: TranslationKey, replacements?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const LANGUAGE_STORAGE_KEY = 'mytube_language';

// Helper function to get language from localStorage
const getStoredLanguage = (): Language => {
    try {
        const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (stored && ['en', 'zh', 'es', 'de', 'ja', 'fr', 'ko', 'ar', 'pt', 'ru'].includes(stored)) {
            return stored as Language;
        }
    } catch (error) {
        console.error('Error reading language from localStorage:', error);
    }
    return 'en';
};

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // Initialize from localStorage first for immediate language display
    const [language, setLanguageState] = useState<Language>(getStoredLanguage());
    const [translations, setTranslations] = useState<any>(defaultTranslations);

    useEffect(() => {
        const load = async () => {
            const loadedTranslations = await loadLocale(language);
            setTranslations(loadedTranslations);
        };
        load();
    }, [language]);

    // Always try to fetch settings on mount so language persists across browsers
    // (backend returns language when login is disabled, or when cookies are sent)
    useEffect(() => {
        fetchSettings();
    }, []);

    // Refetch settings when user logs in (e.g. opening app in another browser)
    useEffect(() => {
        const onLogin = () => fetchSettings();
        window.addEventListener('mytube-login', onLogin);
        return () => window.removeEventListener('mytube-login', onLogin);
    }, []);

    const fetchSettings = async () => {
        try {
            const response = await api.get('/settings');
            if (response.data.language) {
                const backendLanguage = response.data.language as Language;
                setLanguageState(backendLanguage);
                // Sync localStorage with backend
                try {
                    localStorage.setItem(LANGUAGE_STORAGE_KEY, backendLanguage);
                } catch (error) {
                    console.error('Error saving language to localStorage:', error);
                }
            }
        } catch (error: any) {
            // Silently handle 401 errors (expected when not authenticated)
            if (error?.response?.status !== 401) {
                console.error('Error fetching settings for language:', error);
            }
            // If backend fails, keep using localStorage value
        }
    };

    const setLanguage = async (lang: Language) => {
        setLanguageState(lang);
        // Save to localStorage immediately for instant UI update
        try {
            localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
        } catch (error) {
            console.error('Error saving language to localStorage:', error);
        }

        // Always try to save to backend so language persists across browsers
        // (backend accepts when login is disabled, or when cookies are sent; 401 is ignored)
        try {
            await api.patch('/settings', { language: lang });
        } catch (error: any) {
            // Silently handle 401 errors (expected when not authenticated)
            // Language is already saved to localStorage, so UI will update correctly
            if (error?.response?.status !== 401) {
                console.error('Error saving language setting:', error);
            }
        }
    };

    const t = (key: TranslationKey, replacements?: Record<string, string | number>): string => {
        let text = translations[key] || key;
        if (replacements) {
            Object.entries(replacements).forEach(([placeholder, value]) => {
                // Replace all occurrences of the placeholder
                const placeholderPattern = `{${placeholder}}`;
                const valueStr = String(value);
                // Use replaceAll if available (ES2021+), otherwise use while loop
                if (typeof text.replaceAll === 'function') {
                    text = text.replaceAll(placeholderPattern, valueStr);
                } else {
                    // Fallback for older browsers
                    while (text.includes(placeholderPattern)) {
                        text = text.replace(placeholderPattern, valueStr);
                    }
                }
            });
        }
        return text;
    };

    return (
        <LanguageContext.Provider value={{ language, setLanguage, t }}>
            {children}
        </LanguageContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (context === undefined) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
};
