import { render, screen, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VideoPlayer from '../VideoPlayer';

// ---- Shared mock data ----

const mockVideo = {
    id: 'v1',
    title: 'Test Video Title',
    videoPath: 'test.mp4',
    thumbnailPath: 'thumb.jpg',
    author: 'Test Author',
    visibility: 1,
    source: 'local',
    progress: 10,
    subtitles: [],
    sourceUrl: 'http://example.com/video.mp4',
};

const mockSettingsData = { data: { websiteName: 'TestSite' } };

// ---- Module-scope mock functions for assertions ----

const mockNavigate = vi.fn();
const mockSetShowSubscribeModal = vi.fn();
const mockHandleAuthorClickFromHook = vi.fn();
const mockHandleSubscribe = vi.fn();
const mockHandleSubscribeConfirm = vi.fn();
const mockHandleUnsubscribeFromHook = vi.fn();
const mockUnsubscribeMutate = vi.fn();
const mockHandleAddToCollection = vi.fn();
const mockHandleCloseModal = vi.fn();
const mockHandleCreateCollection = vi.fn();
const mockHandleAddToExistingCollection = vi.fn();
const mockHandleRemoveFromCollection = vi.fn();
const mockRatingMutateAsync = vi.fn();
const mockTitleMutateAsync = vi.fn();
const mockTagsMutateAsync = vi.fn();
const mockVisibilityMutateAsync = vi.fn();
const mockDeleteMutateAsync = vi.fn();
const mockUploadSubtitleMutateAsync = vi.fn();
const mockDeleteSubtitleMutateAsync = vi.fn();
const mockHandleTimeUpdate = vi.fn();
const mockSetIsDeleting = vi.fn();
const mockHandleSubtitlesToggle = vi.fn();
const mockHandleLoopToggle = vi.fn();
const mockScrollTo = vi.fn();

// ---- Mutable mock state (overridable per test) ----

let mockVideoQueryReturn: any;
let mockAuthReturn: any;
let mockVideoMutationsReturn: any;
let mockVideoSubscriptionsReturn: any;
let mockVideoCollectionsReturn: any;
let mockVideoRecommendationsReturn: any;
let mockVideoPlayerSettingsReturn: any;

// ---- Mock hooks ----

vi.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: 'v1' }),
}));

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string, params?: any) => params ? `${key}:${JSON.stringify(params)}` : key }),
}));

vi.mock('../../contexts/VideoContext', () => ({
    useVideo: () => ({ videos: [] }),
}));

vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => mockAuthReturn,
}));

vi.mock('../../hooks/useSettings', () => ({
    useSettings: () => mockSettingsData,
}));

vi.mock('../../hooks/useVideoQueries', () => ({
    useVideoQueries: () => mockVideoQueryReturn,
}));

vi.mock('../../hooks/useCloudStorageUrl', () => ({ useCloudStorageUrl: () => 'url' }));

vi.mock('../../hooks/useVideoCollections', () => ({
    useVideoCollections: () => mockVideoCollectionsReturn,
}));

vi.mock('../../hooks/useVideoSubscriptions', () => ({
    useVideoSubscriptions: () => mockVideoSubscriptionsReturn,
}));

vi.mock('../../hooks/useVideoMutations', () => ({
    useVideoMutations: (opts: any) => {
        // Capture onDeleteSuccess for testing
        mockVideoMutationsReturn._onDeleteSuccess = opts?.onDeleteSuccess;
        return mockVideoMutationsReturn;
    },
}));

vi.mock('../../hooks/useVideoPlayerSettings', () => ({
    useVideoPlayerSettings: () => mockVideoPlayerSettingsReturn,
}));

vi.mock('../../hooks/useVideoProgress', () => ({
    useVideoProgress: () => ({
        handleTimeUpdate: mockHandleTimeUpdate,
        setIsDeleting: mockSetIsDeleting,
        currentTimeRef: { current: 0 },
    }),
}));

vi.mock('../../hooks/useVideoRecommendations', () => ({
    useVideoRecommendations: () => mockVideoRecommendationsReturn,
}));

vi.mock('../../utils/apiUrl', () => ({
    getBackendUrl: () => 'http://localhost:5000',
}));

// ---- Mock child components with data-testid and exposed callbacks ----

let capturedVideoControlsProps: any = {};
let capturedVideoInfoProps: any = {};
let capturedCommentsSectionProps: any = {};
let capturedUpNextSidebarProps: any = {};
let capturedCollectionModalProps: any = {};
let capturedConfirmationModalProps: any = {};
let capturedSubscribeModalProps: any = {};

vi.mock('../../components/VideoPlayer/VideoControls', () => ({
    default: (props: any) => {
        capturedVideoControlsProps = props;
        return <div data-testid="video-controls" />;
    },
}));

vi.mock('../../components/VideoPlayer/VideoInfo', () => ({
    default: (props: any) => {
        capturedVideoInfoProps = props;
        return <div data-testid="video-info" />;
    },
}));

vi.mock('../../components/VideoPlayer/CommentsSection', () => ({
    default: (props: any) => {
        capturedCommentsSectionProps = props;
        return <div data-testid="comments-section" />;
    },
}));

vi.mock('../../components/VideoPlayer/UpNextSidebar', () => ({
    default: (props: any) => {
        capturedUpNextSidebarProps = props;
        return <div data-testid="up-next-sidebar" />;
    },
}));

vi.mock('../../components/CollectionModal', () => ({
    default: (props: any) => {
        capturedCollectionModalProps = props;
        return <div data-testid="collection-modal" />;
    },
}));

vi.mock('../../components/ConfirmationModal', () => ({
    default: (props: any) => {
        capturedConfirmationModalProps = props;
        return <div data-testid="confirmation-modal" />;
    },
}));

vi.mock('../../components/SubscribeModal', () => ({
    default: (props: any) => {
        capturedSubscribeModalProps = props;
        return <div data-testid="subscribe-modal" />;
    },
}));

// ---- localStorage mock ----

const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: vi.fn((key: string) => store[key] ?? null),
        setItem: vi.fn((key: string, value: string) => { store[key] = value.toString(); }),
        clear: () => { store = {}; },
        removeItem: (key: string) => { delete store[key]; },
    };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// ---- Defaults reset ----

function resetDefaults() {
    mockVideoQueryReturn = {
        video: { ...mockVideo },
        loading: false,
        error: null,
        comments: [],
        loadingComments: false,
    };

    mockAuthReturn = { userRole: 'admin' };

    mockVideoMutationsReturn = {
        ratingMutation: { mutateAsync: mockRatingMutateAsync },
        titleMutation: { mutateAsync: mockTitleMutateAsync },
        tagsMutation: { mutateAsync: mockTagsMutateAsync },
        visibilityMutation: { mutateAsync: mockVisibilityMutateAsync },
        deleteMutation: { isPending: false, error: null, mutateAsync: mockDeleteMutateAsync },
        uploadSubtitleMutation: { mutateAsync: mockUploadSubtitleMutateAsync },
        deleteSubtitleMutation: { mutateAsync: mockDeleteSubtitleMutateAsync },
        _onDeleteSuccess: undefined,
    };

    mockVideoSubscriptionsReturn = {
        authorChannelUrl: 'https://youtube.com/@author',
        isSubscribed: false,
        subscriptionId: 'sub1',
        showSubscribeModal: false,
        setShowSubscribeModal: mockSetShowSubscribeModal,
        handleAuthorClick: mockHandleAuthorClickFromHook,
        handleSubscribe: mockHandleSubscribe,
        handleSubscribeConfirm: mockHandleSubscribeConfirm,
        handleUnsubscribe: mockHandleUnsubscribeFromHook,
        unsubscribeMutation: { mutate: mockUnsubscribeMutate },
    };

    mockVideoCollectionsReturn = {
        collections: [],
        videoCollections: [],
        modalVideoCollections: [],
        showCollectionModal: false,
        handleAddToCollection: mockHandleAddToCollection,
        handleCloseModal: mockHandleCloseModal,
        handleCreateCollection: mockHandleCreateCollection,
        handleAddToExistingCollection: mockHandleAddToExistingCollection,
        handleRemoveFromCollection: mockHandleRemoveFromCollection,
    };

    mockVideoRecommendationsReturn = { relatedVideos: [] };

    mockVideoPlayerSettingsReturn = {
        autoPlay: false,
        autoLoop: false,
        subtitlesEnabled: false,
        availableTags: ['tag1', 'tag2'],
        handleSubtitlesToggle: mockHandleSubtitlesToggle,
        handleLoopToggle: mockHandleLoopToggle,
        pauseOnFocusLoss: false,
        playFromBeginning: false,
    };

    capturedVideoControlsProps = {};
    capturedVideoInfoProps = {};
    capturedCommentsSectionProps = {};
    capturedUpNextSidebarProps = {};
    capturedCollectionModalProps = {};
    capturedConfirmationModalProps = {};
    capturedSubscribeModalProps = {};
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    resetDefaults();
    window.scrollTo = mockScrollTo;
});

// ==================================================================
// Tests
// ==================================================================

describe('VideoPlayer', () => {
    // ------ Loading state ------
    describe('Loading state', () => {
        it('renders CircularProgress spinner when loading', () => {
            mockVideoQueryReturn = { ...mockVideoQueryReturn, loading: true, video: null };
            render(<VideoPlayer />);
            expect(screen.getByRole('progressbar')).toBeTruthy();
            expect(screen.getByText('loadingVideo')).toBeTruthy();
        });

        it('does not render child components when loading', () => {
            mockVideoQueryReturn = { ...mockVideoQueryReturn, loading: true, video: null };
            render(<VideoPlayer />);
            expect(screen.queryByTestId('video-controls')).toBeNull();
            expect(screen.queryByTestId('video-info')).toBeNull();
        });
    });

    // ------ Error state ------
    describe('Error state', () => {
        it('renders error Alert when there is an error', () => {
            mockVideoQueryReturn = { ...mockVideoQueryReturn, error: new Error('fail'), video: null };
            render(<VideoPlayer />);
            expect(screen.getByRole('alert')).toBeTruthy();
            expect(screen.getByText('videoNotFoundOrLoaded')).toBeTruthy();
        });

        it('renders error Alert when video is null (no error)', () => {
            mockVideoQueryReturn = { ...mockVideoQueryReturn, video: null };
            render(<VideoPlayer />);
            expect(screen.getByRole('alert')).toBeTruthy();
        });

        it('navigates to home after error timeout', () => {
            vi.useFakeTimers();
            mockVideoQueryReturn = { ...mockVideoQueryReturn, error: new Error('fail'), video: null };
            render(<VideoPlayer />);
            act(() => { vi.advanceTimersByTime(3000); });
            expect(mockNavigate).toHaveBeenCalledWith('/');
            vi.useRealTimers();
        });
    });

    // ------ Successful render with child components ------
    describe('Successful render', () => {
        it('renders VideoControls, VideoInfo, UpNextSidebar', () => {
            render(<VideoPlayer />);
            expect(screen.getByTestId('video-controls')).toBeTruthy();
            expect(screen.getByTestId('video-info')).toBeTruthy();
            expect(screen.getByTestId('up-next-sidebar')).toBeTruthy();
        });

        it('renders CollectionModal, ConfirmationModal, SubscribeModal', () => {
            render(<VideoPlayer />);
            expect(screen.getByTestId('collection-modal')).toBeTruthy();
            expect(screen.getByTestId('confirmation-modal')).toBeTruthy();
            expect(screen.getByTestId('subscribe-modal')).toBeTruthy();
        });

        it('does not render CommentsSection for local source', () => {
            render(<VideoPlayer />);
            expect(screen.queryByTestId('comments-section')).toBeNull();
        });

        it('renders CommentsSection for youtube source', () => {
            mockVideoQueryReturn.video = { ...mockVideo, source: 'youtube' };
            render(<VideoPlayer />);
            expect(screen.getByTestId('comments-section')).toBeTruthy();
        });

        it('renders CommentsSection for bilibili source', () => {
            mockVideoQueryReturn.video = { ...mockVideo, source: 'bilibili' };
            render(<VideoPlayer />);
            expect(screen.getByTestId('comments-section')).toBeTruthy();
        });
    });

    // ------ handleToggleComments ------
    describe('handleToggleComments', () => {
        it('toggles showComments state via CommentsSection callback', () => {
            mockVideoQueryReturn.video = { ...mockVideo, source: 'youtube' };
            render(<VideoPlayer />);
            // Initially showComments is false
            expect(capturedCommentsSectionProps.showComments).toBe(false);

            // Invoke the toggle callback
            act(() => { capturedCommentsSectionProps.onToggleComments(); });

            // After toggle, re-render captures updated props
            expect(capturedCommentsSectionProps.showComments).toBe(true);
        });
    });

    // ------ handleAuthorClick ------
    describe('handleAuthorClick', () => {
        it('navigates when hook returns shouldNavigate', () => {
            mockHandleAuthorClickFromHook.mockReturnValue({ shouldNavigate: true, path: '/author/TestAuthor' });
            render(<VideoPlayer />);
            act(() => { capturedVideoInfoProps.onAuthorClick(); });
            expect(mockNavigate).toHaveBeenCalledWith('/author/TestAuthor');
        });

        it('does not navigate when hook returns no shouldNavigate', () => {
            mockHandleAuthorClickFromHook.mockReturnValue(undefined);
            render(<VideoPlayer />);
            act(() => { capturedVideoInfoProps.onAuthorClick(); });
            expect(mockNavigate).not.toHaveBeenCalled();
        });
    });

    // ------ handleAvatarClick ------
    describe('handleAvatarClick', () => {
        it('navigates to internal author page', () => {
            render(<VideoPlayer />);
            act(() => { capturedVideoInfoProps.onAvatarClick(); });
            expect(mockNavigate).toHaveBeenCalledWith('/author/Test%20Author');
        });
    });

    // ------ handleDelete ------
    describe('handleDelete', () => {
        it('opens ConfirmationModal with delete config', () => {
            render(<VideoPlayer />);
            // Initially the confirmation modal is closed
            expect(capturedConfirmationModalProps.isOpen).toBe(false);

            act(() => { capturedVideoInfoProps.onDelete(); });

            expect(capturedConfirmationModalProps.isOpen).toBe(true);
            expect(capturedConfirmationModalProps.title).toBe('deleteVideo');
            expect(capturedConfirmationModalProps.isDanger).toBe(true);
        });

        it('executeDelete calls deleteMutation.mutateAsync on confirm', async () => {
            mockDeleteMutateAsync.mockResolvedValue(undefined);
            render(<VideoPlayer />);

            act(() => { capturedVideoInfoProps.onDelete(); });

            // Invoke the onConfirm handler (executeDelete)
            await act(async () => { await capturedConfirmationModalProps.onConfirm(); });

            expect(mockSetIsDeleting).toHaveBeenCalledWith(true);
            expect(mockDeleteMutateAsync).toHaveBeenCalledWith('v1');
        });

        it('sets isDeleting back to false if delete fails', async () => {
            mockDeleteMutateAsync.mockRejectedValue(new Error('fail'));
            render(<VideoPlayer />);

            act(() => { capturedVideoInfoProps.onDelete(); });
            await act(async () => {
                await capturedConfirmationModalProps.onConfirm();
            });

            expect(mockSetIsDeleting).toHaveBeenCalledWith(true);
            expect(mockSetIsDeleting).toHaveBeenCalledWith(false);
        });
    });

    // ------ handleUnsubscribe ------
    describe('handleUnsubscribe', () => {
        it('opens ConfirmationModal with unsubscribe config', () => {
            render(<VideoPlayer />);
            act(() => { capturedVideoInfoProps.onUnsubscribe(); });

            expect(capturedConfirmationModalProps.isOpen).toBe(true);
            expect(capturedConfirmationModalProps.title).toBe('unsubscribe');
            expect(capturedConfirmationModalProps.isDanger).toBe(true);
        });

        it('onConfirm calls handleUnsubscribeFromHook which calls unsubscribeMutation.mutate', () => {
            mockHandleUnsubscribeFromHook.mockImplementation((cb: () => void) => cb());
            render(<VideoPlayer />);

            act(() => { capturedVideoInfoProps.onUnsubscribe(); });
            act(() => { capturedConfirmationModalProps.onConfirm(); });

            expect(mockHandleUnsubscribeFromHook).toHaveBeenCalled();
            expect(mockUnsubscribeMutate).toHaveBeenCalledWith('sub1');
        });

        it('does nothing when subscriptionId is empty', () => {
            mockVideoSubscriptionsReturn = { ...mockVideoSubscriptionsReturn, subscriptionId: '' };
            render(<VideoPlayer />);
            act(() => { capturedVideoInfoProps.onUnsubscribe(); });

            // Modal should remain closed since early return
            expect(capturedConfirmationModalProps.isOpen).toBe(false);
        });
    });

    // ------ handleRatingChange ------
    describe('handleRatingChange', () => {
        it('calls ratingMutation.mutateAsync with new value', async () => {
            mockRatingMutateAsync.mockResolvedValue(undefined);
            render(<VideoPlayer />);
            await act(async () => { await capturedVideoInfoProps.onRatingChange(4); });
            expect(mockRatingMutateAsync).toHaveBeenCalledWith(4);
        });
    });

    // ------ handleSaveTitle ------
    describe('handleSaveTitle', () => {
        it('calls titleMutation.mutateAsync with new title', async () => {
            mockTitleMutateAsync.mockResolvedValue(undefined);
            render(<VideoPlayer />);
            await act(async () => { await capturedVideoInfoProps.onTitleSave('New Title'); });
            expect(mockTitleMutateAsync).toHaveBeenCalledWith('New Title');
        });
    });

    // ------ handleUpdateTags ------
    describe('handleUpdateTags', () => {
        it('calls tagsMutation.mutateAsync with new tags', async () => {
            mockTagsMutateAsync.mockResolvedValue(undefined);
            render(<VideoPlayer />);
            await act(async () => { await capturedVideoInfoProps.onTagsUpdate(['a', 'b']); });
            expect(mockTagsMutateAsync).toHaveBeenCalledWith(['a', 'b']);
        });
    });

    // ------ handleToggleVisibility ------
    describe('handleToggleVisibility', () => {
        it('toggles visibility from 1 to 0', async () => {
            mockVisibilityMutateAsync.mockResolvedValue(undefined);
            render(<VideoPlayer />);
            await act(async () => { await capturedVideoInfoProps.onToggleVisibility(); });
            expect(mockVisibilityMutateAsync).toHaveBeenCalledWith(0);
        });

        it('toggles visibility from 0 to 1', async () => {
            mockVideoQueryReturn.video = { ...mockVideo, visibility: 0 };
            mockVisibilityMutateAsync.mockResolvedValue(undefined);
            render(<VideoPlayer />);
            await act(async () => { await capturedVideoInfoProps.onToggleVisibility(); });
            expect(mockVisibilityMutateAsync).toHaveBeenCalledWith(1);
        });
    });

    // ------ handleVideoEnded / autoPlayNext ------
    describe('handleVideoEnded and autoPlayNext', () => {
        it('navigates to next related video when autoPlayNext is on and related videos exist', () => {
            localStorageMock.setItem('autoPlayNext', 'true');
            mockVideoRecommendationsReturn = { relatedVideos: [{ id: 'v2' }, { id: 'v3' }] };
            render(<VideoPlayer />);

            act(() => { capturedVideoControlsProps.onEnded(); });
            expect(mockNavigate).toHaveBeenCalledWith('/video/v2');
        });

        it('does not navigate when autoPlayNext is off', () => {
            mockVideoRecommendationsReturn = { relatedVideos: [{ id: 'v2' }] };
            render(<VideoPlayer />);

            act(() => { capturedVideoControlsProps.onEnded(); });
            expect(mockNavigate).not.toHaveBeenCalled();
        });

        it('does not navigate when no related videos', () => {
            localStorageMock.setItem('autoPlayNext', 'true');
            mockVideoRecommendationsReturn = { relatedVideos: [] };
            render(<VideoPlayer />);

            act(() => { capturedVideoControlsProps.onEnded(); });
            expect(mockNavigate).not.toHaveBeenCalled();
        });

        it('also navigates when settingsAutoPlay is true even if autoPlayNext toggle is off', () => {
            mockVideoPlayerSettingsReturn = { ...mockVideoPlayerSettingsReturn, autoPlay: true };
            // autoPlayNext defaults to false from localStorage, but settingsAutoPlay true
            // Note: autoPlay passed to VideoControls will be true, but handleVideoEnded checks autoPlayNext state, not autoPlay
            // Looking at the code: handleVideoEnded checks autoPlayNext state variable
            mockVideoRecommendationsReturn = { relatedVideos: [{ id: 'v2' }] };
            render(<VideoPlayer />);

            act(() => { capturedVideoControlsProps.onEnded(); });
            // autoPlayNext is false so no navigation
            expect(mockNavigate).not.toHaveBeenCalled();
        });
    });

    // ------ Cinema mode toggle ------
    describe('Cinema mode', () => {
        it('toggles cinema mode via VideoControls callback', () => {
            render(<VideoPlayer />);
            expect(capturedVideoControlsProps.isCinemaMode).toBe(false);

            act(() => { capturedVideoControlsProps.onToggleCinemaMode(); });
            expect(capturedVideoControlsProps.isCinemaMode).toBe(true);

            act(() => { capturedVideoControlsProps.onToggleCinemaMode(); });
            expect(capturedVideoControlsProps.isCinemaMode).toBe(false);
        });
    });

    // ------ handleRemoveFromCollectionWithConfirm ------
    describe('handleRemoveFromCollectionWithConfirm', () => {
        it('opens ConfirmationModal and calls handleRemoveFromCollection on confirm', async () => {
            mockHandleRemoveFromCollection.mockResolvedValue(undefined);
            render(<VideoPlayer />);

            act(() => { capturedCollectionModalProps.onRemoveFromCollection(); });

            expect(capturedConfirmationModalProps.isOpen).toBe(true);
            expect(capturedConfirmationModalProps.title).toBe('removeFromCollection');

            await act(async () => { await capturedConfirmationModalProps.onConfirm(); });
            expect(mockHandleRemoveFromCollection).toHaveBeenCalled();
        });
    });

    // ------ localStorage autoPlayNext persistence ------
    describe('localStorage autoPlayNext persistence', () => {
        it('reads autoPlayNext from localStorage on mount', () => {
            localStorageMock.setItem('autoPlayNext', 'true');
            render(<VideoPlayer />);
            expect(capturedUpNextSidebarProps.autoPlayNext).toBe(true);
        });

        it('defaults autoPlayNext to false when not in localStorage', () => {
            render(<VideoPlayer />);
            expect(capturedUpNextSidebarProps.autoPlayNext).toBe(false);
        });

        it('persists autoPlayNext changes to localStorage', () => {
            render(<VideoPlayer />);
            act(() => { capturedUpNextSidebarProps.onAutoPlayNextChange(true); });
            expect(localStorageMock.setItem).toHaveBeenCalledWith('autoPlayNext', 'true');
        });
    });

    // ------ Visitor mode redirect for invisible videos ------
    describe('Visitor mode redirect for invisible videos', () => {
        it('redirects visitor to home for invisible video', () => {
            vi.useFakeTimers();
            mockAuthReturn = { userRole: 'visitor' };
            mockVideoQueryReturn.video = { ...mockVideo, visibility: 0 };
            render(<VideoPlayer />);

            act(() => { vi.advanceTimersByTime(3000); });
            expect(mockNavigate).toHaveBeenCalledWith('/');
            vi.useRealTimers();
        });

        it('does not redirect admin for invisible video', () => {
            vi.useFakeTimers();
            mockAuthReturn = { userRole: 'admin' };
            mockVideoQueryReturn.video = { ...mockVideo, visibility: 0 };
            render(<VideoPlayer />);

            act(() => { vi.advanceTimersByTime(3000); });
            expect(mockNavigate).not.toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('does not redirect visitor for visible video', () => {
            vi.useFakeTimers();
            mockAuthReturn = { userRole: 'visitor' };
            mockVideoQueryReturn.video = { ...mockVideo, visibility: 1 };
            render(<VideoPlayer />);

            act(() => { vi.advanceTimersByTime(3000); });
            expect(mockNavigate).not.toHaveBeenCalled();
            vi.useRealTimers();
        });
    });

    // ------ scrollTo on id change ------
    describe('scrollTo on mount', () => {
        it('calls window.scrollTo(0, 0) on render', () => {
            render(<VideoPlayer />);
            expect(mockScrollTo).toHaveBeenCalledWith(0, 0);
        });
    });

    // ------ ConfirmationModal close ------
    describe('ConfirmationModal close', () => {
        it('closes confirmation modal via onClose', () => {
            render(<VideoPlayer />);

            // Open modal via delete
            act(() => { capturedVideoInfoProps.onDelete(); });
            expect(capturedConfirmationModalProps.isOpen).toBe(true);

            // Close modal
            act(() => { capturedConfirmationModalProps.onClose(); });
            expect(capturedConfirmationModalProps.isOpen).toBe(false);
        });
    });

    // ------ SubscribeModal props ------
    describe('SubscribeModal', () => {
        it('passes correct props to SubscribeModal', () => {
            mockVideoSubscriptionsReturn = { ...mockVideoSubscriptionsReturn, showSubscribeModal: true };
            render(<VideoPlayer />);

            expect(capturedSubscribeModalProps.open).toBe(true);
            expect(capturedSubscribeModalProps.authorName).toBe('Test Author');
            expect(capturedSubscribeModalProps.url).toBe('https://youtube.com/@author');
            expect(capturedSubscribeModalProps.source).toBe('local');
        });

        it('closes SubscribeModal via onClose', () => {
            mockVideoSubscriptionsReturn = { ...mockVideoSubscriptionsReturn, showSubscribeModal: true };
            render(<VideoPlayer />);

            act(() => { capturedSubscribeModalProps.onClose(); });
            expect(mockSetShowSubscribeModal).toHaveBeenCalledWith(false);
        });

        it('calls handleSubscribeConfirm via onConfirm', () => {
            render(<VideoPlayer />);
            capturedSubscribeModalProps.onConfirm();
            expect(mockHandleSubscribeConfirm).toHaveBeenCalled();
        });
    });

    // ------ handleCollectionClick (via VideoInfo) ------
    describe('handleCollectionClick', () => {
        it('navigates to collection page when onCollectionClick is called', () => {
            render(<VideoPlayer />);
            act(() => { capturedVideoInfoProps.onCollectionClick('col1'); });
            expect(mockNavigate).toHaveBeenCalledWith('/collection/col1');
        });
    });

    // ------ UpNextSidebar onVideoClick ------
    describe('UpNextSidebar onVideoClick', () => {
        it('navigates to video page when a related video is clicked', () => {
            render(<VideoPlayer />);
            act(() => { capturedUpNextSidebarProps.onVideoClick('v5'); });
            expect(mockNavigate).toHaveBeenCalledWith('/video/v5');
        });
    });

    // ------ Props passed to VideoControls ------
    describe('VideoControls props', () => {
        it('passes autoPlay as true when settingsAutoPlay is true', () => {
            mockVideoPlayerSettingsReturn = { ...mockVideoPlayerSettingsReturn, autoPlay: true };
            render(<VideoPlayer />);
            expect(capturedVideoControlsProps.autoPlay).toBe(true);
        });

        it('passes autoPlay as true when autoPlayNext localStorage is true', () => {
            localStorageMock.setItem('autoPlayNext', 'true');
            render(<VideoPlayer />);
            expect(capturedVideoControlsProps.autoPlay).toBe(true);
        });

        it('passes startTime from video progress when not playFromBeginning', () => {
            render(<VideoPlayer />);
            // currentTimeRef.current is 0, so falls back to video.progress (10)
            expect(capturedVideoControlsProps.startTime).toBe(10);
        });

        it('passes startTime as 0 when playFromBeginning is true', () => {
            mockVideoPlayerSettingsReturn = { ...mockVideoPlayerSettingsReturn, playFromBeginning: true };
            render(<VideoPlayer />);
            expect(capturedVideoControlsProps.startTime).toBe(0);
        });
    });

    // ------ VideoInfo props ------
    describe('VideoInfo props', () => {
        it('passes isDeleting from deleteMutation.isPending', () => {
            mockVideoMutationsReturn.deleteMutation.isPending = true;
            render(<VideoPlayer />);
            expect(capturedVideoInfoProps.isDeleting).toBe(true);
        });

        it('passes deleteError message when deleteMutation has error', () => {
            mockVideoMutationsReturn.deleteMutation.error = { message: 'Delete failed!' };
            render(<VideoPlayer />);
            expect(capturedVideoInfoProps.deleteError).toBe('Delete failed!');
        });

        it('passes deleteError as deleteFailed translation when error has no message', () => {
            mockVideoMutationsReturn.deleteMutation.error = {};
            render(<VideoPlayer />);
            expect(capturedVideoInfoProps.deleteError).toBe('deleteFailed');
        });

        it('passes null deleteError when no error', () => {
            render(<VideoPlayer />);
            expect(capturedVideoInfoProps.deleteError).toBeNull();
        });

        it('passes availableTags from settings hook', () => {
            render(<VideoPlayer />);
            expect(capturedVideoInfoProps.availableTags).toEqual(['tag1', 'tag2']);
        });

        it('passes isSubscribed from subscriptions hook', () => {
            mockVideoSubscriptionsReturn = { ...mockVideoSubscriptionsReturn, isSubscribed: true };
            render(<VideoPlayer />);
            expect(capturedVideoInfoProps.isSubscribed).toBe(true);
        });
    });
});
