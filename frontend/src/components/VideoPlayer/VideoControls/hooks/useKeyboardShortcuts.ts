import { useEffect, useRef } from "react";
import {
  isOverlayTarget,
  isTypingTarget,
} from "../../../../utils/keyboardShortcutGuards";

export interface KeyboardShortcutHandlers {
  onPlayPause: () => void;
  /** Short step, bound to the arrow keys. */
  onSeekLeft: () => void;
  onSeekRight: () => void;
  /** Longer step, bound to j / l the way YouTube binds them. */
  onSeekBack?: () => void;
  onSeekForward?: () => void;
  onVolumeUp?: () => void;
  onVolumeDown?: () => void;
  onToggleMute?: () => void;
  onToggleFullscreen?: () => void;
  onToggleCinemaMode?: () => void;
  onToggleSubtitles?: () => void;
  onSpeedUp?: () => void;
  onSpeedDown?: () => void;
  /** 0-9, Home and End all land here as a 0-1 position in the video. */
  onSeekToFraction?: (fraction: number) => void;
  onFrameStep?: (direction: -1 | 1) => void;
  onNextVideo?: () => void;
  onPreviousVideo?: () => void;
}

interface ShortcutAction {
  run?: () => void;
  /** Rate-limited actions: the ones that move playback position. */
  isSeek?: boolean;
}

const DEBOUNCE_MS = 100; // Minimum time between seeks (100ms)

const resolveAction = (
  event: KeyboardEvent,
  handlers: KeyboardShortcutHandlers,
): ShortcutAction | undefined => {
  // Lower-cased throughout so "K", "ArrowLeft" and "Spacebar" all match one
  // spelling; shift is read from the event rather than from the character.
  const key = event.key.toLowerCase();

  // Shift is the only modifier a shortcut carries. Anything held with ctrl,
  // meta or alt belongs to the browser - cmd+left is Back, ctrl+f is Find -
  // and stealing those would be worse than not having the shortcut.
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return undefined;
  }

  if (event.shiftKey) {
    switch (key) {
      case "n":
        return { run: handlers.onNextVideo };
      case "p":
        return { run: handlers.onPreviousVideo };
      // Shift usually produces these characters directly, so the character is
      // what gets matched. The unshifted keys are accepted too, for layouts
      // and input stacks that report the physical key instead.
      case ">":
      case ".":
        return { run: handlers.onSpeedUp };
      case "<":
      case ",":
        return { run: handlers.onSpeedDown };
      default:
        return undefined;
    }
  }

  switch (key) {
    case " ":
    case "spacebar":
    case "k":
      return { run: handlers.onPlayPause };
    case "arrowleft":
      return { run: handlers.onSeekLeft, isSeek: true };
    case "arrowright":
      return { run: handlers.onSeekRight, isSeek: true };
    case "j":
      return { run: handlers.onSeekBack, isSeek: true };
    case "l":
      return { run: handlers.onSeekForward, isSeek: true };
    case "arrowup":
      return { run: handlers.onVolumeUp };
    case "arrowdown":
      return { run: handlers.onVolumeDown };
    case "m":
      return { run: handlers.onToggleMute };
    case "f":
      return { run: handlers.onToggleFullscreen };
    case "t":
      return { run: handlers.onToggleCinemaMode };
    case "c":
      return { run: handlers.onToggleSubtitles };
    case ">":
      return { run: handlers.onSpeedUp };
    case "<":
      return { run: handlers.onSpeedDown };
    case ",":
      return { run: handlers.onFrameStep && (() => handlers.onFrameStep!(-1)) };
    case ".":
      return { run: handlers.onFrameStep && (() => handlers.onFrameStep!(1)) };
    case "home":
      return {
        run: handlers.onSeekToFraction && (() => handlers.onSeekToFraction!(0)),
        isSeek: true,
      };
    case "end":
      return {
        run: handlers.onSeekToFraction && (() => handlers.onSeekToFraction!(1)),
        isSeek: true,
      };
    default:
      break;
  }

  if (key >= "0" && key <= "9") {
    const fraction = Number(key) / 10;
    return {
      run:
        handlers.onSeekToFraction &&
        (() => handlers.onSeekToFraction!(fraction)),
      isSeek: true,
    };
  }

  return undefined;
};

export const useKeyboardShortcuts = (handlers: KeyboardShortcutHandlers) => {
  const lastSeekTimeRef = useRef<number>(0);
  // The handler set is rebuilt on most renders (playback rate, volume and
  // subtitle state all feed it), so it is read through a ref rather than
  // re-registering the window listener each time.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const handleKeyboardEvent = (e: KeyboardEvent) => {
      // Ignore shortcuts while the user is editing form or rich-text content,
      // or while a dialog or menu owns the keyboard.
      if (isTypingTarget(e) || isOverlayTarget(e)) {
        return;
      }

      const action = resolveAction(e, handlersRef.current);
      if (!action?.run) {
        return;
      }

      // Prevent default browser behavior (scrolling on space and the arrows,
      // quick-find on the letters in some browsers)
      e.preventDefault();
      e.stopPropagation();

      // Ignore key repeat events (when key is held down)
      if (e.repeat) {
        return;
      }

      if (action.isSeek) {
        // Debounce: prevent rapid successive seeks
        const now = Date.now();
        if (now - lastSeekTimeRef.current < DEBOUNCE_MS) {
          return;
        }
        lastSeekTimeRef.current = now;
      }

      action.run();
    };

    window.addEventListener("keydown", handleKeyboardEvent);
    return () => {
      window.removeEventListener("keydown", handleKeyboardEvent);
    };
  }, []);
};
