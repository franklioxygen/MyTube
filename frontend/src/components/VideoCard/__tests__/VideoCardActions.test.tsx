import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoCardActions } from '../VideoCardActions';

// Mock dependencies
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

const mockAddToCollection = vi.fn();
const mockCreateCollection = vi.fn();
const mockRemoveFromCollection = vi.fn();
const mockHandleShare = vi.fn();

vi.mock('../../../contexts/CollectionContext', () => ({
    useCollection: () => ({
        collections: [
            { id: 'col1', name: 'Collection 1', videos: ['vid1'] },
            { id: 'col2', name: 'Collection 2', videos: [] }
        ],
        addToCollection: mockAddToCollection,
        createCollection: mockCreateCollection,
        removeFromCollection: mockRemoveFromCollection
    }),
}));

vi.mock('../../../hooks/useShareVideo', () => ({
    useShareVideo: () => ({
        handleShare: mockHandleShare
    }),
}));

const mockUpdateVideo = vi.fn();
vi.mock('../../../contexts/VideoContext', () => ({
    useVideo: () => ({
        updateVideo: mockUpdateVideo,
        availableTags: []
    })
}));

// Mock child components that trigger complex logic or portals
vi.mock('../../VideoPlayer/VideoInfo/VideoKebabMenuButtons', () => ({
    default: ({ onPlayWith, onShare, onAddToCollection, onDelete, onToggleVisibility }: any) => (
        <div data-testid="kebab-menu">
            <button onClick={(e) => onPlayWith(e.currentTarget)}>Play With</button>
            <button onClick={onShare}>Share</button>
            <button onClick={onAddToCollection}>Add to Collection</button>
            {onDelete && <button onClick={onDelete}>Delete</button>}
            <button onClick={onToggleVisibility}>Toggle Visibility</button>
        </div>
    )
}));

vi.mock('../../ConfirmationModal', () => ({
    default: ({ isOpen, onConfirm }: any) => isOpen ? (
        <div data-testid="delete-modal">
            <button onClick={onConfirm}>Confirm Delete</button>
        </div>
    ) : null
}));

vi.mock('../../CollectionModal', () => ({
    default: ({ open, onAddToCollection }: any) => open ? (
        <div data-testid="collection-modal">
            <button onClick={() => onAddToCollection('col2')}>Add to Col 2</button>
        </div>
    ) : null
}));

describe('VideoCardActions', () => {
    const mockSetPlayerMenuAnchor = vi.fn();
    const mockHandlePlayerSelect = vi.fn();
    const mockSetShowDeleteModal = vi.fn();
    const mockConfirmDelete = vi.fn();
    const mockHandleToggleVisibility = vi.fn();

    const defaultProps = {
        video: { id: 'vid1', title: 'Test Video', author: 'Author' } as any,
        playerMenuAnchor: null,
        setPlayerMenuAnchor: mockSetPlayerMenuAnchor,
        handlePlayerSelect: mockHandlePlayerSelect,
        getAvailablePlayers: () => [{ id: 'mpv', name: 'MPV' }],
        showDeleteModal: false,
        setShowDeleteModal: mockSetShowDeleteModal,
        confirmDelete: mockConfirmDelete,
        isDeleting: false,
        handleToggleVisibility: mockHandleToggleVisibility,
        canDelete: true,
        isMobile: false,
        isTouch: false,
        isHovered: true, // Visible by default for tests
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render actions when hovered', () => {
        render(<VideoCardActions {...defaultProps} />);
        expect(screen.getByTestId('kebab-menu')).toBeInTheDocument();
    });

    it('should hide actions when not hovered and not mobile/touch', () => {
        render(<VideoCardActions {...defaultProps} isHovered={false} />);
        // The component uses opacity: 0, but is valid in DOM.
        // We check style.
        const container = screen.getByTestId('kebab-menu').parentElement;
        expect(container).toHaveStyle({ opacity: '0' });
    });

    it('should handle share action', async () => {
        const user = userEvent.setup();
        render(<VideoCardActions {...defaultProps} />);
        await user.click(screen.getByText('Share'));
        expect(mockHandleShare).toHaveBeenCalled();
    });

    it('should handle toggle visibility', async () => {
        const user = userEvent.setup();
        render(<VideoCardActions {...defaultProps} />);
        await user.click(screen.getByText('Toggle Visibility'));
        expect(mockHandleToggleVisibility).toHaveBeenCalled();
    });

    it('should open delete modal', async () => {
        const user = userEvent.setup();
        render(<VideoCardActions {...defaultProps} />);
        await user.click(screen.getByText('Delete'));
        expect(mockSetShowDeleteModal).toHaveBeenCalledWith(true);
    });

    it('should not show delete button if canDelete is false', () => {
        render(<VideoCardActions {...defaultProps} canDelete={false} />);
        expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    });

    it('should render delete confirmation modal', async () => {
        const user = userEvent.setup();
        render(<VideoCardActions {...defaultProps} showDeleteModal={true} />);

        expect(screen.getByTestId('delete-modal')).toBeInTheDocument();
        await user.click(screen.getByText('Confirm Delete'));
        expect(mockConfirmDelete).toHaveBeenCalled();
    });

    it('should handle add to collection flow', async () => {
        const user = userEvent.setup();
        render(<VideoCardActions {...defaultProps} />);

        // Open collection modal
        await user.click(screen.getByText('Add to Collection'));
        expect(screen.getByTestId('collection-modal')).toBeInTheDocument();

        // Add to collection
        await user.click(screen.getByText('Add to Col 2'));
        expect(mockAddToCollection).toHaveBeenCalledWith('col2', 'vid1');
    });

    it('should handle player menu selection', async () => {
        const user = userEvent.setup();
        // Render with anchor set to simulate open menu
        const anchor = document.createElement('div');
        render(<VideoCardActions {...defaultProps} playerMenuAnchor={anchor} />);

        // Menu should be open
        expect(screen.getByText('MPV')).toBeInTheDocument();
        expect(screen.getByText('copyUrl')).toBeInTheDocument();

        await user.click(screen.getByText('MPV'));
        expect(mockHandlePlayerSelect).toHaveBeenCalledWith('mpv');
    });
});
