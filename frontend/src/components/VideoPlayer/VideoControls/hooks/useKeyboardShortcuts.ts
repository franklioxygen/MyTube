import { useEffect } from 'react';

interface UseKeyboardShortcutsProps {
    onSeekLeft: () => void;
    onSeekRight: () => void;
}

export const useKeyboardShortcuts = ({ onSeekLeft, onSeekRight }: UseKeyboardShortcutsProps) => {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if typing in an input or textarea
            if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) {
                return;
            }

            if (e.key === 'ArrowLeft') {
                onSeekLeft();
            } else if (e.key === 'ArrowRight') {
                onSeekRight();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onSeekLeft, onSeekRight]);
};

