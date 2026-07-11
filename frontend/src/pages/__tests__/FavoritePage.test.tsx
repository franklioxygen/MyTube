import { createTheme, ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FavoritePage from '../FavoritePage';

const mockNavigate = vi.fn();
let mockVideos: any[] = [];
let mockFavoriteCollections: any[] = [];
let mockFavoriteAuthors: any[] = [];

vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
vi.mock('../../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('../../contexts/VideoContext', () => ({ useVideo: () => ({ videos: mockVideos }) }));
vi.mock('../../contexts/CollectionContext', () => ({ useCollection: () => ({ collections: [] }) }));
vi.mock('../../hooks/useFavoriteCollections', () => ({
    useFavoriteCollections: () => ({
        data: mockFavoriteCollections,
        isLoading: false,
        error: null,
        toggle: vi.fn(),
    }),
}));
vi.mock('../../hooks/useFavoriteAuthors', () => ({
    useFavoriteAuthors: () => ({
        data: mockFavoriteAuthors,
        isLoading: false,
        error: null,
        toggle: vi.fn(),
    }),
}));
vi.mock('../favorite/FavoriteHero', () => ({ default: () => <div data-testid="favorite-hero" /> }));
vi.mock('../favorite/FavoriteCollectionRail', () => ({ default: () => <div data-testid="favorite-collections" /> }));
vi.mock('../favorite/FavoriteAuthorRail', () => ({ default: () => <div data-testid="favorite-authors" /> }));
vi.mock('../favorite/FavoriteTopRatedRail', () => ({ default: ({ videos }: { videos: any[] }) => <div data-testid="top-rated">{videos.length}</div> }));
vi.mock('../favorite/FavoriteEmptyState', () => ({ default: () => <div data-testid="favorite-empty" /> }));

describe('FavoritePage', () => {
    beforeEach(() => {
        mockVideos = [];
        mockFavoriteCollections = [];
        mockFavoriteAuthors = [];
        mockNavigate.mockClear();
    });

    const renderPage = () => render(
        <ThemeProvider theme={createTheme()}>
            <FavoritePage onBrowseCollections={vi.fn()} onFindAuthors={vi.fn()} />
        </ThemeProvider>,
    );

    it('renders the empty state when there are no favorites or rated videos', () => {
        renderPage();
        expect(screen.getByTestId('favorite-empty')).toBeInTheDocument();
    });

    it('derives the top rated rail from global five-star videos', () => {
        mockVideos = [
            { id: 'one', title: 'One', rating: 4 },
            { id: 'two', title: 'Two', rating: 5, createdAt: '2026-01-01' },
        ];
        renderPage();
        expect(screen.getByTestId('favorite-hero')).toBeInTheDocument();
        expect(screen.getByTestId('top-rated')).toHaveTextContent('1');
    });
});
