
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as CollectionContext from '../../contexts/CollectionContext';
import * as LanguageContext from '../../contexts/LanguageContext';
import * as SnackbarContext from '../../contexts/SnackbarContext';
import * as VideoContext from '../../contexts/VideoContext';
import VideoCard from '../VideoCard';

// Mock dependencies
vi.mock('../../contexts/LanguageContext');
vi.mock('../../contexts/CollectionContext');
vi.mock('../../contexts/SnackbarContext');
vi.mock('../../contexts/VideoContext');
vi.mock('../../hooks/useVideoPrefetch', () => ({
    useVideoPrefetch: () => ({
        prefetchVideo: vi.fn(),
    }),
}));
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated: true,
        loginRequired: false,
        checkingAuth: false,
        userRole: 'admin',
        login: vi.fn(),
        logout: vi.fn(),
    }),
}));

const mockVideo = {
    id: '123',
    title: 'Test Video',
    author: 'Test Author',
    duration: '10:00',
    date: '20230101',
    videoPath: '/videos/test.mp4',
    thumbnailPath: '/thumbnails/test.jpg',
    viewCount: 100,
    source: 'youtube' as const,
    sourceUrl: 'http://youtube.com/watch?v=123',
    addedAt: '1234567890'
};

const mockT = vi.fn((key) => key);

describe('VideoCard Kebab Menu', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(LanguageContext, 'useLanguage').mockReturnValue({ t: mockT, language: 'en', setLanguage: vi.fn() });
        vi.spyOn(CollectionContext, 'useCollection').mockReturnValue({
            collections: [],
            addToCollection: vi.fn(),
            createCollection: vi.fn(),
            removeFromCollection: vi.fn()
        } as any);
        vi.spyOn(SnackbarContext, 'useSnackbar').mockReturnValue({ showSnackbar: vi.fn() });
        vi.spyOn(VideoContext, 'useVideo').mockReturnValue({
            updateVideo: vi.fn().mockResolvedValue({ success: true }),
        } as any);
    });

    it('renders kebab menu on hover (or always if mocked for test env)', () => {
        render(
            <BrowserRouter>
                <VideoCard video={mockVideo} />
            </BrowserRouter>
        );

        const kebabButton = screen.getByRole('button', { name: /more actions/i });
        expect(kebabButton).toBeInTheDocument();
    });

    it('opens kebab menu on click', () => {
        render(
            <BrowserRouter>
                <VideoCard video={mockVideo} />
            </BrowserRouter>
        );

        const kebabButton = screen.getByRole('button', { name: /more actions/i });
        fireEvent.click(kebabButton);

        expect(screen.getByRole('menu')).toBeInTheDocument();
        // Use accessible names (tooltip titles)
        expect(screen.getByRole('button', { name: /playWith/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /share/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /addToCollection/i })).toBeInTheDocument();
        // Delete shouldn't be there as we didn't pass props
        expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    });

    it('shows delete option when props provided', () => {
        render(
            <BrowserRouter>
                <VideoCard
                    video={mockVideo}
                    showDeleteButton={true}
                    onDeleteVideo={vi.fn()}
                />
            </BrowserRouter>
        );

        const kebabButton = screen.getByRole('button', { name: /more actions/i });
        fireEvent.click(kebabButton);

        expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
    });

    it('opens player menu when Play With is clicked', async () => {
        render(
            <BrowserRouter>
                <VideoCard video={mockVideo} />
            </BrowserRouter>
        );

        const kebabButton = screen.getByRole('button', { name: /more actions/i });
        fireEvent.click(kebabButton);

        const playWithButton = screen.getByRole('button', { name: /playWith/i });
        fireEvent.click(playWithButton);

        // Kebab menu closes, player menu opens
        await waitFor(() => {
            expect(screen.getByText('VLC')).toBeInTheDocument();
        });
    });
});
