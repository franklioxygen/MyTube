import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import VERSION from './version';

import ConsoleManager from './utils/consoleManager';
import { registerVitePreloadErrorRecovery } from './utils/lazyWithRetry';

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
