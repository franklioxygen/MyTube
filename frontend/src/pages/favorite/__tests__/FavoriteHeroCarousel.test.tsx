import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FavoriteHeroCarousel, { type FavoriteHeroItem } from '../FavoriteHeroCarousel';

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

// Render the current slide's title so tests can assert which video is showing.
vi.mock('../FavoriteHero', () => ({
    default: ({ video }: { video: { title: string } }) => (
        <div data-testid="hero-slide">{video.title}</div>
    ),
}));

const makeItems = (titles: string[]): FavoriteHeroItem[] =>
    titles.map((title, i) => ({ video: { id: `v${i}`, title } as never }));

const renderCarousel = (items: FavoriteHeroItem[]) =>
    render(
        <ThemeProvider theme={createTheme()}>
            <FavoriteHeroCarousel items={items} />
        </ThemeProvider>,
    );

beforeEach(() => {
    // Deterministic: not reduced-motion, so auto-advance runs when timers do.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })) as never;
});

afterEach(() => {
    vi.useRealTimers();
});

describe('FavoriteHeroCarousel', () => {
    it('shows no controls for a single featured video', () => {
        renderCarousel(makeItems(['Only One']));
        expect(screen.getByTestId('hero-slide')).toHaveTextContent('Only One');
        expect(screen.queryByRole('button', { name: 'next' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'previous' })).not.toBeInTheDocument();
    });

    it('renders one dot per slide and arrows when there are multiple', () => {
        renderCarousel(makeItems(['A', 'B', 'C']));
        expect(screen.getByRole('button', { name: 'next' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'previous' })).toBeInTheDocument();
        // Three dots (aria-label "featured N").
        expect(screen.getAllByRole('button', { name: /^featured \d$/ })).toHaveLength(3);
    });

    it('advances to the next slide when the next arrow is clicked', () => {
        renderCarousel(makeItems(['A', 'B', 'C']));
        expect(screen.getByTestId('hero-slide')).toHaveTextContent('A');
        fireEvent.click(screen.getByRole('button', { name: 'next' }));
        expect(screen.getByTestId('hero-slide')).toHaveTextContent('B');
    });

    it('wraps to the last slide when previous is clicked from the first', () => {
        renderCarousel(makeItems(['A', 'B', 'C']));
        fireEvent.click(screen.getByRole('button', { name: 'previous' }));
        expect(screen.getByTestId('hero-slide')).toHaveTextContent('C');
    });

    it('changes slides after a horizontal swipe on mobile', () => {
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: query.includes('max-width'),
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })) as never;
        renderCarousel(makeItems(['A', 'B', 'C']));
        const carousel = screen.getByTestId('favorite-hero-carousel');

        fireEvent.touchStart(carousel, { touches: [{ clientX: 240, clientY: 80 }] });
        fireEvent.touchEnd(carousel, { changedTouches: [{ clientX: 140, clientY: 84 }] });

        expect(screen.getByTestId('hero-slide')).toHaveTextContent('B');
    });

    it('jumps to a slide when its dot is clicked', () => {
        renderCarousel(makeItems(['A', 'B', 'C']));
        fireEvent.click(screen.getByRole('button', { name: 'featured 3' }));
        expect(screen.getByTestId('hero-slide')).toHaveTextContent('C');
    });

    it('auto-advances on a timer', () => {
        vi.useFakeTimers();
        renderCarousel(makeItems(['A', 'B']));
        expect(screen.getByTestId('hero-slide')).toHaveTextContent('A');
        act(() => {
            vi.advanceTimersByTime(7000);
        });
        expect(screen.getByTestId('hero-slide')).toHaveTextContent('B');
    });
});
