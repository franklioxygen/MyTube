import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ActionSheet from '../ActionSheet';

afterEach(() => vi.restoreAllMocks());

describe('ActionSheet motion', () => {
    it('dims the background by default and requests close on backdrop click', () => {
        const onClose = vi.fn();
        render(<ActionSheet open onClose={onClose}>Share</ActionSheet>);
        const backdrop = document.querySelector('.MuiBackdrop-root');
        expect(backdrop).toBeInTheDocument();
        expect(backdrop).not.toHaveClass('MuiBackdrop-invisible');
        fireEvent.click(backdrop!);
        expect(onClose).toHaveBeenCalledWith(expect.anything(), 'backdropClick');
    });

    it('plays an entrance on first mount and retains the panel until its exit finishes', async () => {
        const onEnter = vi.fn();
        const onExited = vi.fn();
        const slotProps = {
            paper: { 'aria-label': 'Actions' },
            transition: { onEnter, onExited },
        };
        const { rerender } = render(<ActionSheet open slotProps={slotProps}>Share</ActionSheet>);
        const panel = screen.getByRole('dialog', { name: 'Actions' });
        expect(panel).toHaveClass('MuiDrawer-paperAnchorBottom');
        expect(onEnter).toHaveBeenCalledTimes(1);

        rerender(<ActionSheet open={false} slotProps={slotProps}>Share</ActionSheet>);
        expect(panel).toBeInTheDocument();
        expect(panel.style.transform).toContain('translateY');
        expect(onExited).not.toHaveBeenCalled();
        await waitFor(() => expect(onExited).toHaveBeenCalledTimes(1));
        expect(panel).not.toBeInTheDocument();
    });

    it('preserves side-sheet direction and transition callbacks from slot functions', async () => {
        const onEnter = vi.fn();
        const onExited = vi.fn();
        const slotProps = {
            paper: { 'aria-label': 'Danmaku' },
            transition: () => ({ onEnter, onExited }),
        };
        const { rerender } = render(<ActionSheet anchor="right" open slotProps={slotProps}>Opacity</ActionSheet>);
        const panel = screen.getByRole('dialog', { name: 'Danmaku' });
        expect(panel).toHaveClass('MuiDrawer-paperAnchorRight');
        expect(onEnter).toHaveBeenCalledTimes(1);

        rerender(<ActionSheet anchor="right" open={false} slotProps={slotProps}>Opacity</ActionSheet>);
        expect(panel.style.transform).toContain('translateX');
        await waitFor(() => expect(onExited).toHaveBeenCalledTimes(1));
    });

    it('honours reduced motion without losing exit cleanup', async () => {
        vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
            matches: query === '(prefers-reduced-motion: reduce)',
            media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
            addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
        }));
        const onExited = vi.fn();
        const slotProps = { paper: { 'aria-label': 'Actions' }, transition: { onExited } };
        const { rerender } = render(<ActionSheet open slotProps={slotProps}>Share</ActionSheet>);
        const panel = screen.getByRole('dialog', { name: 'Actions' });
        expect(panel.style.transition).toContain('transform 0ms');

        rerender(<ActionSheet open={false} slotProps={slotProps}>Share</ActionSheet>);
        await waitFor(() => expect(onExited).toHaveBeenCalledTimes(1));
        expect(panel).not.toBeInTheDocument();
    });
});
