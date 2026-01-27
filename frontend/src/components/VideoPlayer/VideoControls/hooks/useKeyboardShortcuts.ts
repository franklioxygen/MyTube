import { useEffect, useRef } from "react";

interface UseKeyboardShortcutsProps {
  onSeekLeft: () => void;
  onSeekRight: () => void;
}

export const useKeyboardShortcuts = ({
  onSeekLeft,
  onSeekRight,
}: UseKeyboardShortcutsProps) => {
  const lastSeekTimeRef = useRef<number>(0);
  const DEBOUNCE_MS = 100; // Minimum time between seeks (100ms)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input or textarea
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Only handle ArrowLeft and ArrowRight
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") {
        return;
      }

      // Prevent default browser behavior
      e.preventDefault();
      e.stopPropagation();

      // Ignore key repeat events (when key is held down)
      if (e.repeat) {
        return;
      }

      // Debounce: prevent rapid successive seeks
      const now = Date.now();
      if (now - lastSeekTimeRef.current < DEBOUNCE_MS) {
        return;
      }
      lastSeekTimeRef.current = now;

      // Execute seek
      if (e.key === "ArrowLeft") {
        onSeekLeft();
      } else if (e.key === "ArrowRight") {
        onSeekRight();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onSeekLeft, onSeekRight]);
};
