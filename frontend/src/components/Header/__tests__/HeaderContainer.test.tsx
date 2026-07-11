import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HeaderContainer from '../HeaderContainer';

const mockNavigate = vi.fn();
const mockHandleTagToggle = vi.fn();
const mockRequestHomeViewMode = vi.fn();
let mockPathname = '/';

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
        useLocation: () => ({ pathname: mockPathname }),
    };
});

vi.mock('../../../contexts/AuthContext', () => ({
    useAuth: () => ({ userRole: 'admin', isAuthenticated: true }),
}));

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../contexts/HomeViewModeRequestContext', () => ({
    useHomeViewModeRequestOptional: () => ({
        request: null,
        requestHomeViewMode: mockRequestHomeViewMode,
        clearHomeViewModeRequest: vi.fn(),
    }),
}));

vi.mock('../../../contexts/PageTagFilterContext', () => ({
    usePageTagFilterOptional: () => null,
}));

vi.mock('../../../contexts/ThemeContext', () => ({
    useThemeContext: () => ({ mode: 'light' }),
}));

vi.mock('../../../contexts/VideoContext', () => ({
    useVideo: () => ({
        availableTags: [],
        selectedTags: [],
        handleTagToggle: mockHandleTagToggle,
    }),
}));

vi.mock('../../../hooks/useSettings', () => ({
    useSettings: () => ({ data: {} }),
}));

vi.mock('../useHeaderPreferences', () => ({
    useHeaderPreferences: () => ({
        websiteName: 'MyTube',
        infiniteScroll: true,
        showThemeButton: true,
    }),
}));

vi.mock('../useHeaderSubscriptions', () => ({
    useHeaderSubscriptions: () => false,
}));

vi.mock('../useHeaderScrollState', () => ({
    useHeaderScrollState: () => true,
}));

vi.mock('../useHeaderSubmission', () => ({
    useHeaderSubmission: () => ({
        videoUrl: '',
        setVideoUrl: vi.fn(),
        isSubmitting: false,
        error: '',
        handleSubmit: vi.fn(),
    }),
}));

vi.mock('../HeaderToolbarContent', () => ({
    default: (props: any) => (
        <div>
            <button onClick={props.onDownloadsClick}>open-downloads</button>
            <button onClick={props.onDownloadsClose}>close-downloads</button>
            <button onClick={props.onManageClick}>open-manage</button>
            <button onClick={props.onManageClose}>close-manage</button>
            <button onClick={props.onToggleMobileMenu}>toggle-mobile-menu</button>
            <button onClick={props.onCloseMobileMenu}>close-mobile-menu</button>
            <button onClick={() => props.effectiveTags.onTagToggle('tag1')}>toggle-tag</button>
            <span data-testid="show-tags-in-mobile-menu">{String(props.showTagsInMobileMenu)}</span>
        </div>
    ),
}));

const renderHeader = () =>
    render(
        <HeaderContainer
            onSubmit={vi.fn()}
            onSearch={vi.fn()}
            activeDownloads={[]}
            queuedDownloads={[]}
            isSearchMode={false}
            collections={[]}
            videos={[]}
        />
    );

describe('HeaderContainer', () => {
    afterEach(() => {
        mockPathname = '/';
        vi.clearAllMocks();
    });

    it.each([
        ['/', 'true'],
        ['/collections', 'true'],
        ['/favorites', 'false'],
    ])('shows mobile tag menu on %s -> %s', (pathname, expected) => {
        mockPathname = pathname;
        renderHeader();
        expect(screen.getByTestId('show-tags-in-mobile-menu').textContent).toBe(expected);
    });

    it('handles toolbar callbacks, click-away, and scroll-to-top button click', () => {
        const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => { });

        render(
            <HeaderContainer
                onSubmit={vi.fn()}
                onSearch={vi.fn()}
                activeDownloads={[]}
                queuedDownloads={[]}
                isSearchMode={false}
                collections={[]}
                videos={[]}
            />
        );

        fireEvent.click(screen.getByText('open-downloads'));
        fireEvent.click(screen.getByText('close-downloads'));
        fireEvent.click(screen.getByText('open-manage'));
        fireEvent.click(screen.getByText('close-manage'));
        fireEvent.click(screen.getByText('toggle-mobile-menu'));
        fireEvent.click(screen.getByText('close-mobile-menu'));

        fireEvent.mouseDown(document.body);
        fireEvent.click(document.body);

        fireEvent.click(screen.getByLabelText('scroll to top'));
        expect(scrollSpy).toHaveBeenCalled();

        scrollSpy.mockRestore();
    });

    it('requests All Videos when a mobile header tag is toggled on a home route', () => {
        mockPathname = '/collections';

        renderHeader();

        fireEvent.click(screen.getByText('toggle-tag'));

        expect(mockRequestHomeViewMode).toHaveBeenCalledWith('all-videos');
        expect(mockHandleTagToggle).toHaveBeenCalledWith('tag1');
    });

    it('does not request Home tab changes for page-local tag filters', () => {
        mockPathname = '/author/Alice';

        renderHeader();

        fireEvent.click(screen.getByText('toggle-tag'));

        expect(mockRequestHomeViewMode).not.toHaveBeenCalled();
        expect(mockHandleTagToggle).toHaveBeenCalledWith('tag1');
    });
});
