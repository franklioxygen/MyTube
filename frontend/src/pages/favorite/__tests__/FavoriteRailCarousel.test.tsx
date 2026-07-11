import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FavoriteRailCarousel from '../FavoriteRailCarousel';

// jsdom has no ResizeObserver; the component now guards it, but stub it anyway
// so the observe path is exercised without throwing.
beforeEach(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
        observe() {}
        disconnect() {}
    };
});

const renderRail = () =>
    render(
        <ThemeProvider theme={createTheme()}>
            <FavoriteRailCarousel prevLabel="previous" nextLabel="next">
                <div>card 1</div>
                <div>card 2</div>
            </FavoriteRailCarousel>
        </ThemeProvider>,
    );

// Force the scroller to report an overflowing, scrolled-to-start layout.
const stubOverflow = (el: HTMLElement, scrollLeft = 0) => {
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: 200 });
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: 1000 });
    Object.defineProperty(el, 'scrollLeft', { configurable: true, writable: true, value: scrollLeft });
};

describe('FavoriteRailCarousel', () => {
    it('renders its children', () => {
        renderRail();
        expect(screen.getByText('card 1')).toBeInTheDocument();
        expect(screen.getByText('card 2')).toBeInTheDocument();
    });

    it('hides both arrows when the rail does not overflow', () => {
        renderRail();
        // jsdom default layout: clientWidth === scrollWidth === 0 → nothing to scroll.
        expect(screen.queryByRole('button', { name: 'next' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'previous' })).not.toBeInTheDocument();
    });

    it('shows the next arrow once the rail overflows, and hides previous at the start', () => {
        renderRail();
        const scroller = screen.getByTestId('rail-scroller');
        stubOverflow(scroller, 0);
        fireEvent.scroll(scroller);

        expect(screen.getByRole('button', { name: 'next' })).toBeInTheDocument();
        // At scrollLeft 0 there is nothing to the left yet.
        expect(screen.queryByRole('button', { name: 'previous' })).not.toBeInTheDocument();
    });

    it('scrolls by a page when the next arrow is clicked', () => {
        renderRail();
        const scroller = screen.getByTestId('rail-scroller');
        stubOverflow(scroller, 0);
        fireEvent.scroll(scroller);

        const scrollBy = vi.fn();
        (scroller as unknown as { scrollBy: unknown }).scrollBy = scrollBy;
        fireEvent.click(screen.getByRole('button', { name: 'next' }));

        expect(scrollBy).toHaveBeenCalledWith(
            expect.objectContaining({ left: 200 * 0.8, behavior: 'smooth' }),
        );
    });

    it('shows the previous arrow after scrolling away from the start', () => {
        renderRail();
        const scroller = screen.getByTestId('rail-scroller');
        stubOverflow(scroller, 300);
        fireEvent.scroll(scroller);

        expect(screen.getByRole('button', { name: 'previous' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'next' })).toBeInTheDocument();
    });
});
