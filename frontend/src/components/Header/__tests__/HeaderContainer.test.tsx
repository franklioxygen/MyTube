import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HeaderContainer from '../HeaderContainer';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
        useLocation: () => ({ pathname: '/' }),
    };
});

vi.mock('../../../contexts/AuthContext', () => ({
    useAuth: () => ({ userRole: 'admin', isAuthenticated: true }),
}));

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
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
        handleTagToggle: vi.fn(),
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
        </div>
    ),
}));

describe('HeaderContainer', () => {
    it('handles toolbar callbacks, click-away, and scroll-to-top button click', () => {
        const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => { });

        render(
            <HeaderContainer
                onSubmit={vi.fn()}
                activeDownloads={[]}
                queuedDownloads={[]}
                isSearchMode={false}
                searchTerm=""
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
});
