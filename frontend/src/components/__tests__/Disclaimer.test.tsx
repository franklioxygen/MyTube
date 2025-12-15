import { createTheme, ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '../../utils/locales/en';
import Disclaimer from '../Disclaimer';

describe('Disclaimer', () => {
    it('renders disclaimer title and text', () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <Disclaimer />
            </ThemeProvider>
        );

        expect(screen.getByText(en.disclaimerTitle)).toBeInTheDocument();
        // Disclaimer text has newlines, so check for key parts instead
        expect(screen.getByText(/Purpose and Restrictions/i)).toBeInTheDocument();
        expect(screen.getByText(/Liability/i)).toBeInTheDocument();
    });

    it('renders with proper styling structure', () => {
        const theme = createTheme();
        const { container } = render(
            <ThemeProvider theme={theme}>
                <Disclaimer />
            </ThemeProvider>
        );

        // Should render Paper component
        const paper = container.querySelector('.MuiPaper-root');
        expect(paper).toBeInTheDocument();
    });
});

