import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, FormEvent } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MobileMenu from '../MobileMenu';

const mockNavigate = vi.fn();
const mockLogout = vi.fn();
const mockUseSettings = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

vi.mock('../../../contexts/AuthContext', () => ({
    useAuth: () => ({
        logout: mockLogout,
    }),
}));

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => key,
    }),
}));

vi.mock('../../../hooks/useSettings', () => ({
    useSettings: mockUseSettings,
}));

vi.mock('../../Collections', () => ({
    default: ({ onItemClick }: { onItemClick: () => void }) => (
        <button onClick={onItemClick}>collections-item</button>
    ),
}));

vi.mock('../../AuthorsList', () => ({
    default: ({ onItemClick }: { onItemClick: () => void }) => (
        <button onClick={onItemClick}>authors-item</button>
    ),
}));

vi.mock('../../TagsList', () => ({
    default: ({ onTagToggle }: { onTagToggle: (tag: string) => void }) => (
        <button onClick={() => onTagToggle('tag-1')}>tags-item</button>
    ),
}));

vi.mock('../SearchInput', () => ({
    default: ({ onSubmit, onResetSearch }: { onSubmit: (e: FormEvent) => void; onResetSearch?: () => void }) => (
        <div>
            <button onClick={() => onSubmit({ preventDefault: vi.fn() } as unknown as FormEvent)}>
                search-submit
            </button>
            <button onClick={onResetSearch}>search-reset</button>
        </div>
    ),
}));

describe('MobileMenu', () => {
    const baseProps: ComponentProps<typeof MobileMenu> = {
        open: true,
        videoUrl: '',
        setVideoUrl: vi.fn(),
        isSubmitting: false,
        error: '',
        isSearchMode: false,
        searchTerm: '',
        onResetSearch: vi.fn(),
        onSubmit: vi.fn(),
        onClose: vi.fn(),
        collections: [],
        videos: [],
        showTags: false,
        availableTags: [],
        selectedTags: [],
        onTagToggle: vi.fn(),
    };

    const renderMenu = (props: Partial<typeof baseProps> = {}) =>
        render(
            <MemoryRouter>
                <MobileMenu {...baseProps} {...props} />
            </MemoryRouter>
        );

    beforeEach(() => {
        vi.clearAllMocks();
        mockUseSettings.mockReturnValue({ data: { loginEnabled: false } });
    });

    it('renders navigation and forwards search/section callbacks', () => {
        const onClose = vi.fn();
        const onSubmit = vi.fn();
        const onResetSearch = vi.fn();

        renderMenu({
            onClose,
            onSubmit,
            onResetSearch,
        });

        expect(screen.getByRole('link', { name: 'manageVideos' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'settings' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'logout' })).not.toBeInTheDocument();
        expect(screen.queryByText('tags-item')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('link', { name: 'manageVideos' }));
        fireEvent.click(screen.getByRole('link', { name: 'settings' }));
        fireEvent.click(screen.getByText('collections-item'));
        fireEvent.click(screen.getByText('authors-item'));
        expect(onClose).toHaveBeenCalledTimes(4);

        fireEvent.click(screen.getByText('search-submit'));
        fireEvent.click(screen.getByText('search-reset'));
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onResetSearch).toHaveBeenCalledTimes(1);
    });

    it('renders tags section and forwards tag toggle callback', () => {
        const onTagToggle = vi.fn();
        renderMenu({
            showTags: true,
            onTagToggle,
            availableTags: ['tag-1'],
            selectedTags: ['tag-1'],
        });

        fireEvent.click(screen.getByText('tags-item'));
        expect(onTagToggle).toHaveBeenCalledWith('tag-1');
    });

    it('handles logout when login is enabled', () => {
        mockUseSettings.mockReturnValue({ data: { loginEnabled: true } });
        const onClose = vi.fn();

        renderMenu({ onClose });

        fireEvent.click(screen.getByRole('button', { name: 'logout' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mockLogout).toHaveBeenCalledTimes(1);
        expect(mockNavigate).toHaveBeenCalledWith('/');
    });
});
