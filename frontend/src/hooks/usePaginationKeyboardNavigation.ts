import { useEffect } from 'react';

// Roles an overlay announces itself with, whether or not it traps focus:
// dialogs and alerts, and the menus and listboxes a select or sort control
// opens. Matching on the role rather than a component keeps this working for
// any overlay the app grows later.
const OVERLAY_SELECTOR =
    '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

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
            // Don't handle keyboard navigation if user is typing in an input field
            const eventTarget = event.target as HTMLElement;
            if (eventTarget.tagName === 'INPUT' || eventTarget.tagName === 'TEXTAREA' || eventTarget.isContentEditable) {
                return;
            }

            // A dialog or menu owns the keyboard for as long as it is open. Its
            // keydowns still bubble out to this listener, and arrow keys inside
            // one belong to its own chips and items - paging the grid behind it
            // means closing it reveals a page the viewer never asked for. The
            // open-modal check covers a keypress that lands outside the dialog,
            // such as after a click on the backdrop.
            if (document.querySelector('[aria-modal="true"]')) {
                return;
            }

            if (eventTarget.closest?.(OVERLAY_SELECTOR)) {
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
