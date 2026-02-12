import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import AuthorsList from '../AuthorsList';
import { Video } from '../../types';

// Mock LanguageContext
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => key === 'authors' ? 'Authors' : key,
    }),
}));

describe('AuthorsList', () => {
    const mockOnItemClick = vi.fn();
    const baseVideo: Video = {
        id: 'base',
        title: 'Base Video',
        author: 'Base Author',
        videoPath: '/videos/base.mp4',
        date: '20230101',
        duration: '10:00',
        viewCount: 100,
        width: 1920,
        height: 1080,
        ext: 'mp4',
        format_id: '137',
        format_note: '1080p',
        filesize: 1000,
        fps: 30,
        url: 'http://example.com/video.mp4',
        source: 'youtube',
        sourceUrl: 'http://example.com/video',
        addedAt: '2023-01-01'
    };

    const createVideo = (overrides: Partial<Video> = {}): Video => ({
        ...baseVideo,
        ...overrides
    });

    const renderAuthorsList = (videos: Video[], onItemClick?: () => void) => {
        const theme = createTheme();
        return render(
            <MemoryRouter>
                <ThemeProvider theme={theme}>
                    <AuthorsList videos={videos} onItemClick={onItemClick} />
                </ThemeProvider>
            </MemoryRouter>
        );
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when no videos', () => {
        const { container } = renderAuthorsList([]);
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing when videos have no authors', () => {
        const videosWithoutAuthors: Video[] = [createVideo({ id: '1', title: 'Video 1', author: '' })];
        const { container } = renderAuthorsList(videosWithoutAuthors);
        expect(container.firstChild).toBeNull();
    });

    it('renders unique authors from videos', () => {
        const videos: Video[] = [
            createVideo({ id: '1', title: 'Video 1', author: 'Author 1' }),
            createVideo({ id: '2', title: 'Video 2', author: 'Author 2' }),
            createVideo({ id: '3', title: 'Video 3', author: 'Author 1' })
        ];

        renderAuthorsList(videos);

        expect(screen.getByText('Authors')).toBeInTheDocument();
        expect(screen.getByText('Author 1')).toBeInTheDocument();
        expect(screen.getByText('Author 2')).toBeInTheDocument();
        
        // Should only show unique authors
        const author1Elements = screen.getAllByText('Author 1');
        expect(author1Elements.length).toBe(1); // Only one instance in the list
    });

    it('sorts authors alphabetically', () => {
        const videos: Video[] = [
            createVideo({ id: '1', title: 'Video 1', author: 'Zebra' }),
            createVideo({ id: '2', title: 'Video 2', author: 'Apple' })
        ];

        renderAuthorsList(videos);

        const authorElements = screen.getAllByText(/Apple|Zebra/);
        // Should be sorted alphabetically (Apple before Zebra)
        expect(authorElements[0].textContent).toBe('Apple');
        expect(authorElements[1].textContent).toBe('Zebra');
    });

    it('calls onItemClick when author is clicked', () => {
        const videos: Video[] = [createVideo({ id: '1', title: 'Video 1', author: 'Author 1' })];
        renderAuthorsList(videos, mockOnItemClick);

        const authorLink = screen.getByText('Author 1');
        fireEvent.click(authorLink);

        expect(mockOnItemClick).toHaveBeenCalledTimes(1);
    });
});
