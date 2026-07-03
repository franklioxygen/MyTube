import type { ComponentProps } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VideoElement from '../VideoElement';

vi.mock('../../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

const defaultProps: ComponentProps<typeof VideoElement> = {
    videoRef: { current: null },
    src: '/videos/video.mp4',
    isLoading: false,
    loadError: null,
    subtitles: [],
    onClick: vi.fn(),
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onTimeUpdate: vi.fn(),
    onLoadedMetadata: vi.fn(),
    onError: vi.fn(),
    onLoadStart: vi.fn(),
    onCanPlay: vi.fn(),
    onLoadedData: vi.fn(),
    onSubtitleInit: vi.fn(),
};

describe('VideoElement', () => {
    it('renders legacy unknown subtitle language as the valid undetermined srclang tag', () => {
        const { container } = render(
            <VideoElement
                {...defaultProps}
                subtitles={[
                    {
                        language: 'unknown',
                        filename: 'video.unknown.vtt',
                        path: '/subtitles/video.unknown.vtt',
                    },
                ]}
            />
        );

        const track = container.querySelector('track');
        expect(track).toHaveAttribute('srclang', 'und');
        expect(track).toHaveAttribute('label', 'Unknown');
    });

    it('uses a subtitle filename language when stored metadata is ambiguous', () => {
        const { container } = render(
            <VideoElement
                {...defaultProps}
                subtitles={[
                    {
                        language: 'unknown',
                        filename: 'video.en.vtt',
                        path: '/subtitles/video.en.vtt',
                    },
                ]}
            />
        );

        const track = container.querySelector('track');
        expect(track).toHaveAttribute('srclang', 'en');
        expect(track).toHaveAttribute('label', 'English');
    });
});
