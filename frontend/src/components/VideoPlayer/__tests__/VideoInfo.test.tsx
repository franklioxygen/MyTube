import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Video } from '../../../types';
import VideoInfo from '../VideoInfo';

// Mock child components to simplify test
vi.mock('../VideoInfo/EditableTitle', () => ({
    default: ({ title, onSave }: any) => (
        <div data-testid="editable-title">
            <span>{title}</span>
            <button onClick={() => onSave('New Title')}>Save Title</button>
        </div>
    )
}));
vi.mock('../VideoInfo/VideoActionButtons', () => ({
    default: ({ onDelete }: any) => <button onClick={onDelete}>Delete</button>
}));
vi.mock('../VideoInfo/VideoAuthorInfo', () => ({
    default: ({ author }: any) => <div>{author}</div>
}));
vi.mock('../VideoInfo/VideoDescription', () => ({
    default: ({ description }: any) => <div>{description}</div>
}));
vi.mock('../VideoInfo/VideoMetadata', () => ({
    default: () => <div>Metadata</div>
}));
vi.mock('../VideoInfo/VideoRating', () => ({
    default: () => <div>Rating</div>
}));
vi.mock('../VideoInfo/VideoTags', () => ({
    default: () => <div>Tags</div>
}));
vi.mock('../../hooks/useCloudStorageUrl', () => ({
    useCloudStorageUrl: () => 'mock-url'
}));
vi.mock('../../hooks/useVideoResolution', () => ({
    useVideoResolution: () => ({
        videoRef: { current: null },
        videoResolution: null,
        needsDetection: false
    })
}));

describe('VideoInfo', () => {
    const mockVideo = {
        id: '1',
        title: 'Test Video',
        description: 'Test Description',
        author: 'Test Author',
        viewCount: 100,
        rating: 5,
        tags: [],
        date: '2023-01-01',
        videoPath: 'path/to/video',
        size: 1024,
        duration: 60
    } as unknown as Video;

    const defaultProps = {
        video: mockVideo,
        onTitleSave: vi.fn(),
        onRatingChange: vi.fn(),
        onAuthorClick: vi.fn(),
        onAddToCollection: vi.fn(),
        onDelete: vi.fn(),
        isDeleting: false,
        deleteError: null,
        videoCollections: [],
        onCollectionClick: vi.fn(),
        availableTags: [],
        onTagsUpdate: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render video information', () => {
        render(<VideoInfo {...defaultProps} />);

        expect(screen.getByText('Test Author')).toBeInTheDocument();
        expect(screen.getByText('Test Description')).toBeInTheDocument();
        // Since we mocked EditableTitle to show title in span
        expect(screen.getByText('Test Video')).toBeInTheDocument();
    });

    it('should call onTitleSave when title is saved', () => {
        render(<VideoInfo {...defaultProps} />);

        fireEvent.click(screen.getByText('Save Title'));
        expect(defaultProps.onTitleSave).toHaveBeenCalledWith('New Title');
    });

    it('should call onDelete when delete button is clicked', () => {
        render(<VideoInfo {...defaultProps} />);

        fireEvent.click(screen.getByText('Delete'));
        expect(defaultProps.onDelete).toHaveBeenCalled();
    });

    it('should display delete error if present', () => {
        render(<VideoInfo {...defaultProps} deleteError="Delete failed" />);

        expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });
});
