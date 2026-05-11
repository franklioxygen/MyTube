import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StatisticsPage from '../StatisticsPage';
import { api } from '../../utils/apiClient';

const renderWithProviders = (queryClient: QueryClient) =>
    render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <StatisticsPage />
            </MemoryRouter>
        </QueryClientProvider>
    );

let mockSettings = { statisticsEnabled: false };
let mockAuth = { userRole: 'admin', loginRequired: true };
let mockOverview = {
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
};
let mockRankingRows: Record<string, Array<{ key: string; label: string; count: number; sum: number }>> = {};

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
        data: mockOverview,
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
    useStatisticsRanking: (metric: string) => ({
        data: mockRankingRows[metric] ?? [],
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
        mockOverview = {
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
        };
        mockRankingRows = {};
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

        renderWithProviders(queryClient);

        expect(
            screen.getByText(
                'Statistics collection is disabled. Existing reports remain available until you clear them.'
            )
        ).toBeInTheDocument();
        expect(screen.getByText('12')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText('Disk runway')).toBeInTheDocument();
        expect(screen.getByText('12 days')).toBeInTheDocument();
        expect(screen.getByText('Sealed-day drops: 0')).toBeInTheDocument();

        const settingsLink = screen.getByRole('link', { name: 'Change in Settings' });
        expect(settingsLink).toHaveAttribute(
            'href',
            '/settings?tab=7#statisticsEnabled-setting'
        );
    });

    it('exports the current dashboard range from the statistics page', async () => {
        const queryClient = new QueryClient();
        const clickSpy = vi
            .spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation(() => {});

        renderWithProviders(queryClient);

        fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

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

    it('renders translated failure bucket labels instead of raw bucket keys', () => {
        const queryClient = new QueryClient();
        mockRankingRows = {
            most_common_failure_buckets: [
                { key: 'auth_required', label: 'auth_required', count: 4, sum: 0 },
                { key: 'source_unavailable', label: 'source_unavailable', count: 3, sum: 0 },
                { key: 'unknown', label: 'unknown', count: 1, sum: 0 },
            ],
        };

        renderWithProviders(queryClient);

        expect(screen.getByText('Authentication required')).toBeInTheDocument();
        expect(screen.getByText('Source unavailable')).toBeInTheDocument();
        expect(screen.getByText('Unknown')).toBeInTheDocument();
    });

    it('renders largest never-watched items as a ranked list with wrapped labels', () => {
        const queryClient = new QueryClient();
        const longLabel =
            'An exceptionally long never watched item title that should wrap inside the card instead of forcing horizontal overflow';
        mockRankingRows = {
            largest_never_watched: [{ key: 'video-1', label: longLabel, count: 0, sum: 1024 }],
        };

        renderWithProviders(queryClient);

        const card = screen.getByText('Largest never-watched items').closest('.MuiCard-root');
        expect(card).not.toBeNull();

        expect(within(card as HTMLElement).queryByRole('table')).not.toBeInTheDocument();

        const rankedList = within(card as HTMLElement).getByRole('list', {
            name: 'Largest never-watched items',
        });
        expect(rankedList).toBeInTheDocument();
        expect(within(rankedList).getAllByRole('listitem')).toHaveLength(1);
        expect(within(rankedList).getByText('01')).toBeInTheDocument();

        const label = within(rankedList).getByText(longLabel);
        expect(label).toHaveStyle({
            display: 'block',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
        });
        expect(label.closest('a')).toHaveAttribute('href', '/video/video-1');

        const value = within(rankedList).getByText('1.0 KB');
        expect(value).toHaveStyle({ whiteSpace: 'nowrap' });
    });
});
