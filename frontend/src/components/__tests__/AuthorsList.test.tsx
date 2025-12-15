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

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when no videos', () => {
        const theme = createTheme();
        const { container } = render(
            <ThemeProvider theme={theme}>
                <AuthorsList videos={[]} />
            </ThemeProvider>
        );

        expect(container.firstChild).toBeNull();
    });

    it('renders nothing when videos have no authors', () => {
        const videosWithoutAuthors: Video[] = [
            {
                id: '1',
                title: 'Video 1',
                author: '',
                videoPath: '/videos/1.mp4',
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
                url: 'http://example.com/video1.mp4',
                source: 'youtube',
                sourceUrl: 'http://example.com/video1',
                addedAt: '2023-01-01'
            }
        ];

        const theme = createTheme();
        const { container } = render(
            <ThemeProvider theme={theme}>
                <AuthorsList videos={videosWithoutAuthors} />
            </ThemeProvider>
        );

        expect(container.firstChild).toBeNull();
    });

    it('renders unique authors from videos', () => {
        const videos: Video[] = [
            {
                id: '1',
                title: 'Video 1',
                author: 'Author 1',
                videoPath: '/videos/1.mp4',
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
                url: 'http://example.com/video1.mp4',
                source: 'youtube',
                sourceUrl: 'http://example.com/video1',
                addedAt: '2023-01-01'
            },
            {
                id: '2',
                title: 'Video 2',
                author: 'Author 2',
                videoPath: '/videos/2.mp4',
                date: '20230102',
                duration: '15:00',
                viewCount: 200,
                width: 1920,
                height: 1080,
                ext: 'mp4',
                format_id: '137',
                format_note: '1080p',
                filesize: 2000,
                fps: 30,
                url: 'http://example.com/video2.mp4',
                source: 'youtube',
                sourceUrl: 'http://example.com/video2',
                addedAt: '2023-01-02'
            },
            {
                id: '3',
                title: 'Video 3',
                author: 'Author 1', // Duplicate
                videoPath: '/videos/3.mp4',
                date: '20230103',
                duration: '20:00',
                viewCount: 300,
                width: 1920,
                height: 1080,
                ext: 'mp4',
                format_id: '137',
                format_note: '1080p',
                filesize: 3000,
                fps: 30,
                url: 'http://example.com/video3.mp4',
                source: 'youtube',
                sourceUrl: 'http://example.com/video3',
                addedAt: '2023-01-03'
            }
        ];

        const theme = createTheme();
        render(
            <MemoryRouter>
                <ThemeProvider theme={theme}>
                    <AuthorsList videos={videos} />
                </ThemeProvider>
            </MemoryRouter>
        );

        expect(screen.getByText('Authors')).toBeInTheDocument();
        expect(screen.getByText('Author 1')).toBeInTheDocument();
        expect(screen.getByText('Author 2')).toBeInTheDocument();
        
        // Should only show unique authors
        const author1Elements = screen.getAllByText('Author 1');
        expect(author1Elements.length).toBe(1); // Only one instance in the list
    });

    it('sorts authors alphabetically', () => {
        const videos: Video[] = [
            {
                id: '1',
                title: 'Video 1',
                author: 'Zebra',
                videoPath: '/videos/1.mp4',
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
                url: 'http://example.com/video1.mp4',
                source: 'youtube',
                sourceUrl: 'http://example.com/video1',
                addedAt: '2023-01-01'
            },
            {
                id: '2',
                title: 'Video 2',
                author: 'Apple',
                videoPath: '/videos/2.mp4',
                date: '20230102',
                duration: '15:00',
                viewCount: 200,
                width: 1920,
                height: 1080,
                ext: 'mp4',
                format_id: '137',
                format_note: '1080p',
                filesize: 2000,
                fps: 30,
                url: 'http://example.com/video2.mp4',
                source: 'youtube',
                sourceUrl: 'http://example.com/video2',
                addedAt: '2023-01-02'
            }
        ];

        const theme = createTheme();
        render(
            <MemoryRouter>
                <ThemeProvider theme={theme}>
                    <AuthorsList videos={videos} />
                </ThemeProvider>
            </MemoryRouter>
        );

        const authorElements = screen.getAllByText(/Apple|Zebra/);
        // Should be sorted alphabetically (Apple before Zebra)
        expect(authorElements[0].textContent).toBe('Apple');
        expect(authorElements[1].textContent).toBe('Zebra');
    });

    it('calls onItemClick when author is clicked', () => {
        const videos: Video[] = [
            {
                id: '1',
                title: 'Video 1',
                author: 'Author 1',
                videoPath: '/videos/1.mp4',
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
                url: 'http://example.com/video1.mp4',
                source: 'youtube',
                sourceUrl: 'http://example.com/video1',
                addedAt: '2023-01-01'
            }
        ];

        const theme = createTheme();
        render(
            <MemoryRouter>
                <ThemeProvider theme={theme}>
                    <AuthorsList videos={videos} onItemClick={mockOnItemClick} />
                </ThemeProvider>
            </MemoryRouter>
        );

        const authorLink = screen.getByText('Author 1');
        fireEvent.click(authorLink);

        expect(mockOnItemClick).toHaveBeenCalledTimes(1);
    });
});

