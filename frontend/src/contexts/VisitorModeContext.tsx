import React, { createContext, ReactNode, useContext } from 'react';
import { useAuth } from './AuthContext';

/**
 * @deprecated This context is kept for backward compatibility.
 * Permission control is now based on userRole from AuthContext.
 * Use `useAuth().userRole === 'visitor'` instead of `useVisitorMode().visitorMode`.
 */
interface VisitorModeContextType {
    visitorMode: boolean;
    isLoading: boolean;
}

const VisitorModeContext = createContext<VisitorModeContextType>({
    visitorMode: false,
    isLoading: false,
});

/**
 * @deprecated Use useAuth().userRole === 'visitor' instead
 */
export const VisitorModeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { userRole, checkingAuth } = useAuth();

    // Visitor mode is now based solely on userRole
    // No longer depends on settings.visitorMode
    const visitorMode = userRole === 'visitor';
    const isLoading = checkingAuth;

    return (
        <VisitorModeContext.Provider value={{ visitorMode, isLoading }}>
            {children}
        </VisitorModeContext.Provider>
    );
};

/**
 * @deprecated Use useAuth().userRole === 'visitor' instead
 */
export const useVisitorMode = () => {
    const context = useContext(VisitorModeContext);
    if (!context) {
        throw new Error('useVisitorMode must be used within a VisitorModeProvider');
    }
    return context;
};

