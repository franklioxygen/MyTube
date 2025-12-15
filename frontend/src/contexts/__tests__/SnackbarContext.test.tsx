import { createTheme, ThemeProvider } from '@mui/material/styles';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SNACKBAR_AUTO_HIDE_DURATION } from '../../utils/constants';
import { SnackbarProvider, useSnackbar } from '../SnackbarContext';

// Component to test the hook
const TestComponent = () => {
    const { showSnackbar } = useSnackbar();

    return (
        <div>
            <button onClick={() => showSnackbar('Test message')}>Show Success</button>
            <button onClick={() => showSnackbar('Error message', 'error')}>Show Error</button>
            <button onClick={() => showSnackbar('Warning message', 'warning')}>Show Warning</button>
            <button onClick={() => showSnackbar('Info message', 'info')}>Show Info</button>
        </div>
    );
};

describe('SnackbarContext', () => {

    it('should throw error when used outside provider', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        const TestComponent = () => {
            useSnackbar();
            return <div>Test</div>;
        };

        expect(() => {
            render(<TestComponent />);
        }).toThrow('useSnackbar must be used within a SnackbarProvider');

        consoleSpy.mockRestore();
    });

    it('should show snackbar with default success severity', async () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <SnackbarProvider>
                    <TestComponent />
                </SnackbarProvider>
            </ThemeProvider>
        );

        const button = screen.getByText('Show Success');
        await act(async () => {
            button.click();
        });

        await waitFor(() => {
            expect(screen.getByText('Test message')).toBeInTheDocument();
        });

        // Check that it's a success alert
        const alert = screen.getByRole('alert');
        expect(alert).toBeInTheDocument();
    });

    it('should show snackbar with error severity', async () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <SnackbarProvider>
                    <TestComponent />
                </SnackbarProvider>
            </ThemeProvider>
        );

        const button = screen.getByText('Show Error');
        await act(async () => {
            button.click();
        });

        await waitFor(() => {
            expect(screen.getByText('Error message')).toBeInTheDocument();
        });
    });

    it('should show snackbar with warning severity', async () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <SnackbarProvider>
                    <TestComponent />
                </SnackbarProvider>
            </ThemeProvider>
        );

        const button = screen.getByText('Show Warning');
        await act(async () => {
            button.click();
        });

        await waitFor(() => {
            expect(screen.getByText('Warning message')).toBeInTheDocument();
        });
    });

    it('should show snackbar with info severity', async () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <SnackbarProvider>
                    <TestComponent />
                </SnackbarProvider>
            </ThemeProvider>
        );

        const button = screen.getByText('Show Info');
        await act(async () => {
            button.click();
        });

        await waitFor(() => {
            expect(screen.getByText('Info message')).toBeInTheDocument();
        });
    });

    it('should auto-hide snackbar after duration', { timeout: 15000 }, async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame'] });

        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <SnackbarProvider>
                    <TestComponent />
                </SnackbarProvider>
            </ThemeProvider>
        );

        const button = screen.getByText('Show Success');
        await act(async () => {
            button.click();
        });

        expect(screen.getByText('Test message')).toBeInTheDocument();

        // Fast-forward time
        await act(async () => {
            vi.advanceTimersByTime(SNACKBAR_AUTO_HIDE_DURATION + 2000);
        });

        expect(screen.queryByText('Test message')).not.toBeVisible();
    });
});
