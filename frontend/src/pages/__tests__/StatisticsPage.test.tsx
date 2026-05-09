import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StatisticsPage from '../StatisticsPage';
import { api } from '../../utils/apiClient';

let mockSettings = { statisticsEnabled: false };
let mockAuth = { userRole: 'admin', loginRequired: true };

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => key,
    }),
}));

vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => mockAuth,
}));

vi.mock('../../hooks/useSettings', () => ({
    useSettings: () => ({
        data: mockSettings,
    }),
}));

vi.mock('../../hooks/useStatistics', () => ({
    useStatisticsOverview: () => ({
        data: {
            totalVideos: 12,
            totalStorageBytes: 0,
            activeSubscriptions: 3,
            pausedSubscriptions: 0,
            activeRssTokens: 1,
            collectionCoverage: 0,
            subtitleCoverage: 0,
            thumbnailCoverage: 0,
            downloadSuccessRate: 0.75,
            downloadVolumeBytes: 0,
            netNewVideos: 2,
            watchSecondsLastRange: 3600,
            diskRunway: {
                status: 'ok',
                daysRemaining: 12.8,
            },
            alerts: [],
        },
        isLoading: false,
    }),
    useStatisticsHealth: () => ({
        data: {
            rollup: { running: false, lastRunAt: null },
            dirtyDayCount: 0,
            sealedDayCount: 0,
            trailingHour: { accepted: 0, dropped: 0, error: 0, sealedDayDrop: 0 },
            warning: false,
        },
    }),
    useStatisticsTimeseries: () => ({
        data: [],
        isLoading: false,
    }),
    useStatisticsRanking: () => ({
        data: [],
        isLoading: false,
    }),
}));

vi.mock('../../utils/apiClient', () => ({
    api: {
        get: vi.fn(),
        delete: vi.fn(),
        post: vi.fn(),
    },
}));

describe('StatisticsPage', () => {
    beforeEach(() => {
        mockSettings = { statisticsEnabled: false };
        mockAuth = { userRole: 'admin', loginRequired: true };
        vi.mocked(api.get).mockReset();
        vi.mocked(api.get).mockResolvedValue({ data: new Blob(['ok']) } as any);
        vi.stubGlobal('confirm', vi.fn(() => true));
        Object.defineProperty(URL, 'createObjectURL', {
            writable: true,
            value: vi.fn(() => 'blob:statistics'),
        });
        Object.defineProperty(URL, 'revokeObjectURL', {
            writable: true,
            value: vi.fn(),
        });
    });

    it('keeps historical statistics visible when collection is disabled', () => {
        const queryClient = new QueryClient();

        render(
            <QueryClientProvider client={queryClient}>
                <StatisticsPage />
            </QueryClientProvider>
        );

        expect(screen.getByText('statisticsDisabledKeepVisibleNotice')).toBeInTheDocument();
        expect(screen.getByText('12')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText('diskRunway')).toBeInTheDocument();
        expect(screen.getByText('12 days')).toBeInTheDocument();
    });

    it('exports the current dashboard range from the statistics page', async () => {
        const queryClient = new QueryClient();
        const clickSpy = vi
            .spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation(() => {});

        render(
            <QueryClientProvider client={queryClient}>
                <StatisticsPage />
            </QueryClientProvider>
        );

        fireEvent.click(screen.getByRole('button', { name: 'exportCsv' }));

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledWith(
                '/statistics/export?format=csv&view=dashboard&range=30',
                expect.objectContaining({
                    responseType: 'blob',
                })
            );
        });

        clickSpy.mockRestore();
    });
});
