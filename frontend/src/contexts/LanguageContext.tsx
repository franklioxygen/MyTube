import axios from 'axios';
import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { Language, TranslationKey, translations } from '../utils/translations';

const API_URL = import.meta.env.VITE_API_URL;

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

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            const response = await axios.get(`${API_URL}/settings`);
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
        } catch (error) {
            console.error('Error fetching settings for language:', error);
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
        
        try {
            // We need to fetch current settings first to not overwrite other settings
            // Or ideally the backend supports partial updates, but our controller expects full object usually
            // Let's fetch first to be safe
            const response = await axios.get(`${API_URL}/settings`);
            const currentSettings = response.data;

            await axios.post(`${API_URL}/settings`, {
                ...currentSettings,
                language: lang
            });
        } catch (error) {
            console.error('Error saving language setting:', error);
        }
    };

    const t = (key: TranslationKey, replacements?: Record<string, string | number>): string => {
        let text = (translations[language] as any)[key] || key;
        if (replacements) {
            Object.entries(replacements).forEach(([placeholder, value]) => {
                text = text.replace(`{${placeholder}}`, String(value));
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

export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (context === undefined) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
};
