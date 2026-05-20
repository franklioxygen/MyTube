import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useVolume } from '../useVolume';

const originalUserAgent = navigator.userAgent;
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
            store[key] = value;
        },
        removeItem: (key: string) => {
            delete store[key];
        },
        clear: () => {
            store = {};
        },
    };
})();

const setUserAgent = (value: string) => {
    Object.defineProperty(window.navigator, 'userAgent', {
        value,
        configurable: true,
    });
};

function TestHarness({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement | null> }) {
    const { volume, volumeSliderRef } = useVolume(videoRef);

    return <div data-testid="slider" data-volume={volume} ref={volumeSliderRef} />;
}

describe('useVolume', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'localStorage', {
            value: localStorageMock,
            configurable: true,
        });
        localStorageMock.clear();
    });

    afterEach(() => {
        setUserAgent(originalUserAgent);
    });

    it('reverses wheel volume direction for Windows users', () => {
        setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
        localStorageMock.setItem('mytube:player-volume', '0.5');
        localStorageMock.setItem('mytube:player-previous-volume', '0.5');
        const video = document.createElement('video');
        const videoRef = { current: video };
        render(<TestHarness videoRef={videoRef} />);
        const slider = screen.getByTestId('slider');

        fireEvent.wheel(slider, { deltaY: 100 });

        expect(video.volume).toBeCloseTo(0.45);
        expect(slider).toHaveAttribute('data-volume', '0.45');
    });

    it('keeps the current wheel volume direction for macOS users', () => {
        setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
        localStorageMock.setItem('mytube:player-volume', '0.5');
        localStorageMock.setItem('mytube:player-previous-volume', '0.5');
        const video = document.createElement('video');
        const videoRef = { current: video };
        render(<TestHarness videoRef={videoRef} />);
        const slider = screen.getByTestId('slider');

        fireEvent.wheel(slider, { deltaY: 100 });

        expect(video.volume).toBeCloseTo(0.55);
        expect(slider).toHaveAttribute('data-volume', '0.55');
    });

    it('reverses wheel volume direction for Linux users', () => {
        setUserAgent('Mozilla/5.0 (X11; Linux x86_64)');
        localStorageMock.setItem('mytube:player-volume', '0.5');
        localStorageMock.setItem('mytube:player-previous-volume', '0.5');
        const video = document.createElement('video');
        const videoRef = { current: video };
        render(<TestHarness videoRef={videoRef} />);
        const slider = screen.getByTestId('slider');

        fireEvent.wheel(slider, { deltaY: 100 });

        expect(video.volume).toBeCloseTo(0.45);
        expect(slider).toHaveAttribute('data-volume', '0.45');
    });
});
