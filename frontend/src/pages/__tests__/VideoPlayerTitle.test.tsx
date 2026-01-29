import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VideoPlayer from '../VideoPlayer';

// Mock dependencies
const mockVideo = {
    id: 'v1',
    title: 'Test Video Title',
    videoPath: 'test.mp4',
    thumbnailPath: 'thumb.jpg',
    author: 'Test Author',
    visibility: 1,
    source: 'local'
};

const mockSettingsData = { data: { websiteName: 'TestSite' } };

// Mock hooks
vi.mock('react-router-dom', () => ({
    useNavigate: () => vi.fn(),
    useParams: () => ({ id: 'v1' }),
}));

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../contexts/VideoContext', () => ({
    useVideo: () => ({ videos: [] }),
}));

vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ userRole: 'admin' }),
}));

vi.mock('../../hooks/useSettings', () => ({
    useSettings: () => mockSettingsData,
}));

vi.mock('../../hooks/useVideoQueries', () => ({
    useVideoQueries: () => ({
        video: mockVideo,
        loading: false,
        error: null,
        comments: [],
        loadingComments: false
    }),
}));

// Mock other hooks to avoid rendering errors
vi.mock('../../hooks/useCloudStorageUrl', () => ({ useCloudStorageUrl: () => 'url' }));
vi.mock('../../hooks/useVideoCollections', () => ({
    useVideoCollections: () => ({
        collections: [],
        videoCollections: [],
        modalVideoCollections: [],
        showCollectionModal: false,
        handleAddToCollection: vi.fn(),
        handleCloseModal: vi.fn(),
        handleCreateCollection: vi.fn(),
        handleAddToExistingCollection: vi.fn(),
        handleRemoveFromCollection: vi.fn()
    })
}));
vi.mock('../../hooks/useVideoSubscriptions', () => ({
    useVideoSubscriptions: () => ({
        authorChannelUrl: '',
        isSubscribed: false,
        subscriptionId: '',
        showSubscribeModal: false,
        setShowSubscribeModal: vi.fn(),
        handleAuthorClick: vi.fn(),
        handleSubscribe: vi.fn(),
        handleSubscribeConfirm: vi.fn(),
        handleUnsubscribe: vi.fn(),
        unsubscribeMutation: { mutate: vi.fn() }
    })
}));
vi.mock('../../hooks/useVideoMutations', () => ({
    useVideoMutations: () => ({
        ratingMutation: {},
        titleMutation: {},
        tagsMutation: {},
        visibilityMutation: {},
        deleteMutation: { isPending: false }
    })
}));
vi.mock('../../hooks/useVideoPlayerSettings', () => ({
    useVideoPlayerSettings: () => ({
        autoPlay: false,
        autoLoop: false,
        subtitlesEnabled: false,
        availableTags: [],
        handleSubtitlesToggle: vi.fn(),
        handleLoopToggle: vi.fn(),
        pauseOnFocusLoss: false
    })
}));
vi.mock('../../hooks/useVideoProgress', () => ({
    useVideoProgress: () => ({ handleTimeUpdate: vi.fn(), setIsDeleting: vi.fn(), currentTimeRef: { current: 0 } })
}));
vi.mock('../../hooks/useVideoRecommendations', () => ({
    useVideoRecommendations: () => ({ relatedVideos: [] })
}));

// Mock child components
vi.mock('../../components/VideoPlayer/VideoControls', () => ({ default: () => <div>Controls</div> }));
vi.mock('../../components/VideoPlayer/VideoInfo', () => ({ default: () => <div>Info</div> }));
vi.mock('../../components/VideoPlayer/CommentsSection', () => ({ default: () => <div>Comments</div> }));
vi.mock('../../components/VideoPlayer/UpNextSidebar', () => ({ default: () => <div>UpNext</div> }));
vi.mock('../../components/CollectionModal', () => ({ default: () => <div>CollectionModal</div> }));
vi.mock('../../components/ConfirmationModal', () => ({ default: () => <div>ConfirmationModal</div> }));
vi.mock('../../components/SubscribeModal', () => ({ default: () => <div>SubscribeModal</div> }));

// Mock localStorage
const localStorageMock = (function () {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => {
            store[key] = value.toString();
        },
        clear: () => {
            store = {};
        },
        removeItem: (key: string) => {
            delete store[key];
        },
    };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('VideoPlayer Title', () => {
    beforeEach(() => {
        document.title = 'Initial Title';
    });

    it('updates document title with video title and website name', () => {
        render(<VideoPlayer />);
        expect(document.title).toBe('Test Video Title - TestSite');
    });

    it('reverts document title on unmount', () => {
        const { unmount } = render(<VideoPlayer />);
        unmount();
        expect(document.title).toBe('TestSite');
    });
});
