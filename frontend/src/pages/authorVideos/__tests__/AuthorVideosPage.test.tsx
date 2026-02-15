import { createTheme, ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { type MouseEventHandler, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuthorVideosPage from '../AuthorVideosPage';

// --- Mutable mock state ---

let mockLoading = false;
const mockDeleteVideo = vi.fn();
const mockUpdateVideo = vi.fn();
const mockCreateCollection = vi.fn();
const mockAddToCollection = vi.fn();
const mockShowSnackbar = vi.fn();
const mockNavigate = vi.fn();

let mockVideos: unknown[] = [];
let mockAuthorVideos: unknown[] = [];
let mockAvailableTags: string[] = ['tag1', 'tag2'];

// Mutable actions state — tests can override individual fields
let mockActionsOverrides: Record<string, unknown> = {};

const defaultActions = () => ({
    isDeleteModalOpen: false,
    closeDeleteModal: vi.fn(),
    handleDeleteAuthor: vi.fn(),
    isDeleting: false,
    isCreateCollectionModalOpen: false,
    closeCreateCollectionModal: vi.fn(),
    handleCreateCollectionFromAuthor: vi.fn(),
    isCreatingCollection: false,
    createCollectionModalTitle: 'Create Collection',
    createCollectionMessage: 'Create?',
    isTagsModalOpen: false,
    openTagsModal: vi.fn(),
    closeTagsModal: vi.fn(),
    handleSaveAuthorTags: vi.fn(),
    openDeleteModal: vi.fn(),
    openCreateCollectionModal: vi.fn(),
    ...mockActionsOverrides,
});

// Mutable tag filter state
let mockTagFilterOverrides: Record<string, unknown> = {};

const defaultTagFilter = () => ({
    availableTags: ['tag1', 'tag2'],
    selectedTags: [] as string[],
    commonTags: ['tag1'],
    videosFilteredByTags: mockAuthorVideos,
    handleTagToggle: vi.fn(),
    ...mockTagFilterOverrides,
});

// Mutable video count label
let mockVideoCountLabel = '2 videos';

// --- vi.mock declarations ---

vi.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
    useParams: () => ({ authorName: 'TestAuthor' }),
}));

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../contexts/SnackbarContext', () => ({
    useSnackbar: () => ({ showSnackbar: mockShowSnackbar }),
}));

vi.mock('../../../contexts/VideoContext', () => ({
    useVideo: () => ({
        videos: mockVideos,
        loading: mockLoading,
        deleteVideo: mockDeleteVideo,
        availableTags: mockAvailableTags,
        updateVideo: mockUpdateVideo,
    }),
}));

vi.mock('../../../contexts/CollectionContext', () => ({
    useCollection: () => ({
        collections: [],
        createCollection: mockCreateCollection,
        addToCollection: mockAddToCollection,
    }),
}));

vi.mock('../../../hooks/useCloudStorageUrl', () => ({
    useCloudStorageUrl: () => 'https://example.com/avatar.jpg',
}));

vi.mock('../../../hooks/useSettings', () => ({
    useSettings: () => ({
        data: { showTagsOnThumbnail: true },
    }),
}));

vi.mock('../../../hooks/useVideoSort', () => ({
    useVideoSort: (props: { videos: unknown[]; [key: string]: unknown }) => ({
        sortedVideos: props.videos,
        sortOption: 'dateDesc',
        sortAnchorEl: null,
        handleSortClick: vi.fn(),
        handleSortClose: vi.fn(),
    }),
}));

vi.mock('../useAuthorTagFilter', () => ({
    useAuthorTagFilter: () => defaultTagFilter(),
}));

vi.mock('../useAuthorVideoActions', () => ({
    useAuthorVideoActions: () => defaultActions(),
}));

vi.mock('../utils', () => ({
    getAuthorVideos: () => mockAuthorVideos,
    getVideoCountLabel: () => mockVideoCountLabel,
}));

// --- Mock child components ---

vi.mock('../../../components/TagsSidebar', () => ({
    TagsSidebar: (props: { isSidebarOpen: unknown; onTagToggle: (tag: string) => void; [key: string]: unknown }) => (
        <div data-testid="tags-sidebar">
            <span data-testid="sidebar-open">{String(props.isSidebarOpen)}</span>
            <button data-testid="tag-toggle-btn" onClick={() => { props.onTagToggle('tag1'); }}>Toggle Tag</button>
        </div>
    ),
}));

vi.mock('../AuthorVideosHeader', () => ({
    default: (props: { authorDisplayName: ReactNode; videoCountLabel: ReactNode; hasVideos: unknown; isBusy: unknown; onToggleSidebar: MouseEventHandler; onOpenTagsModal: MouseEventHandler; onOpenCreateCollectionModal: MouseEventHandler; onOpenDeleteModal: MouseEventHandler; [key: string]: unknown }) => (
        <div data-testid="author-header">
            <span data-testid="author-display-name">{props.authorDisplayName}</span>
            <span data-testid="video-count-label">{props.videoCountLabel}</span>
            <span data-testid="has-videos">{String(props.hasVideos)}</span>
            <span data-testid="is-busy">{String(props.isBusy)}</span>
            <button data-testid="toggle-sidebar-btn" onClick={props.onToggleSidebar}>Toggle Sidebar</button>
            <button data-testid="open-tags-modal-btn" onClick={props.onOpenTagsModal}>Open Tags</button>
            <button data-testid="open-create-collection-btn" onClick={props.onOpenCreateCollectionModal}>Create Collection</button>
            <button data-testid="open-delete-modal-btn" onClick={props.onOpenDeleteModal}>Delete Author</button>
        </div>
    ),
}));

vi.mock('../AuthorVideosContent', () => ({
    default: (props: { authorVideosLength: ReactNode; sortedVideos: unknown[]; noVideosMessage: ReactNode; noFilteredVideosMessage: ReactNode; showTagsOnThumbnail: unknown; [key: string]: unknown }) => (
        <div data-testid="author-content">
            <span data-testid="author-videos-length">{props.authorVideosLength}</span>
            <span data-testid="sorted-videos-count">{props.sortedVideos.length}</span>
            <span data-testid="no-videos-message">{props.noVideosMessage}</span>
            <span data-testid="no-filtered-videos-message">{props.noFilteredVideosMessage}</span>
            <span data-testid="show-tags-on-thumbnail">{String(props.showTagsOnThumbnail)}</span>
        </div>
    ),
}));

vi.mock('../../../components/ConfirmationModal', () => ({
    default: ({ isOpen, onClose, onConfirm, title, message, confirmText, isDanger }: { isOpen: unknown; onClose: MouseEventHandler; onConfirm: MouseEventHandler; title: ReactNode; message: ReactNode; confirmText: ReactNode; isDanger: unknown; [key: string]: unknown }) =>
        isOpen ? (
            <div data-testid={`confirmation-modal-${title}`}>
                <span data-testid="modal-title">{title}</span>
                <span data-testid="modal-message">{message}</span>
                <span data-testid="modal-confirm-text">{confirmText}</span>
                <span data-testid="modal-is-danger">{String(isDanger)}</span>
                <button data-testid="modal-confirm-btn" onClick={onConfirm}>Confirm</button>
                <button data-testid="modal-close-btn" onClick={onClose}>Close</button>
            </div>
        ) : null,
}));

vi.mock('../../../components/TagsModal', () => ({
    default: ({ open, onClose, videoTags, availableTags, onSave }: { open: unknown; onClose: MouseEventHandler; videoTags: unknown; availableTags: unknown; onSave: (tags: string[]) => void; [key: string]: unknown }) =>
        open ? (
            <div data-testid="tags-modal">
                <span data-testid="tags-modal-video-tags">{JSON.stringify(videoTags)}</span>
                <span data-testid="tags-modal-available-tags">{JSON.stringify(availableTags)}</span>
                <button data-testid="tags-modal-save-btn" onClick={() => { onSave(['newTag']); }}>Save Tags</button>
                <button data-testid="tags-modal-close-btn" onClick={onClose}>Close Tags Modal</button>
            </div>
        ) : null,
}));

// --- Test suite ---

describe('AuthorVideosPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockLoading = false;
        mockVideos = [
            { id: 'v1', title: 'Video 1', author: 'TestAuthor', tags: ['tag1'], authorAvatarPath: '/avatar.jpg' },
            { id: 'v2', title: 'Video 2', author: 'TestAuthor', tags: ['tag2'] },
        ];
        mockAuthorVideos = [...mockVideos];
        mockAvailableTags = ['tag1', 'tag2'];
        mockActionsOverrides = {};
        mockTagFilterOverrides = {};
        mockVideoCountLabel = '2 videos';
    });

    const renderPage = () => {
        const theme = createTheme();
        return render(
            <ThemeProvider theme={theme}>
                <AuthorVideosPage />
            </ThemeProvider>
        );
    };

    // -------------------------------------------------------
    // 1. Loading state
    // -------------------------------------------------------
    describe('loading state', () => {
        it('shows CircularProgress when loading is true', () => {
            mockLoading = true;
            renderPage();
            expect(screen.getByRole('progressbar')).toBeInTheDocument();
        });

        it('does not render author header when loading', () => {
            mockLoading = true;
            renderPage();
            expect(screen.queryByTestId('author-header')).not.toBeInTheDocument();
        });

        it('does not render author content when loading', () => {
            mockLoading = true;
            renderPage();
            expect(screen.queryByTestId('author-content')).not.toBeInTheDocument();
        });

        it('does not render tags sidebar when loading', () => {
            mockLoading = true;
            renderPage();
            expect(screen.queryByTestId('tags-sidebar')).not.toBeInTheDocument();
        });
    });

    // -------------------------------------------------------
    // 2. Author header with display name
    // -------------------------------------------------------
    describe('author header', () => {
        it('renders author header with display name from first video', () => {
            renderPage();
            const header = screen.getByTestId('author-header');
            expect(header).toBeInTheDocument();
            expect(screen.getByTestId('author-display-name')).toHaveTextContent('TestAuthor');
        });

        it('passes video count label to header', () => {
            mockVideoCountLabel = '5 videos';
            renderPage();
            expect(screen.getByTestId('video-count-label')).toHaveTextContent('5 videos');
        });

        it('passes hasVideos true when author has videos', () => {
            renderPage();
            expect(screen.getByTestId('has-videos')).toHaveTextContent('true');
        });

        it('passes hasVideos false when author has no videos', () => {
            mockAuthorVideos = [];
            renderPage();
            expect(screen.getByTestId('has-videos')).toHaveTextContent('false');
        });

        it('passes isBusy false when not creating or deleting', () => {
            renderPage();
            expect(screen.getByTestId('is-busy')).toHaveTextContent('false');
        });

        it('passes isBusy true when isDeleting is true', () => {
            mockActionsOverrides = { isDeleting: true };
            renderPage();
            expect(screen.getByTestId('is-busy')).toHaveTextContent('true');
        });

        it('passes isBusy true when isCreatingCollection is true', () => {
            mockActionsOverrides = { isCreatingCollection: true };
            renderPage();
            expect(screen.getByTestId('is-busy')).toHaveTextContent('true');
        });
    });

    // -------------------------------------------------------
    // 3. Author videos content
    // -------------------------------------------------------
    describe('author videos content', () => {
        it('renders AuthorVideosContent component', () => {
            renderPage();
            expect(screen.getByTestId('author-content')).toBeInTheDocument();
        });

        it('passes correct authorVideosLength', () => {
            renderPage();
            expect(screen.getByTestId('author-videos-length')).toHaveTextContent('2');
        });

        it('passes sorted videos from useVideoSort', () => {
            renderPage();
            expect(screen.getByTestId('sorted-videos-count')).toHaveTextContent('2');
        });

        it('passes noVideosMessage translation key', () => {
            renderPage();
            expect(screen.getByTestId('no-videos-message')).toHaveTextContent('noVideosForAuthor');
        });

        it('passes noFilteredVideosMessage translation key', () => {
            renderPage();
            expect(screen.getByTestId('no-filtered-videos-message')).toHaveTextContent('noVideosFoundMatching');
        });

        it('passes showTagsOnThumbnail setting', () => {
            renderPage();
            expect(screen.getByTestId('show-tags-on-thumbnail')).toHaveTextContent('true');
        });
    });

    // -------------------------------------------------------
    // 4. Tags sidebar
    // -------------------------------------------------------
    describe('tags sidebar', () => {
        it('renders TagsSidebar component', () => {
            renderPage();
            expect(screen.getByTestId('tags-sidebar')).toBeInTheDocument();
        });

        it('sidebar is initially closed (isSidebarOpen defaults to false)', () => {
            renderPage();
            expect(screen.getByTestId('sidebar-open')).toHaveTextContent('false');
        });
    });

    // -------------------------------------------------------
    // 5. Delete author modal opens/closes
    // -------------------------------------------------------
    describe('delete author modal', () => {
        it('does not show delete modal when isDeleteModalOpen is false', () => {
            renderPage();
            expect(screen.queryByTestId('confirmation-modal-deleteAuthor')).not.toBeInTheDocument();
        });

        it('shows delete modal when isDeleteModalOpen is true', () => {
            mockActionsOverrides = { isDeleteModalOpen: true };
            renderPage();
            expect(screen.getByTestId('confirmation-modal-deleteAuthor')).toBeInTheDocument();
        });

        it('delete modal has danger flag set to true', () => {
            mockActionsOverrides = { isDeleteModalOpen: true };
            renderPage();
            const modal = screen.getByTestId('confirmation-modal-deleteAuthor');
            expect(modal).toBeInTheDocument();
            expect(screen.getByTestId('modal-is-danger')).toHaveTextContent('true');
        });

        it('delete modal shows correct title', () => {
            mockActionsOverrides = { isDeleteModalOpen: true };
            renderPage();
            expect(screen.getByTestId('modal-title')).toHaveTextContent('deleteAuthor');
        });

        it('delete modal confirm text shows deleting state', () => {
            mockActionsOverrides = { isDeleteModalOpen: true, isDeleting: true };
            renderPage();
            expect(screen.getByTestId('modal-confirm-text')).toHaveTextContent('deleting');
        });

        it('delete modal confirm text shows delete when not deleting', () => {
            mockActionsOverrides = { isDeleteModalOpen: true, isDeleting: false };
            renderPage();
            expect(screen.getByTestId('modal-confirm-text')).toHaveTextContent('delete');
        });

        it('calls handleDeleteAuthor when confirm is clicked', () => {
            const mockHandleDelete = vi.fn();
            mockActionsOverrides = { isDeleteModalOpen: true, handleDeleteAuthor: mockHandleDelete };
            renderPage();
            screen.getByTestId('modal-confirm-btn').click();
            expect(mockHandleDelete).toHaveBeenCalledTimes(1);
        });

        it('calls closeDeleteModal when close is clicked', () => {
            const mockCloseDelete = vi.fn();
            mockActionsOverrides = { isDeleteModalOpen: true, closeDeleteModal: mockCloseDelete };
            renderPage();
            screen.getByTestId('modal-close-btn').click();
            expect(mockCloseDelete).toHaveBeenCalledTimes(1);
        });
    });

    // -------------------------------------------------------
    // 6. Delete author confirms and calls deleteVideo for all author videos
    // -------------------------------------------------------
    describe('delete author confirmation flow', () => {
        it('calls handleDeleteAuthor on confirm which should delete all author videos', () => {
            const mockHandleDeleteAuthor = vi.fn();
            mockActionsOverrides = {
                isDeleteModalOpen: true,
                handleDeleteAuthor: mockHandleDeleteAuthor,
            };
            renderPage();
            screen.getByTestId('modal-confirm-btn').click();
            expect(mockHandleDeleteAuthor).toHaveBeenCalledTimes(1);
        });

        it('header exposes openDeleteModal button', () => {
            const mockOpenDelete = vi.fn();
            mockActionsOverrides = { openDeleteModal: mockOpenDelete };
            renderPage();
            screen.getByTestId('open-delete-modal-btn').click();
            expect(mockOpenDelete).toHaveBeenCalledTimes(1);
        });
    });

    // -------------------------------------------------------
    // 7. Create collection modal opens/closes
    // -------------------------------------------------------
    describe('create collection modal', () => {
        it('does not show create collection modal when isCreateCollectionModalOpen is false', () => {
            renderPage();
            expect(screen.queryByTestId('confirmation-modal-Create Collection')).not.toBeInTheDocument();
        });

        it('shows create collection modal when isCreateCollectionModalOpen is true', () => {
            mockActionsOverrides = { isCreateCollectionModalOpen: true };
            renderPage();
            expect(screen.getByTestId('confirmation-modal-Create Collection')).toBeInTheDocument();
        });

        it('create collection modal is not danger', () => {
            mockActionsOverrides = { isCreateCollectionModalOpen: true };
            renderPage();
            expect(screen.getByTestId('modal-is-danger')).toHaveTextContent('false');
        });

        it('create collection modal shows correct title', () => {
            mockActionsOverrides = { isCreateCollectionModalOpen: true };
            renderPage();
            expect(screen.getByTestId('modal-title')).toHaveTextContent('Create Collection');
        });

        it('create collection modal shows creating state in confirm text', () => {
            mockActionsOverrides = { isCreateCollectionModalOpen: true, isCreatingCollection: true };
            renderPage();
            expect(screen.getByTestId('modal-confirm-text')).toHaveTextContent('creatingCollection');
        });

        it('create collection modal shows create in confirm text when not creating', () => {
            mockActionsOverrides = { isCreateCollectionModalOpen: true, isCreatingCollection: false };
            renderPage();
            expect(screen.getByTestId('modal-confirm-text')).toHaveTextContent('create');
        });

        it('header exposes openCreateCollectionModal button', () => {
            const mockOpenCreate = vi.fn();
            mockActionsOverrides = { openCreateCollectionModal: mockOpenCreate };
            renderPage();
            screen.getByTestId('open-create-collection-btn').click();
            expect(mockOpenCreate).toHaveBeenCalledTimes(1);
        });
    });

    // -------------------------------------------------------
    // 8. Create collection confirms
    // -------------------------------------------------------
    describe('create collection confirmation', () => {
        it('calls handleCreateCollectionFromAuthor on confirm', () => {
            const mockHandleCreate = vi.fn();
            mockActionsOverrides = {
                isCreateCollectionModalOpen: true,
                handleCreateCollectionFromAuthor: mockHandleCreate,
            };
            renderPage();
            screen.getByTestId('modal-confirm-btn').click();
            expect(mockHandleCreate).toHaveBeenCalledTimes(1);
        });

        it('calls closeCreateCollectionModal on close', () => {
            const mockCloseCreate = vi.fn();
            mockActionsOverrides = {
                isCreateCollectionModalOpen: true,
                closeCreateCollectionModal: mockCloseCreate,
            };
            renderPage();
            screen.getByTestId('modal-close-btn').click();
            expect(mockCloseCreate).toHaveBeenCalledTimes(1);
        });

        it('displays the create collection message', () => {
            mockActionsOverrides = {
                isCreateCollectionModalOpen: true,
                createCollectionMessage: 'Do you want to create a collection?',
            };
            renderPage();
            expect(screen.getByTestId('modal-message')).toHaveTextContent('Do you want to create a collection?');
        });
    });

    // -------------------------------------------------------
    // 9. Tags modal opens/closes
    // -------------------------------------------------------
    describe('tags modal', () => {
        it('does not show tags modal when isTagsModalOpen is false', () => {
            renderPage();
            expect(screen.queryByTestId('tags-modal')).not.toBeInTheDocument();
        });

        it('shows tags modal when isTagsModalOpen is true', () => {
            mockActionsOverrides = { isTagsModalOpen: true };
            renderPage();
            expect(screen.getByTestId('tags-modal')).toBeInTheDocument();
        });

        it('header exposes openTagsModal button', () => {
            const mockOpenTags = vi.fn();
            mockActionsOverrides = { openTagsModal: mockOpenTags };
            renderPage();
            screen.getByTestId('open-tags-modal-btn').click();
            expect(mockOpenTags).toHaveBeenCalledTimes(1);
        });

        it('tags modal receives commonTags as videoTags', () => {
            mockTagFilterOverrides = { commonTags: ['sharedTag1', 'sharedTag2'] };
            mockActionsOverrides = { isTagsModalOpen: true };
            renderPage();
            expect(screen.getByTestId('tags-modal-video-tags')).toHaveTextContent(
                JSON.stringify(['sharedTag1', 'sharedTag2'])
            );
        });

        it('tags modal receives globalAvailableTags as availableTags', () => {
            mockAvailableTags = ['globalTag1', 'globalTag2', 'globalTag3'];
            mockActionsOverrides = { isTagsModalOpen: true };
            renderPage();
            expect(screen.getByTestId('tags-modal-available-tags')).toHaveTextContent(
                JSON.stringify(['globalTag1', 'globalTag2', 'globalTag3'])
            );
        });

        it('calls closeTagsModal when close button is clicked', () => {
            const mockCloseTags = vi.fn();
            mockActionsOverrides = { isTagsModalOpen: true, closeTagsModal: mockCloseTags };
            renderPage();
            screen.getByTestId('tags-modal-close-btn').click();
            expect(mockCloseTags).toHaveBeenCalledTimes(1);
        });
    });

    // -------------------------------------------------------
    // 10. Tags modal save calls handleSaveAuthorTags
    // -------------------------------------------------------
    describe('tags modal save', () => {
        it('calls handleSaveAuthorTags with new tags when save is clicked', () => {
            const mockSaveTags = vi.fn();
            mockActionsOverrides = { isTagsModalOpen: true, handleSaveAuthorTags: mockSaveTags };
            renderPage();
            screen.getByTestId('tags-modal-save-btn').click();
            expect(mockSaveTags).toHaveBeenCalledTimes(1);
            expect(mockSaveTags).toHaveBeenCalledWith(['newTag']);
        });
    });

    // -------------------------------------------------------
    // 11. No videos for author
    // -------------------------------------------------------
    describe('no videos for author', () => {
        it('renders with zero author videos length', () => {
            mockAuthorVideos = [];
            mockTagFilterOverrides = { videosFilteredByTags: [] };
            renderPage();
            expect(screen.getByTestId('author-videos-length')).toHaveTextContent('0');
        });

        it('passes noVideosForAuthor message to content component', () => {
            mockAuthorVideos = [];
            mockTagFilterOverrides = { videosFilteredByTags: [] };
            renderPage();
            expect(screen.getByTestId('no-videos-message')).toHaveTextContent('noVideosForAuthor');
        });

        it('passes hasVideos false to header when no author videos', () => {
            mockAuthorVideos = [];
            mockTagFilterOverrides = { videosFilteredByTags: [] };
            renderPage();
            expect(screen.getByTestId('has-videos')).toHaveTextContent('false');
        });
    });

    // -------------------------------------------------------
    // 12. Video count label with/without tag filtering
    // -------------------------------------------------------
    describe('video count label', () => {
        it('passes video count label to header', () => {
            mockVideoCountLabel = '3 videos';
            renderPage();
            expect(screen.getByTestId('video-count-label')).toHaveTextContent('3 videos');
        });

        it('displays filtered count label when tags are selected', () => {
            mockVideoCountLabel = '1 / 3 videos';
            mockTagFilterOverrides = { selectedTags: ['tag1'] };
            renderPage();
            expect(screen.getByTestId('video-count-label')).toHaveTextContent('1 / 3 videos');
        });

        it('displays zero videos label when no videos exist', () => {
            mockAuthorVideos = [];
            mockVideoCountLabel = '0 videos';
            mockTagFilterOverrides = { videosFilteredByTags: [] };
            renderPage();
            expect(screen.getByTestId('video-count-label')).toHaveTextContent('0 videos');
        });
    });

    // -------------------------------------------------------
    // Additional integration-style tests
    // -------------------------------------------------------
    describe('component structure', () => {
        it('does not show loading spinner when not loading', () => {
            renderPage();
            expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        });

        it('renders all main sections when not loading', () => {
            renderPage();
            expect(screen.getByTestId('tags-sidebar')).toBeInTheDocument();
            expect(screen.getByTestId('author-header')).toBeInTheDocument();
            expect(screen.getByTestId('author-content')).toBeInTheDocument();
        });

        it('does not render any confirmation modals by default', () => {
            renderPage();
            expect(screen.queryByTestId('modal-confirm-btn')).not.toBeInTheDocument();
        });

        it('does not render tags modal by default', () => {
            renderPage();
            expect(screen.queryByTestId('tags-modal')).not.toBeInTheDocument();
        });
    });

    describe('multiple modals rendering based on actions state', () => {
        it('renders only the delete modal when only isDeleteModalOpen is true', () => {
            mockActionsOverrides = { isDeleteModalOpen: true };
            renderPage();
            expect(screen.getByTestId('confirmation-modal-deleteAuthor')).toBeInTheDocument();
            expect(screen.queryByTestId('tags-modal')).not.toBeInTheDocument();
        });

        it('renders only the tags modal when only isTagsModalOpen is true', () => {
            mockActionsOverrides = { isTagsModalOpen: true };
            renderPage();
            expect(screen.getByTestId('tags-modal')).toBeInTheDocument();
            expect(screen.queryByTestId('confirmation-modal-deleteAuthor')).not.toBeInTheDocument();
        });

        it('renders only the create collection modal when only isCreateCollectionModalOpen is true', () => {
            mockActionsOverrides = { isCreateCollectionModalOpen: true };
            renderPage();
            expect(screen.getByTestId('confirmation-modal-Create Collection')).toBeInTheDocument();
            expect(screen.queryByTestId('confirmation-modal-deleteAuthor')).not.toBeInTheDocument();
            expect(screen.queryByTestId('tags-modal')).not.toBeInTheDocument();
        });
    });
});
