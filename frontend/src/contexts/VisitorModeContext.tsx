import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';

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
    const { data: settingsData, isLoading } = useQuery({
        queryKey: ['settings'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/settings`);
            return response.data;
        },
        refetchInterval: 5000, // Refetch every 5 seconds to keep visitor mode state in sync
    });

    const visitorMode = settingsData?.visitorMode === true;

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

