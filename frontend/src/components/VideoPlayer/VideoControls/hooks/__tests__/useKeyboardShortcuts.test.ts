import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';

describe('useKeyboardShortcuts', () => {
  const onSeekLeft = vi.fn();
  const onSeekRight = vi.fn();
  const onPlayPause = vi.fn();

  beforeEach(() => {
    onSeekLeft.mockClear();
    onSeekRight.mockClear();
    onPlayPause.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should handle ArrowLeft key', () => {
    renderHook(() => useKeyboardShortcuts({ onSeekLeft, onSeekRight, onPlayPause }));

    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft' });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    const stopPropagationSpy = vi.spyOn(event, 'stopPropagation');

    window.dispatchEvent(event);

    expect(onSeekLeft).toHaveBeenCalledTimes(1);
    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  it('should handle ArrowRight key', () => {
    renderHook(() => useKeyboardShortcuts({ onSeekLeft, onSeekRight, onPlayPause }));

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight' });
    window.dispatchEvent(event);

    expect(onSeekRight).toHaveBeenCalledTimes(1);
  });

  it('should ignore input when typing in an input element', () => {
    renderHook(() => useKeyboardShortcuts({ onSeekLeft, onSeekRight, onPlayPause }));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft' });
    window.dispatchEvent(event);

    expect(onSeekLeft).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('should ignore shortcuts when a select element is focused', () => {
    renderHook(() => useKeyboardShortcuts({ onSeekLeft, onSeekRight, onPlayPause }));

    const select = document.createElement('select');
    document.body.appendChild(select);
    select.focus();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));

    expect(onSeekRight).not.toHaveBeenCalled();
    document.body.removeChild(select);
  });

  it('should ignore shortcuts when contenteditable is focused', () => {
    renderHook(() => useKeyboardShortcuts({ onSeekLeft, onSeekRight, onPlayPause }));

    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.tabIndex = 0;
    document.body.appendChild(editor);
    editor.focus();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));

    expect(onSeekLeft).not.toHaveBeenCalled();
    document.body.removeChild(editor);
  });

  it('should ignore key repeat events', () => {
    renderHook(() => useKeyboardShortcuts({ onSeekLeft, onSeekRight, onPlayPause }));

    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', repeat: true });
    window.dispatchEvent(event);

    expect(onSeekLeft).not.toHaveBeenCalled();
  });

  it('should debounce rapid key presses', () => {
    renderHook(() => useKeyboardShortcuts({ onSeekLeft, onSeekRight, onPlayPause }));

    // First press
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(onSeekLeft).toHaveBeenCalledTimes(1);

    // Immediate second press (should be ignored due to debounce)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(onSeekLeft).toHaveBeenCalledTimes(1);

    // Advance time by 101ms (debounce is 100ms)
    vi.advanceTimersByTime(101);

    // Third press (should work)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(onSeekLeft).toHaveBeenCalledTimes(2);
  });

  it('should not interfere with other keys', () => {
    renderHook(() => useKeyboardShortcuts({ onSeekLeft, onSeekRight, onPlayPause }));

    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    
    window.dispatchEvent(event);

    expect(onSeekLeft).not.toHaveBeenCalled();
    expect(onSeekRight).not.toHaveBeenCalled();
    expect(onPlayPause).not.toHaveBeenCalled();
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('should handle space bar key for play/pause', () => {
    renderHook(() => useKeyboardShortcuts({ onSeekLeft, onSeekRight, onPlayPause }));

    const event = new KeyboardEvent('keydown', { key: ' ' });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    const stopPropagationSpy = vi.spyOn(event, 'stopPropagation');

    window.dispatchEvent(event);

    expect(onPlayPause).toHaveBeenCalledTimes(1);
    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  it('should handle Spacebar key for play/pause (legacy)', () => {
    renderHook(() => useKeyboardShortcuts({ onSeekLeft, onSeekRight, onPlayPause }));

    const event = new KeyboardEvent('keydown', { key: 'Spacebar' });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    window.dispatchEvent(event);

    expect(onPlayPause).toHaveBeenCalledTimes(1);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('should ignore space bar when typing in an input element', () => {
    renderHook(() => useKeyboardShortcuts({ onSeekLeft, onSeekRight, onPlayPause }));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', { key: ' ' });
    window.dispatchEvent(event);

    expect(onPlayPause).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('should ignore space bar key repeat events', () => {
    renderHook(() => useKeyboardShortcuts({ onSeekLeft, onSeekRight, onPlayPause }));

    const event = new KeyboardEvent('keydown', { key: ' ', repeat: true });
    window.dispatchEvent(event);

    expect(onPlayPause).not.toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts - YouTube-style bindings', () => {
  const handlers = {
    onPlayPause: vi.fn(),
    onSeekLeft: vi.fn(),
    onSeekRight: vi.fn(),
    onSeekBack: vi.fn(),
    onSeekForward: vi.fn(),
    onVolumeUp: vi.fn(),
    onVolumeDown: vi.fn(),
    onToggleMute: vi.fn(),
    onToggleFullscreen: vi.fn(),
    onToggleCinemaMode: vi.fn(),
    onToggleSubtitles: vi.fn(),
    onSpeedUp: vi.fn(),
    onSpeedDown: vi.fn(),
    onSeekToFraction: vi.fn(),
    onFrameStep: vi.fn(),
    onNextVideo: vi.fn(),
    onPreviousVideo: vi.fn()
  };

  const press = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, ...init });
    window.dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    Object.values(handlers).forEach((handler) => handler.mockClear());
    vi.useFakeTimers();
    renderHook(() => useKeyboardShortcuts(handlers));
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it.each([
    ['k', 'onPlayPause'],
    ['K', 'onPlayPause'],
    ['m', 'onToggleMute'],
    ['f', 'onToggleFullscreen'],
    ['t', 'onToggleCinemaMode'],
    ['c', 'onToggleSubtitles'],
    ['ArrowUp', 'onVolumeUp'],
    ['ArrowDown', 'onVolumeDown']
  ] as const)('binds %s', (key, handlerName) => {
    press(key);
    expect(handlers[handlerName]).toHaveBeenCalledTimes(1);
  });

  it('binds j and l to the longer seek step', () => {
    press('j');
    vi.advanceTimersByTime(101);
    press('l');

    expect(handlers.onSeekBack).toHaveBeenCalledTimes(1);
    expect(handlers.onSeekForward).toHaveBeenCalledTimes(1);
  });

  it('binds < and > to playback speed', () => {
    press('>', { shiftKey: true });
    press('<', { shiftKey: true });

    expect(handlers.onSpeedUp).toHaveBeenCalledTimes(1);
    expect(handlers.onSpeedDown).toHaveBeenCalledTimes(1);
  });

  it('seeks to the digit percentage of the video', () => {
    press('3');
    expect(handlers.onSeekToFraction).toHaveBeenCalledWith(0.3);

    vi.advanceTimersByTime(101);
    press('0');
    expect(handlers.onSeekToFraction).toHaveBeenLastCalledWith(0);
  });

  it('seeks to the ends with Home and End', () => {
    press('Home');
    expect(handlers.onSeekToFraction).toHaveBeenCalledWith(0);

    vi.advanceTimersByTime(101);
    press('End');
    expect(handlers.onSeekToFraction).toHaveBeenLastCalledWith(1);
  });

  it('steps frames with , and .', () => {
    press(',');
    press('.');

    expect(handlers.onFrameStep).toHaveBeenNthCalledWith(1, -1);
    expect(handlers.onFrameStep).toHaveBeenNthCalledWith(2, 1);
  });

  it('walks Up Next with shift+N and shift+P', () => {
    press('N', { shiftKey: true });
    press('P', { shiftKey: true });

    expect(handlers.onNextVideo).toHaveBeenCalledTimes(1);
    expect(handlers.onPreviousVideo).toHaveBeenCalledTimes(1);
  });

  it('leaves browser shortcuts alone', () => {
    const withMeta = press('l', { metaKey: true });
    const withCtrl = press('ArrowLeft', { ctrlKey: true });

    expect(handlers.onSeekForward).not.toHaveBeenCalled();
    expect(handlers.onSeekLeft).not.toHaveBeenCalled();
    expect(withMeta.defaultPrevented).toBe(false);
    expect(withCtrl.defaultPrevented).toBe(false);
  });

  it('leaves a focused slider its own arrow and Home keys', () => {
    // The player's progress and volume controls are MUI Sliders, whose
    // focusable element is an <input type="range"> - the arrows and Home/End
    // belong to it while it has focus.
    const slider = document.createElement('input');
    slider.type = 'range';
    document.body.appendChild(slider);
    slider.focus();

    press('ArrowUp');
    press('Home');
    press('k');

    expect(handlers.onVolumeUp).not.toHaveBeenCalled();
    expect(handlers.onSeekToFraction).not.toHaveBeenCalled();
    expect(handlers.onPlayPause).not.toHaveBeenCalled();
  });

  it('stays quiet while a menu owns the keyboard', () => {
    // A menu takes focus when it opens, which is what the guard reads.
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('button');
    menu.appendChild(item);
    document.body.appendChild(menu);
    item.focus();

    press('f');

    expect(handlers.onToggleFullscreen).not.toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts - unbound keys', () => {
  it('does not claim a key it has no handler for', () => {
    const onToggleCinemaMode = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({
        onPlayPause: vi.fn(),
        onSeekLeft: vi.fn(),
        onSeekRight: vi.fn()
      })
    );

    const event = new KeyboardEvent('keydown', { key: 't' });
    window.dispatchEvent(event);

    expect(onToggleCinemaMode).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
