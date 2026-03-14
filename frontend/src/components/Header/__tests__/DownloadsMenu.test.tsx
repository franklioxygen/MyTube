import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DownloadsMenu from '../DownloadsMenu';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
}));

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => key,
    }),
}));

describe('DownloadsMenu', () => {
    const anchorEl = document.createElement('button');
    const onClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        document.body.appendChild(anchorEl);
    });

    it('navigates to downloads and subscriptions pages', () => {
        render(
            <DownloadsMenu
                anchorEl={anchorEl}
                onClose={onClose}
                activeDownloads={[]}
                queuedDownloads={[]}
                hasActiveSubscriptions={true}
            />
        );

        fireEvent.click(screen.getByRole('menuitem', { name: /manageDownloads/i }));
        fireEvent.click(screen.getByRole('menuitem', { name: /subscriptions/i }));

        expect(onClose).toHaveBeenCalledTimes(2);
        expect(mockNavigate).toHaveBeenNthCalledWith(1, '/downloads');
        expect(mockNavigate).toHaveBeenNthCalledWith(2, '/subscriptions');
    });

    it('renders active and queued download details', () => {
        render(
            <DownloadsMenu
                anchorEl={anchorEl}
                onClose={onClose}
                hasActiveSubscriptions={false}
                activeDownloads={[
                    {
                        id: 'active-1',
                        title: 'Active title',
                        filename: 'active-file.mp4',
                        progress: 42.34,
                        totalSize: '100 MB',
                        speed: '1.5 MB/s',
                    },
                    {
                        id: 'active-2',
                        title: 'Fallback title',
                    },
                ]}
                queuedDownloads={[
                    {
                        id: 'queued-1',
                        title: 'Queued title',
                    },
                ]}
            />
        );

        expect(screen.getByText('active-file.mp4')).toBeInTheDocument();
        expect(screen.getByText('42.3%')).toBeInTheDocument();
        expect(screen.getByText('100 MB')).toBeInTheDocument();
        expect(screen.getByText('1.5 MB/s')).toBeInTheDocument();

        expect(screen.getByText('Fallback title')).toBeInTheDocument();
        expect(screen.getByText('downloading')).toBeInTheDocument();

        expect(screen.getByText('queued (1)')).toBeInTheDocument();
        expect(screen.getByText('Queued title')).toBeInTheDocument();
        expect(screen.getByText('waitingInQueue')).toBeInTheDocument();
    });
});
