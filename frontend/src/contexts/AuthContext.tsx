import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import React, { createContext, useContext, useState } from 'react';
import { getApiUrl } from '../utils/apiUrl';

const API_URL = getApiUrl();

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
                // Check if login is enabled in settings
                const response = await axios.get(`${API_URL}/settings`, {
                    withCredentials: true
                });
                const { loginEnabled, isPasswordSet } = response.data;

                // Login is required if loginEnabled is true (regardless of password or passkey)
                if (!loginEnabled || !isPasswordSet) {
                    setLoginRequired(false);
                    setIsAuthenticated(true);
                } else {
                    setLoginRequired(true);
                    // Check if already authenticated via HTTP-only cookie
                    // Read role from cookie (non-HTTP-only cookie set by backend)
                    const roleCookie = document.cookie
                        .split('; ')
                        .find(row => row.startsWith('mytube_role='));

                    if (roleCookie) {
                        const role = roleCookie.split('=')[1] as 'admin' | 'visitor';
                        if (role === 'admin' || role === 'visitor') {
                            setIsAuthenticated(true);
                            setUserRole(role);
                        } else {
                            setIsAuthenticated(false);
                            setUserRole(null);
                        }
                    } else {
                        // No role cookie means not authenticated
                        setIsAuthenticated(false);
                        setUserRole(null);
                    }
                }
                return response.data;
            } catch (error: any) {
                // Handle 401 errors (expected when not authenticated)
                if (error?.response?.status === 401) {
                    setLoginRequired(true);
                    setIsAuthenticated(false);
                    setUserRole(null);
                    return null;
                }
                // Handle 429 errors (rate limited) - use cached cookie state if available
                if (error?.response?.status === 429) {
                    // Check cookie to determine auth state without making another request
                    const roleCookie = document.cookie
                        .split('; ')
                        .find(row => row.startsWith('mytube_role='));

                    if (roleCookie) {
                        const role = roleCookie.split('=')[1] as 'admin' | 'visitor';
                        if (role === 'admin' || role === 'visitor') {
                            setIsAuthenticated(true);
                            setUserRole(role);
                            setLoginRequired(true);
                        } else {
                            setIsAuthenticated(false);
                            setUserRole(null);
                            setLoginRequired(true);
                        }
                    } else {
                        setIsAuthenticated(false);
                        setUserRole(null);
                        setLoginRequired(true);
                    }
                    return null;
                }
                // For other errors, log but don't break the flow
                console.error('Error checking auth settings:', error);
                return null;
            }
        },
        retry: (failureCount, error: any) => {
            // Don't retry on 401 or 429 errors
            if (error?.response?.status === 401 || error?.response?.status === 429) {
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
        // Token is now stored in HTTP-only cookie by backend, no need to store it here
    };

    const logout = async () => {
        // Clear local state immediately
        setIsAuthenticated(false);
        setUserRole(null);

        // Clear role cookie from frontend (it's not HTTP-only, so we can clear it)
        // This prevents the auth check from seeing the cookie before backend clears it
        document.cookie = 'mytube_role=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';

        try {
            // Call backend logout endpoint to clear HTTP-only cookies
            await axios.post(`${API_URL}/settings/logout`, {}, {
                withCredentials: true
            });
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
