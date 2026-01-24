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

const mockHandleShare = vi.fn();
vi.mock('../../hooks/useShareVideo', () => ({
    useShareVideo: () => ({
        handleShare: mockHandleShare,
    }),
}));

const mockShowSnackbar = vi.fn();
vi.mock('../../contexts/SnackbarContext', () => ({
    useSnackbar: () => ({
        showSnackbar: mockShowSnackbar,
    }),
}));

const mockUpdateVideo = vi.fn();
vi.mock('../../contexts/VideoContext', () => ({
    useVideo: () => ({
        updateVideo: mockUpdateVideo,
        availableTags: ['tag1', 'tag2', 'tag3'],
    }),
}));

const mockPrefetchVideo = vi.fn();
vi.mock('../../hooks/useVideoPrefetch', () => ({
    useVideoPrefetch: () => ({
        prefetchVideo: mockPrefetchVideo,
    }),
}));

// Mock TagsModal to avoid complex context dependencies
vi.mock('../TagsModal', () => ({
    default: ({ open }: { open: boolean }) => open ? <div data-testid="tags-modal">Tags Modal</div> : null
}));

// Mock the child component to avoid sizing/visibility issues in JSDOM
// and to easily verify props passed to it
vi.mock('../VideoPlayer/VideoInfo/VideoKebabMenuButtons', () => ({
    default: ({ onDelete }: { onDelete?: () => void }) => (
        <div data-testid="kebab-menu">
            {onDelete && <button onClick={onDelete}>Delete Mock</button>}
        </div>
    )
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

    it('passes delete handler to menu when showDeleteButton is true', () => {
        const onDelete = vi.fn();
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <VideoCard video={mockVideo} showDeleteButton={true} onDeleteVideo={onDelete} />
            </ThemeProvider>
        );

        // Check if our mock Kebab Menu rendered and received the delete prop
        const mockDeleteBtn = screen.getByText('Delete Mock');
        expect(mockDeleteBtn).toBeInTheDocument();

        // Click it to trigger the callback passed to KebabMenu -> which triggers setShowDeleteModal(true)
        fireEvent.click(mockDeleteBtn);

        // Expect confirmation modal to appear
        expect(screen.getByText('deleteVideo')).toBeInTheDocument();
    });

    it('navigates to video player on click', () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <VideoCard video={mockVideo} />
            </ThemeProvider>
        );

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

    it('renders tags on thumbnail when showTagsOnThumbnail is true', () => {
        const videoWithTags = { ...mockVideo, tags: ['tag1', 'tag2'] };
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <VideoCard video={videoWithTags} showTagsOnThumbnail={true} />
            </ThemeProvider>
        );

        expect(screen.getByText('tag1')).toBeInTheDocument();
        expect(screen.getByText('tag2')).toBeInTheDocument();
    });

    it('does not render tags on thumbnail when showTagsOnThumbnail is false', () => {
        const videoWithTags = { ...mockVideo, tags: ['tag1', 'tag2'] };
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <VideoCard video={videoWithTags} showTagsOnThumbnail={false} />
            </ThemeProvider>
        );

        expect(screen.queryByText('tag1')).not.toBeInTheDocument();
        expect(screen.queryByText('tag2')).not.toBeInTheDocument();
    });
});
