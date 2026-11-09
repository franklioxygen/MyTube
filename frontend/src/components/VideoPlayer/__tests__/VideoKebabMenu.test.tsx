import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VideoKebabMenu from '../VideoInfo/VideoKebabMenu';

let mockUserRole = 'admin';
let mockIsMobile = false;

vi.mock('@mui/material', async (importOriginal) => {
    const original = await importOriginal<typeof import('@mui/material')>();
    return {
        ...original,
        useMediaQuery: (query: string) => query.includes('max-width') && mockIsMobile,
    };
});

const mockT = vi.fn((key: string) => key);

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: mockT }),
}));

vi.mock('../../../contexts/AuthContext', () => ({
    useAuth: () => ({ userRole: mockUserRole }),
}));

describe('VideoKebabMenu', () => {
    const anchor = document.createElement('button');
    const onClose = vi.fn();
    const onPlayWith = vi.fn();
    const onShare = vi.fn();
    const onAddToCollection = vi.fn();
    const onDelete = vi.fn();
    const onToggleVisibility = vi.fn();
    const onToggleLock = vi.fn();
    const onAddTag = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockUserRole = 'admin';
        mockIsMobile = false;
        document.body.appendChild(anchor);
    });

    it('renders admin actions and wires callbacks through close handlers', () => {
        render(
            <VideoKebabMenu
                kebabMenuAnchor={anchor}
                onClose={onClose}
                onPlayWith={onPlayWith}
                onShare={onShare}
                onAddToCollection={onAddToCollection}
                onDelete={onDelete}
                onToggleVisibility={onToggleVisibility}
                onAddTag={onAddTag}
                video={{ visibility: 1 }}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'playWith' }));
        expect(onPlayWith).toHaveBeenCalledWith(anchor);

        fireEvent.click(screen.getByRole('button', { name: 'share' }));
        expect(onShare).toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'hideVideo' }));
        expect(onToggleVisibility).toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'addToCollection' }));
        expect(onAddToCollection).toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'delete' }));
        expect(onDelete).toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'addTag' }));
        expect(onAddTag).toHaveBeenCalled();

        expect(onClose).toHaveBeenCalledTimes(6);
    });

    it('shows the show-video action for hidden videos and disables delete while deleting', () => {
        render(
            <VideoKebabMenu
                kebabMenuAnchor={anchor}
                onClose={onClose}
                onPlayWith={onPlayWith}
                onShare={onShare}
                onAddToCollection={onAddToCollection}
                onDelete={onDelete}
                isDeleting={true}
                onToggleVisibility={onToggleVisibility}
                video={{ visibility: 0 }}
            />
        );

        expect(screen.getByRole('button', { name: 'showVideo' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'delete' })).toBeDisabled();
    });

    it('hides admin-only actions for visitors', () => {
        mockUserRole = 'visitor';

        render(
            <VideoKebabMenu
                kebabMenuAnchor={anchor}
                onClose={onClose}
                onPlayWith={onPlayWith}
                onShare={onShare}
                onAddToCollection={onAddToCollection}
                onDelete={onDelete}
                onToggleVisibility={onToggleVisibility}
                onToggleLock={onToggleLock}
                onAddTag={onAddTag}
                video={{ visibility: 1 }}
            />
        );

        expect(screen.getByRole('button', { name: 'playWith' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'share' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'hideVideo' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'addToCollection' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'delete' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'addTag' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'lockVideo' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'unlockVideo' })).not.toBeInTheDocument();
    });

    it('shows the lock action for unlocked videos and wires the callback', () => {
        render(
            <VideoKebabMenu
                kebabMenuAnchor={anchor}
                onClose={onClose}
                onPlayWith={onPlayWith}
                onShare={onShare}
                onAddToCollection={onAddToCollection}
                onToggleLock={onToggleLock}
                isLocked={false}
                video={{ visibility: 1 }}
            />
        );

        const lockButton = screen.getByRole('button', { name: 'lockVideo' });
        expect(lockButton).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'unlockVideo' })).not.toBeInTheDocument();

        fireEvent.click(lockButton);
        expect(onToggleLock).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it('shows the unlock action for locked videos', () => {
        render(
            <VideoKebabMenu
                kebabMenuAnchor={anchor}
                onClose={onClose}
                onPlayWith={onPlayWith}
                onShare={onShare}
                onAddToCollection={onAddToCollection}
                onToggleLock={onToggleLock}
                isLocked={true}
                video={{ visibility: 1 }}
            />
        );

        expect(screen.getByRole('button', { name: 'unlockVideo' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'lockVideo' })).not.toBeInTheDocument();
    });

    it('renders labeled mobile actions with delete last and runs each callback after closing', () => {
        mockIsMobile = true;
        render(
            <VideoKebabMenu
                kebabMenuAnchor={anchor}
                onClose={onClose}
                onPlayWith={onPlayWith}
                onShare={onShare}
                onAddToCollection={onAddToCollection}
                onDelete={onDelete}
                onToggleVisibility={onToggleVisibility}
                onToggleLock={onToggleLock}
                onAddTag={onAddTag}
                video={{ visibility: 1 }}
            />
        );

        const dialog = screen.getByRole('dialog', { name: 'actions' });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        const buttons = within(dialog).getAllByRole('button');
        expect(buttons.map(button => button.textContent)).toEqual([
            '', 'share', 'playWith', 'addToCollection', 'addTag', 'hideVideo', 'lockVideo', 'delete',
        ]);
        const callbacks = [onShare, onPlayWith, onAddToCollection, onAddTag, onToggleVisibility, onToggleLock, onDelete];
        buttons.slice(1).forEach((button, index) => {
            fireEvent.click(button);
            expect(callbacks[index]).toHaveBeenCalledTimes(1);
            expect(onClose.mock.invocationCallOrder[index]).toBeLessThan(callbacks[index].mock.invocationCallOrder[0]);
        });
        expect(onPlayWith).toHaveBeenCalledWith(anchor);
    });

    it('limits mobile visitors to playback and sharing and supports closing the sheet', () => {
        mockIsMobile = true;
        mockUserRole = 'visitor';
        render(
            <VideoKebabMenu
                kebabMenuAnchor={anchor}
                onClose={onClose}
                onPlayWith={onPlayWith}
                onShare={onShare}
                onAddToCollection={onAddToCollection}
                onDelete={onDelete}
                onToggleVisibility={onToggleVisibility}
                onToggleLock={onToggleLock}
                onAddTag={onAddTag}
            />
        );

        const dialog = screen.getByRole('dialog', { name: 'actions' });
        expect(within(dialog).getAllByRole('button')).toHaveLength(3);
        expect(within(dialog).getByRole('button', { name: 'share' })).toHaveTextContent('share');
        expect(within(dialog).getByRole('button', { name: 'playWith' })).toHaveTextContent('playWith');
        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
        fireEvent.click(within(dialog).getByRole('button', { name: 'close' }));
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('disables mobile actions while their mutations are pending', () => {
        mockIsMobile = true;
        render(
            <VideoKebabMenu
                kebabMenuAnchor={anchor}
                onClose={onClose}
                onPlayWith={onPlayWith}
                onShare={onShare}
                onAddToCollection={onAddToCollection}
                onDelete={onDelete}
                isDeleting
                onToggleVisibility={onToggleVisibility}
                isTogglingVisibility
                onToggleLock={onToggleLock}
                isTogglingLock
                isLocked
                video={{ visibility: 0 }}
            />
        );
        for (const name of ['delete', 'showVideo', 'unlockVideo']) {
            const button = screen.getByRole('button', { name });
            expect(button).toBeDisabled();
            fireEvent.click(button);
        }
        expect(onClose).not.toHaveBeenCalled();
        expect(onDelete).not.toHaveBeenCalled();
        expect(onToggleVisibility).not.toHaveBeenCalled();
        expect(onToggleLock).not.toHaveBeenCalled();
    });
});
