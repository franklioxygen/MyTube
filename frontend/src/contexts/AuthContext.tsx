import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useContext, useEffect } from 'react';
import { api } from '../utils/apiClient';
import { authSettingsQueryOptions } from '../utils/settingsQueries';

interface AuthContextType {
    isAuthenticated: boolean;
    loginRequired: boolean;
    checkingAuth: boolean;
    userRole: 'admin' | 'visitor' | null;
    login: (role?: 'admin' | 'visitor') => void;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const queryClient = useQueryClient();

    const {
        data: authSettings,
        error: authSettingsError,
        isLoading: checkingAuth
    } = useQuery(authSettingsQueryOptions);

    const authenticatedRole =
        authSettings?.authenticatedRole === 'admin' || authSettings?.authenticatedRole === 'visitor'
            ? authSettings.authenticatedRole
            : null;
    const loginRequired = authSettings?.loginRequired !== false;
    const isAuthenticated = !loginRequired || authenticatedRole !== null;
    const userRole = authenticatedRole;

    useEffect(() => {
        if (!authSettingsError) {
            return;
        }

        console.error('Error checking auth settings:', authSettingsError);
    }, [authSettingsError]);

    const login = (role?: 'admin' | 'visitor') => {
        queryClient.setQueryData(authSettingsQueryOptions.queryKey, (current: any) => ({
            ...(current ?? {}),
            loginRequired: current?.loginRequired ?? true,
            authenticatedRole: role ?? current?.authenticatedRole ?? 'admin'
        }));
        // Notify LanguageContext to refetch settings (e.g. so language persists in new browser)
        window.dispatchEvent(new CustomEvent('mytube-login'));
        // Token is now stored in HTTP-only cookie by backend, no need to store it here
    };

    const logout = async () => {
        queryClient.setQueryData(authSettingsQueryOptions.queryKey, (current: any) => ({
            ...(current ?? {}),
            loginRequired: current?.loginRequired ?? true,
            authenticatedRole: null
        }));

        try {
            // Call backend logout endpoint to clear HTTP-only cookies
            await api.post('/settings/logout', {});
        } catch (error) {
            console.error('Error during logout:', error);
            // Continue with logout even if backend call fails
        }

        // Invalidate and refetch auth settings to ensure fresh auth state
        queryClient.invalidateQueries({ queryKey: ['authSettings'] });
        queryClient.refetchQueries({ queryKey: ['authSettings'] });
    };

    return (
        <AuthContext.Provider value={{ isAuthenticated, loginRequired, checkingAuth, userRole, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
