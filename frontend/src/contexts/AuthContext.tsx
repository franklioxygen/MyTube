import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useContext, useState } from 'react';
import { api } from '../utils/apiClient';

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
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
    const [userRole, setUserRole] = useState<'admin' | 'visitor' | null>(null);
    const [loginRequired, setLoginRequired] = useState<boolean>(true); // Assume required until checked
    const queryClient = useQueryClient();

    // Check login settings and authentication status
    const { isLoading: checkingAuth } = useQuery({
        queryKey: ['authSettings'],
        queryFn: async () => {
            try {
                // Public endpoint: returns whether login is required and (if session exists) the authenticated role.
                const response = await api.get('/settings/password-enabled');
                const { loginRequired, authenticatedRole } = response.data ?? {};
                const requiresLogin = loginRequired !== false;
                setLoginRequired(requiresLogin);

                if (!requiresLogin) {
                    setIsAuthenticated(true);
                    setUserRole(
                        authenticatedRole === 'admin' || authenticatedRole === 'visitor'
                            ? authenticatedRole
                            : null
                    );
                    return response.data;
                }

                if (authenticatedRole === 'admin' || authenticatedRole === 'visitor') {
                    setIsAuthenticated(true);
                    setUserRole(authenticatedRole);
                } else {
                    setIsAuthenticated(false);
                    setUserRole(null);
                }

                return response.data;
            } catch (error: any) {
                // Handle 429 errors (rate limited) without overriding current auth state
                if (error?.response?.status === 429) {
                    setLoginRequired(true);
                    return null;
                }
                // Treat unexpected auth probe failures as unauthenticated
                if (error?.response?.status === 401 || error?.response?.status === 403) {
                    setLoginRequired(true);
                    setIsAuthenticated(false);
                    setUserRole(null);
                    return null;
                }
                // For other errors, log but don't break the flow
                console.error('Error checking auth settings:', error);
                return null;
            }
        },
        retry: (failureCount, error: any) => {
            // Don't retry on expected auth probe statuses
            if (error?.response?.status === 401 || error?.response?.status === 403 || error?.response?.status === 429) {
                return false;
            }
            // Retry other errors once
            return failureCount < 1;
        },
        // Add staleTime to prevent unnecessary refetches on page reload
        staleTime: 30 * 1000, // Consider data fresh for 30 seconds
        gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    });

    const login = (role?: 'admin' | 'visitor') => {
        setIsAuthenticated(true);
        if (role) {
            setUserRole(role);
        }
        // Notify LanguageContext to refetch settings (e.g. so language persists in new browser)
        window.dispatchEvent(new CustomEvent('mytube-login'));
        // Token is now stored in HTTP-only cookie by backend, no need to store it here
    };

    const logout = async () => {
        // Clear local state immediately
        setIsAuthenticated(false);
        setUserRole(null);

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
