import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VideoKebabMenuButtons from '../VideoInfo/VideoKebabMenuButtons';

let mockIsMobile = false;

vi.mock('@mui/material', async (importOriginal) => {
    const original = await importOriginal<typeof import('@mui/material')>();
    return {
        ...original,
        useMediaQuery: (query: string) => query.includes('max-width') && mockIsMobile,
    };
});

vi.mock('../VideoInfo/VideoKebabMenu', () => ({
    default: ({ kebabMenuAnchor, open, onClose, onExited, onDelete, video }: any) => (
        <div data-testid="mock-kebab-menu" data-open={open}>
            <span data-testid="anchor-tag">{kebabMenuAnchor.tagName}</span>
            <span data-testid="delete-enabled">{String(Boolean(onDelete))}</span>
            <span data-testid="video-visibility">{String(video?.visibility ?? '')}</span>
            <button onClick={onClose}>close-menu</button>
            <button onClick={onExited}>finish-exit</button>
        </div>
    )
}));

describe('VideoKebabMenuButtons', () => {
    const baseProps = {
        onPlayWith: vi.fn(),
        onShare: vi.fn(),
        onAddToCollection: vi.fn(),
        onDelete: vi.fn(),
        onToggleVisibility: vi.fn(),
        onAddTag: vi.fn(),
        video: { visibility: 1 },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockIsMobile = false;
    });

    it('opens the kebab menu and passes the anchor and props through', async () => {
        render(<VideoKebabMenuButtons {...baseProps} />);

        fireEvent.click(screen.getByRole('button', { name: /more actions/i }));

        expect(await screen.findByTestId('mock-kebab-menu')).toBeInTheDocument();
        expect(screen.getByTestId('anchor-tag')).toHaveTextContent('BUTTON');
        expect(screen.getByTestId('delete-enabled')).toHaveTextContent('true');
        expect(screen.getByTestId('video-visibility')).toHaveTextContent('1');

        fireEvent.click(screen.getByText('close-menu'));

        // Closing starts the animation; the component is retained until it exits.
        expect(screen.getByTestId('mock-kebab-menu')).toHaveAttribute('data-open', 'false');
        expect(screen.getByTestId('anchor-tag')).toHaveTextContent('BUTTON');
        fireEvent.click(screen.getByText('finish-exit'));

        await waitFor(() => {
            expect(screen.queryByTestId('mock-kebab-menu')).not.toBeInTheDocument();
        });
    });

    it('closes the open menu when the window scrolls', async () => {
        render(<VideoKebabMenuButtons {...baseProps} />);

        fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
        expect(await screen.findByTestId('mock-kebab-menu')).toBeInTheDocument();

        act(() => {
            window.dispatchEvent(new Event('scroll'));
        });

        expect(screen.getByTestId('mock-kebab-menu')).toHaveAttribute('data-open', 'false');
        fireEvent.click(screen.getByText('finish-exit'));

        await waitFor(() => {
            expect(screen.queryByTestId('mock-kebab-menu')).not.toBeInTheDocument();
        });
    });

    it('keeps the mobile sheet open when its content scrolls', async () => {
        mockIsMobile = true;
        render(<VideoKebabMenuButtons {...baseProps} />);
        const trigger = screen.getByRole('button', { name: /more actions/i });
        expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(trigger);
        const sheet = await screen.findByTestId('mock-kebab-menu');
        expect(trigger).toHaveAttribute('aria-expanded', 'true');

        fireEvent.scroll(sheet);
        expect(screen.getByTestId('mock-kebab-menu')).toBeInTheDocument();
        fireEvent.click(screen.getByText('close-menu'));
        await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
        expect(screen.getByTestId('mock-kebab-menu')).toBeInTheDocument();
        fireEvent.click(screen.getByText('finish-exit'));
        expect(screen.queryByTestId('mock-kebab-menu')).not.toBeInTheDocument();
    });

    it('does not clear the anchor if the sheet reopens before its exit completes', async () => {
        mockIsMobile = true;
        render(<VideoKebabMenuButtons {...baseProps} />);
        const trigger = screen.getByRole('button', { name: /more actions/i });
        fireEvent.click(trigger);
        await screen.findByTestId('mock-kebab-menu');
        fireEvent.click(screen.getByText('close-menu'));
        fireEvent.click(trigger);
        fireEvent.click(screen.getByText('finish-exit'));

        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('mock-kebab-menu')).toHaveAttribute('data-open', 'true');
    });
});
