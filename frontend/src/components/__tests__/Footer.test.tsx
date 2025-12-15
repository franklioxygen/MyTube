import { createTheme, ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Footer from '../Footer';

describe('Footer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders version number', () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <Footer />
            </ThemeProvider>
        );

        // This relies on the environment variable mock in vite.config.js
        // We set it to packageJson.version (1.6.0)
        expect(screen.getByText('v1.6.0')).toBeInTheDocument();
    });

    it('renders GitHub link', () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <Footer />
            </ThemeProvider>
        );

        const link = screen.getByRole('link', { name: /MyTube/i });
        expect(link).toHaveAttribute('href', 'https://github.com/franklioxygen/MyTube');
    });

    it('renders creation text', () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <Footer />
            </ThemeProvider>
        );

        expect(screen.getByText('Created by franklioxygen')).toBeInTheDocument();
    });
});
