import { CssBaseline, ThemeProvider as MuiThemeProvider, PaletteMode, useMediaQuery } from '@mui/material';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import getTheme from '../theme';
import { api } from '../utils/apiClient';

export type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeContextType {
    mode: PaletteMode;
    preference: ThemePreference;
    setPreference: (preference: ThemePreference) => Promise<void>;
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const normalizeThemePreference = (value: unknown): ThemePreference => {
    switch (value) {
        case 'light':
            return 'light';
        case 'dark':
            return 'dark';
        case 'system':
            return 'system';
        default:
            return 'system';
    }
};

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
        if (savedMode !== null) {
            return normalizeThemePreference(savedMode);
        }
        // Migration: if it was previously just 'light' or 'dark' in storage (from old code), it's handled above.
        // If nothing is in storage, default to system.
        return 'system';
    });

    const fetchSettings = async () => {
        try {
            const statusResponse = await api.get('/settings/password-enabled');
            const authenticatedRole = statusResponse.data?.authenticatedRole;
            const canReadSettings =
                statusResponse.data?.loginRequired === false ||
                authenticatedRole === 'admin' ||
                authenticatedRole === 'visitor';

            if (!canReadSettings) {
                return;
            }

            const response = await api.get('/settings');
            if (response.data?.theme !== undefined) {
                const backendTheme = normalizeThemePreference(response.data.theme);
                setPreferenceState(backendTheme);
                localStorage.setItem('themeMode', backendTheme);
            }
        } catch (error: any) {
            // Silently handle auth-related failures when not authenticated
            if (error?.response?.status !== 401 && error?.response?.status !== 403) {
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
        const normalizedPreference = normalizeThemePreference(newPreference);
        setPreferenceState(normalizedPreference);
        localStorage.setItem('themeMode', normalizedPreference);

        // Sync with backend
        try {
            await api.patch('/settings', {
                theme: normalizedPreference
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
