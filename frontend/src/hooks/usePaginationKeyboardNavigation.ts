import { useEffect } from 'react';
import { isOverlayTarget, isTypingTarget } from '../utils/keyboardShortcutGuards';

interface UsePaginationKeyboardNavigationProps {
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    /** Pass false where paging is not in play at all, e.g. infinite scroll. */
    enabled?: boolean;
}

/**
 * Left and right arrow keys step through a paginated list. Lifted out of Home's
 * pagination so every paged view answers the arrow keys the same way rather than
 * each one re-deriving the guards - and so a page keeping its own page state can
 * have it too.
 */
export const usePaginationKeyboardNavigation = ({
    page,
    totalPages,
    onPageChange,
    enabled = true
}: UsePaginationKeyboardNavigationProps): void => {
    useEffect(() => {
        if (!enabled) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            // Don't page while the viewer is typing, or while a dialog or
            // menu owns the keyboard. Both guards live in one place so the
            // player's shortcuts answer these the same way - see
            // utils/keyboardShortcutGuards.
            if (isTypingTarget(event) || isOverlayTarget(event)) {
                return;
            }

            // Only handle if there are multiple pages
            if (totalPages <= 1) {
                return;
            }

            if (event.key === 'ArrowLeft' && page > 1) {
                event.preventDefault();
                onPageChange(page - 1);
            } else if (event.key === 'ArrowRight' && page < totalPages) {
                event.preventDefault();
                onPageChange(page + 1);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [enabled, page, totalPages, onPageChange]);
};
