import { hasAnyAxiosStatus } from '../utils/errors';
import { useQueryClient } from '@tanstack/react-query';
import { CssBaseline, GlobalStyles, ThemeProvider as MuiThemeProvider, PaletteMode, useMediaQuery } from '@mui/material';
import React, { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useState } from 'react';
import getTheme from '../theme';
import { applyThemeCssVariables } from '../theme/cssVariables';
import { api } from '../utils/apiClient';
import { authSettingsQueryOptions, fetchReadableSettings } from '../utils/settingsQueries';
import type { AuthSettingsResponse } from '../utils/settingsQueries';

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

const canPersistThemePreference = (authSettings?: AuthSettingsResponse | null) => {
    if (!authSettings) {
        return true;
    }

    return authSettings.loginRequired === false || authSettings.authenticatedRole === 'admin';
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
    const queryClient = useQueryClient();

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

    const syncThemePreference = useEffectEvent(async () => {
        try {
            const settings = await fetchReadableSettings(queryClient, { forceRefresh: true });
            if (!settings || settings.theme === undefined) {
                return;
            }

            const backendTheme = normalizeThemePreference(settings.theme);
            setPreferenceState(backendTheme);
            localStorage.setItem('themeMode', backendTheme);
        } catch (error: unknown) {
            // Silently handle auth-related failures when not authenticated
            if (!hasAnyAxiosStatus(error, [401, 403])) {
                console.error('Error fetching settings for theme:', error);
            }
        }
    });

    // Fetch settings on mount
    useEffect(() => {
        syncThemePreference();
    }, [queryClient, syncThemePreference]);

    // Listen for login events to refetch
    useEffect(() => {
        const onLogin = () => syncThemePreference();
        window.addEventListener('mytube-login', onLogin);
        return () => window.removeEventListener('mytube-login', onLogin);
    }, [queryClient, syncThemePreference]);

    const setPreference = useCallback(async (newPreference: ThemePreference) => {
        const normalizedPreference = normalizeThemePreference(newPreference);
        setPreferenceState(normalizedPreference);
        localStorage.setItem('themeMode', normalizedPreference);

        const authSettings = queryClient.getQueryData<AuthSettingsResponse | null>(authSettingsQueryOptions.queryKey);
        if (!canPersistThemePreference(authSettings)) {
            return;
        }

        // Sync with backend
        try {
            await api.patch('/settings', {
                theme: normalizedPreference
            });
        } catch (error: unknown) {
            if (!hasAnyAxiosStatus(error, [401, 403])) {
                console.error('Error saving theme setting:', error);
            }
        }
    }, [queryClient]);

    const mode: PaletteMode = useMemo(() => {
        if (preference === 'system') {
            return systemPrefersDark ? 'dark' : 'light';
        }
        return preference;
    }, [preference, systemPrefersDark]);

    useEffect(() => {
        document.documentElement.style.colorScheme = mode;
        document.documentElement.dataset.theme = mode;
        applyThemeCssVariables(mode);
    }, [mode]);

    const toggleTheme = useCallback(() => {
        setPreference(mode === 'light' ? 'dark' : 'light');
    }, [setPreference, mode]);

    const theme = useMemo(() => getTheme(mode), [mode]);

    const contextValue = useMemo<ThemeContextType>(() => ({
        mode, preference, setPreference, toggleTheme,
    }), [mode, preference, setPreference, toggleTheme]);

    return (
        <ThemeContext.Provider value={contextValue}>
            <MuiThemeProvider theme={theme}>
                <CssBaseline />
                {/*
                 * Respect the user's "reduce motion" OS setting: near-instant
                 * CSS transitions/animations app-wide for motion-sensitive users.
                 * Framer Motion animations are handled separately via useReducedMotion.
                 */}
                <GlobalStyles
                    styles={{
                        '@media (prefers-reduced-motion: reduce)': {
                            '*, *::before, *::after': {
                                animationDuration: '0.01ms !important',
                                animationIterationCount: '1 !important',
                                transitionDuration: '0.01ms !important',
                                scrollBehavior: 'auto !important',
                            },
                        },
                    }}
                />
                {children}
            </MuiThemeProvider>
        </ThemeContext.Provider>
    );
};
