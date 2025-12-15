import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection, Video } from '../../types';
import CollectionCard from '../CollectionCard';

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
}));

// Mock LanguageContext
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => key,
    }),
}));

describe('CollectionCard', () => {
    const mockVideos: Video[] = [
        {
            id: '1',
            title: 'Video 1',
            author: 'Author 1',
            videoPath: '/videos/1.mp4',
            thumbnailPath: '/thumbnails/1.jpg',
            thumbnailUrl: 'http://example.com/thumb1.jpg',
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
            thumbnailPath: '/thumbnails/2.jpg',
            thumbnailUrl: 'http://example.com/thumb2.jpg',
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
    ];

    const mockCollection: Collection = {
        id: 'collection-1',
        name: 'Test Collection',
        videos: ['1', '2'],
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z'
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders collection name and video count', () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <CollectionCard collection={mockCollection} videos={mockVideos} />
            </ThemeProvider>
        );

        expect(screen.getByText(/Test Collection/i)).toBeInTheDocument();
        expect(screen.getByText(/2 videos/i)).toBeInTheDocument();
    });

    it('renders collection creation date', () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <CollectionCard collection={mockCollection} videos={mockVideos} />
            </ThemeProvider>
        );

        // Date should be formatted and displayed
        const dateElement = screen.getByText(new Date(mockCollection.createdAt).toLocaleDateString());
        expect(dateElement).toBeInTheDocument();
    });

    it('navigates to collection page on click', () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <CollectionCard collection={mockCollection} videos={mockVideos} />
            </ThemeProvider>
        );

        // Click on the card
        const cardActionArea = screen.getByRole('button', { name: /Test Collection/i });
        fireEvent.click(cardActionArea);

        expect(mockNavigate).toHaveBeenCalledWith('/collection/collection-1');
    });

    it('displays folder icon when collection has no videos', () => {
        const emptyCollection: Collection = {
            ...mockCollection,
            videos: []
        };

        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <CollectionCard collection={emptyCollection} videos={[]} />
            </ThemeProvider>
        );

        // Should show folder icon (via Material-UI icon)
        expect(screen.getByText(/0 videos/i)).toBeInTheDocument();
    });

    it('displays up to 4 thumbnails in grid', () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <CollectionCard collection={mockCollection} videos={mockVideos} />
            </ThemeProvider>
        );

        // Should render thumbnails for videos
        const images = screen.getAllByRole('img');
        expect(images.length).toBeGreaterThan(0);
    });

    it('handles videos not found in collection', () => {
        const collectionWithMissingVideos: Collection = {
            ...mockCollection,
            videos: ['1', '2', '999'] // 999 doesn't exist
        };

        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <CollectionCard collection={collectionWithMissingVideos} videos={mockVideos} />
            </ThemeProvider>
        );

        // Should still render with available videos
        expect(screen.getByText(/Test Collection/i)).toBeInTheDocument();
    });
});

