import { CssBaseline, ThemeProvider as MuiThemeProvider, PaletteMode, useMediaQuery } from '@mui/material';
import axios from 'axios';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import getTheme from '../theme';
import { getApiUrl } from '../utils/apiUrl';

export type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeContextType {
    mode: PaletteMode;
    preference: ThemePreference;
    setPreference: (preference: ThemePreference) => Promise<void>;
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
const API_URL = getApiUrl();

// eslint-disable-next-line react-refresh/only-export-components
export const useThemeContext = () => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useThemeContext must be used within a ThemeContextProvider');
    }
    return context;
};

export const ThemeContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)');

    // Initialize preference from localStorage, defaulting to 'system'
    const [preference, setPreferenceState] = useState<ThemePreference>(() => {
        const savedMode = localStorage.getItem('themeMode');
        if (savedMode === 'light' || savedMode === 'dark' || savedMode === 'system') {
            return savedMode as ThemePreference;
        }
        // Migration: if it was previously just 'light' or 'dark' in storage (from old code), it's handled above.
        // If nothing is in storage, default to system.
        return 'system';
    });

    const fetchSettings = async () => {
        try {
            const response = await axios.get(`${API_URL}/settings`);
            if (response.data.theme) {
                const backendTheme = response.data.theme as ThemePreference;
                setPreferenceState(backendTheme);
                localStorage.setItem('themeMode', backendTheme);
            }
        } catch (error: any) {
            // Silently handle 401 errors or other fetch failures
            if (error?.response?.status !== 401) {
                console.error('Error fetching settings for theme:', error);
            }
        }
    };

    // Fetch settings on mount
    useEffect(() => {
        fetchSettings();
    }, []);

    // Listen for login events to refetch
    useEffect(() => {
        const onLogin = () => fetchSettings();
        window.addEventListener('mytube-login', onLogin);
        return () => window.removeEventListener('mytube-login', onLogin);
    }, []);

    const setPreference = async (newPreference: ThemePreference) => {
        setPreferenceState(newPreference);
        localStorage.setItem('themeMode', newPreference);

        // Sync with backend
        try {
            // Fetch current settings first to merge
            const response = await axios.get(`${API_URL}/settings`);
            const currentSettings = response.data;

            await axios.post(`${API_URL}/settings`, {
                ...currentSettings,
                theme: newPreference
            });
        } catch (error: any) {
            if (error?.response?.status !== 401) {
                console.error('Error saving theme setting:', error);
            }
        }
    };

    const mode: PaletteMode = useMemo(() => {
        if (preference === 'system') {
            return systemPrefersDark ? 'dark' : 'light';
        }
        return preference;
    }, [preference, systemPrefersDark]);

    const toggleTheme = () => {
        setPreference(mode === 'light' ? 'dark' : 'light');
    };

    const theme = useMemo(() => getTheme(mode), [mode]);

    return (
        <ThemeContext.Provider value={{ mode, preference, setPreference, toggleTheme }}>
            <MuiThemeProvider theme={theme}>
                <CssBaseline />
                {children}
            </MuiThemeProvider>
        </ThemeContext.Provider>
    );
};
