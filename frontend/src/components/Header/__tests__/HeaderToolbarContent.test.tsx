import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HeaderToolbarContent from '../HeaderToolbarContent';

vi.mock('../ActionButtons', () => ({
    default: () => <div data-testid="action-buttons">actions</div>,
}));

vi.mock('../Logo', () => ({
    default: ({ websiteName }: { websiteName: string }) => <div data-testid="logo">{websiteName}</div>,
}));

vi.mock('../MobileMenu', () => ({
    default: () => <div data-testid="mobile-menu">mobile-menu</div>,
}));

vi.mock('../SearchInput', () => ({
    default: () => <div data-testid="search-input">search-input</div>,
}));

describe('HeaderToolbarContent', () => {
    const baseProps = {
        isMobile: false,
        isScrolled: false,
        isVisitor: false,
        websiteName: 'MyTube',
        onResetSearch: vi.fn(),
        activeDownloads: [],
        queuedDownloads: [],
        downloadsAnchorEl: null,
        manageAnchorEl: null,
        onDownloadsClick: vi.fn(),
        onDownloadsClose: vi.fn(),
        onManageClick: vi.fn(),
        onManageClose: vi.fn(),
        hasActiveSubscriptions: false,
        showThemeButton: true,
        mobileMenuOpen: false,
        onToggleMobileMenu: vi.fn(),
        onCloseMobileMenu: vi.fn(),
        videoUrl: '',
        setVideoUrl: vi.fn(),
        isSubmitting: false,
        error: '',
        isSearchMode: false,
        searchTerm: '',
        onSubmit: vi.fn(),
        collections: [],
        videos: [],
        showTagsInMobileMenu: false,
        effectiveTags: {
            availableTags: [],
            selectedTags: [],
            onTagToggle: vi.fn(),
        },
    };

    it('renders compact logo-only layout on mobile when scrolled', () => {
        render(
            <HeaderToolbarContent
                {...baseProps}
                isMobile={true}
                isScrolled={true}
            />
        );

        expect(screen.getByTestId('logo')).toHaveTextContent('MyTube');
        expect(screen.queryByTestId('action-buttons')).not.toBeInTheDocument();
        expect(screen.queryByTestId('mobile-menu')).not.toBeInTheDocument();
    });
});
