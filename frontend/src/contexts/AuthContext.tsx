import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import React, { createContext, useContext, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL;

interface AuthContextType {
    isAuthenticated: boolean;
    loginRequired: boolean;
    checkingAuth: boolean;
    login: () => void;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
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

                // Login is required only if enabled AND a password is set
                if (!loginEnabled || !isPasswordSet) {
                    setLoginRequired(false);
                    setIsAuthenticated(true);
                } else {
                    setLoginRequired(true);
                    // Check if already authenticated in this session
                    const sessionAuth = sessionStorage.getItem('mytube_authenticated');
                    if (sessionAuth === 'true') {
                        setIsAuthenticated(true);
                    } else {
                        setIsAuthenticated(false);
                    }
                }
                return response.data;
            } catch (error) {
                console.error('Error checking auth settings:', error);
                return null;
            }
        }
    });

    const login = () => {
        setIsAuthenticated(true);
        sessionStorage.setItem('mytube_authenticated', 'true');
    };

    const logout = () => {
        setIsAuthenticated(false);
        sessionStorage.removeItem('mytube_authenticated');
        queryClient.invalidateQueries({ queryKey: ['authSettings'] });
    };

    return (
        <AuthContext.Provider value={{ isAuthenticated, loginRequired, checkingAuth, login, logout }}>
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
