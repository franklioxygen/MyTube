import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import React, { createContext, ReactNode, useContext } from 'react';
import { useAuth } from './AuthContext';

const API_URL = import.meta.env.VITE_API_URL;



interface VisitorModeContextType {
    visitorMode: boolean;
    isLoading: boolean;
}

const VisitorModeContext = createContext<VisitorModeContextType>({
    visitorMode: false,
    isLoading: true,
});


export const VisitorModeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { userRole } = useAuth();
    const { data: settingsData, isLoading } = useQuery({
        queryKey: ['settings'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/settings`);
            return response.data;
        },
        refetchInterval: 30000, // Refetch every 30 seconds (reduced frequency)
        staleTime: 10000, // Consider data fresh for 10 seconds
        gcTime: 10 * 60 * 1000, // Garbage collect after 10 minutes
    });

    // Visitor mode is active if enabled in settings AND user is not an admin
    const visitorMode = settingsData?.visitorMode === true && userRole !== 'admin';

    return (
        <VisitorModeContext.Provider value={{ visitorMode, isLoading }}>
            {children}
        </VisitorModeContext.Provider>
    );
};

export const useVisitorMode = () => {
    const context = useContext(VisitorModeContext);
    if (!context) {
        throw new Error('useVisitorMode must be used within a VisitorModeProvider');
    }
    return context;
};

