import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import React, { createContext, useContext, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL;

interface AuthContextType {
    isAuthenticated: boolean;
    loginRequired: boolean;
    checkingAuth: boolean;
    userRole: 'admin' | 'visitor' | null;
    login: (token?: string, role?: 'admin' | 'visitor') => void;
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
                const response = await axios.get(`${API_URL}/settings`);
                const { loginEnabled, isPasswordSet } = response.data;

                // Login is required if loginEnabled is true (regardless of password or passkey)
                if (!loginEnabled || !isPasswordSet) {
                    setLoginRequired(false);
                    setIsAuthenticated(true);
                } else {
                    setLoginRequired(true);
                    // Check if already authenticated in this session
                    const sessionAuth = sessionStorage.getItem('mytube_authenticated');
                    if (sessionAuth === 'true') {
                        setIsAuthenticated(true);
                        // Restore role from session storage
                        const storedRole = sessionStorage.getItem('mytube_role');
                        if (storedRole === 'admin' || storedRole === 'visitor') {
                            setUserRole(storedRole);
                        }
                        // Restore token header
                        const token = sessionStorage.getItem('mytube_token');
                        if (token) {
                            axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
                        }
                    } else {
                        setIsAuthenticated(false);
                        setUserRole(null);
                    }
                }
                return response.data;
            } catch (error) {
                console.error('Error checking auth settings:', error);
                return null;
            }
        }
    });

    const login = (token?: string, role?: 'admin' | 'visitor') => {
        setIsAuthenticated(true);
        sessionStorage.setItem('mytube_authenticated', 'true');

        if (token) {
            sessionStorage.setItem('mytube_token', token);
            axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        }

        if (role) {
            setUserRole(role);
            sessionStorage.setItem('mytube_role', role);
        }
    };

    const logout = () => {
        setIsAuthenticated(false);
        setUserRole(null);
        sessionStorage.removeItem('mytube_authenticated');
        sessionStorage.removeItem('mytube_token');
        sessionStorage.removeItem('mytube_role');
        delete axios.defaults.headers.common['Authorization'];
        queryClient.invalidateQueries({ queryKey: ['authSettings'] });
    };

    return (
        <AuthContext.Provider value={{ isAuthenticated, loginRequired, checkingAuth, userRole, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
