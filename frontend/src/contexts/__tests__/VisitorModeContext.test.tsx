import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VisitorModeProvider, useVisitorMode } from '../VisitorModeContext';

// Mock dependencies
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

const TestComponent = () => {
    const { visitorMode, isLoading } = useVisitorMode();
    if (isLoading) return <div>Loading...</div>;
    return <div data-testid="visitor-mode">{visitorMode ? 'Enabled' : 'Disabled'}</div>;
};

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: false,
        },
    },
});

const renderWithProviders = (ui: React.ReactNode) => {
    return render(
        <QueryClientProvider client={queryClient}>
            <VisitorModeProvider>
                {ui}
            </VisitorModeProvider>
        </QueryClientProvider>
    );
};

describe('VisitorModeContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        queryClient.clear();
    });

    it('should fetch visitor mode settings', async () => {
        mockedAxios.get.mockResolvedValueOnce({
            data: { visitorMode: true }
        });

        renderWithProviders(<TestComponent />);

        expect(screen.getByText('Loading...')).toBeInTheDocument();

        await waitFor(() => {
            expect(screen.getByTestId('visitor-mode')).toHaveTextContent('Enabled');
        });
    });

    it('should handle visitor mode disabled', async () => {
        mockedAxios.get.mockResolvedValueOnce({
            data: { visitorMode: false }
        });

        renderWithProviders(<TestComponent />);

        await waitFor(() => {
            expect(screen.getByTestId('visitor-mode')).toHaveTextContent('Disabled');
        });
    });

    it('should return default values if used outside provider', () => {
        // The context has a default value, so it doesn't throw, but returns that default.
        // Default: visitorMode: false, isLoading: true

        // We need a component to extract the value
        let contextVal: any;
        const Consumer = () => {
            contextVal = useVisitorMode();
            return null;
        };

        render(<Consumer />);

        expect(contextVal).toBeDefined();
        expect(contextVal.visitorMode).toBe(false);
        expect(contextVal.isLoading).toBe(true);
    });
});
