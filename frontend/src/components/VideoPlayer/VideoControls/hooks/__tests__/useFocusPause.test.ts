import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFocusPause } from '../useFocusPause';

describe('useFocusPause', () => {
    let videoMock: HTMLVideoElement;
    let videoRef: React.RefObject<HTMLVideoElement>;

    beforeEach(() => {
        videoMock = {
            play: vi.fn().mockResolvedValue(undefined),
            pause: vi.fn(),
            paused: false,
        } as unknown as HTMLVideoElement;

        videoRef = { current: videoMock };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should pause video on window blur if playing', () => {
        renderHook(() => useFocusPause(videoRef, true));

        // Simulate playing state
        Object.defineProperty(videoMock, 'paused', { value: false, writable: true });

        // Trigger blur
        window.dispatchEvent(new Event('blur'));

        expect(videoMock.pause).toHaveBeenCalled();
    });

    it('should not pause video on window blur if already paused', () => {
        renderHook(() => useFocusPause(videoRef, true));

        // Simulate paused state
        Object.defineProperty(videoMock, 'paused', { value: true, writable: true });

        // Trigger blur
        window.dispatchEvent(new Event('blur'));

        expect(videoMock.pause).not.toHaveBeenCalled();
    });

    it('should resume video on window focus if it was paused by blur', () => {
        renderHook(() => useFocusPause(videoRef, true));

        // 1. Play
        Object.defineProperty(videoMock, 'paused', { value: false, writable: true });
        
        // 2. Blur (pauses)
        window.dispatchEvent(new Event('blur'));
        expect(videoMock.pause).toHaveBeenCalled();

        // 3. Focus (resumes)
        window.dispatchEvent(new Event('focus'));
        expect(videoMock.play).toHaveBeenCalled();
    });

    it('should NOT resume video on window focus if it was NOT playing before blur', () => {
        renderHook(() => useFocusPause(videoRef, true));

        // 1. Paused initially
        Object.defineProperty(videoMock, 'paused', { value: true, writable: true });
        
        // 2. Blur
        window.dispatchEvent(new Event('blur'));
        
        // 3. Focus
        window.dispatchEvent(new Event('focus'));
        expect(videoMock.play).not.toHaveBeenCalled();
    });

    it('should do nothing if disabled', () => {
        renderHook(() => useFocusPause(videoRef, false));

        Object.defineProperty(videoMock, 'paused', { value: false, writable: true });

        window.dispatchEvent(new Event('blur'));
        expect(videoMock.pause).not.toHaveBeenCalled();
    });

    it('should pause on visibilitychange hidden', () => {
        renderHook(() => useFocusPause(videoRef, true));
        Object.defineProperty(videoMock, 'paused', { value: false, writable: true });
        
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
        document.dispatchEvent(new Event('visibilitychange'));

        expect(videoMock.pause).toHaveBeenCalled();
    });

    it('should resume on visibilitychange visible', () => {
        renderHook(() => useFocusPause(videoRef, true));
        
        // Pause via blur/hidden first
        Object.defineProperty(videoMock, 'paused', { value: false, writable: true });
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        expect(videoMock.pause).toHaveBeenCalled();

        // Resume
        Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        expect(videoMock.play).toHaveBeenCalled();
    });
});
