import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import VERSION from './version';

import ConsoleManager from './utils/consoleManager';
import { registerVitePreloadErrorRecovery } from './utils/lazyWithRetry';

const resolveInitialThemeMode = () => {
    const savedPreference = localStorage.getItem('themeMode');
    if (savedPreference === 'light' || savedPreference === 'dark') {
        return savedPreference;
    }

    const prefersDark = typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
};

const initializeThemeAttributes = () => {
    const mode = resolveInitialThemeMode();
    document.documentElement.style.colorScheme = mode;
    document.documentElement.dataset.theme = mode;
};

initializeThemeAttributes();

// Initialize console manager
ConsoleManager.init();
registerVitePreloadErrorRecovery();

// Display version information
VERSION.displayVersion();

const rootElement = document.getElementById('root');
if (rootElement) {
    createRoot(rootElement).render(
        <StrictMode>
            <App />
        </StrictMode>,
    );
}
