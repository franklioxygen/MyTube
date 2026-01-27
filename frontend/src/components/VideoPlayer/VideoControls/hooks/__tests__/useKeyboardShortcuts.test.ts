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
