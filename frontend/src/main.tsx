import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import VERSION from './version';

import { SnackbarProvider } from './contexts/SnackbarContext';

// Display version information
VERSION.displayVersion();

const rootElement = document.getElementById('root');
if (rootElement) {
    createRoot(rootElement).render(
        <StrictMode>
            <SnackbarProvider>
                <App />
            </SnackbarProvider>
        </StrictMode>,
    );
}
