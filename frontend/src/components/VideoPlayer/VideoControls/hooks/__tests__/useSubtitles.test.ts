import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSubtitles } from '../useSubtitles';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTracks = (count: number) => {
    const tracks: { length: number; [k: number]: { mode: string } } = { length: count };
    for (let i = 0; i < count; i++) tracks[i] = { mode: 'hidden' };
    return tracks;
};

const makeVideoRef = (trackCount: number) => ({
    current: { textTracks: makeTracks(trackCount) } as unknown as HTMLVideoElement
});

const subtitles2 = [
    { language: 'en', filename: 'en.vtt', path: '/subs/en.vtt' },
    { language: 'fr', filename: 'fr.vtt', path: '/subs/fr.vtt' }
];

const subtitles3 = [
    ...subtitles2,
    { language: 'es', filename: 'es.vtt', path: '/subs/es.vtt' }
];

// ---------------------------------------------------------------------------

describe('useSubtitles', () => {
    beforeEach(() => vi.clearAllMocks());

    // ── initial state ──────────────────────────────────────────────────────

    describe('initial state', () => {
        it('selects the first subtitle when initialSubtitlesEnabled is true', () => {
            const { result } = renderHook(() =>
                useSubtitles({
                    subtitles: subtitles2,
                    initialSubtitlesEnabled: true,
                    videoRef: makeVideoRef(2),
                    onSubtitlesToggle: vi.fn()
                })
            );
            expect(result.current.subtitlesEnabled).toBe(true);
            expect(result.current.selectedSubtitleIndices).toEqual([0]);
        });

        it('selects nothing when initialSubtitlesEnabled is false', () => {
            const { result } = renderHook(() =>
                useSubtitles({
                    subtitles: subtitles2,
                    initialSubtitlesEnabled: false,
                    videoRef: makeVideoRef(2),
                    onSubtitlesToggle: vi.fn()
                })
            );
            expect(result.current.subtitlesEnabled).toBe(false);
            expect(result.current.selectedSubtitleIndices).toEqual([]);
        });

        it('selects nothing when the subtitles array is empty', () => {
            const { result } = renderHook(() =>
                useSubtitles({
                    subtitles: [],
                    initialSubtitlesEnabled: true,
                    videoRef: makeVideoRef(0),
                    onSubtitlesToggle: vi.fn()
                })
            );
            expect(result.current.subtitlesEnabled).toBe(false);
            expect(result.current.selectedSubtitleIndices).toEqual([]);
        });

        it('menu anchor starts as null', () => {
            const { result } = renderHook(() =>
                useSubtitles({
                    subtitles: subtitles2,
                    initialSubtitlesEnabled: false,
                    videoRef: makeVideoRef(2),
                    onSubtitlesToggle: vi.fn()
                })
            );
            expect(result.current.subtitleMenuAnchor).toBeNull();
        });
    });

    // ── menu ───────────────────────────────────────────────────────────────

    describe('menu open / close', () => {
        const setup = () =>
            renderHook(() =>
                useSubtitles({
                    subtitles: subtitles2,
                    initialSubtitlesEnabled: false,
                    videoRef: makeVideoRef(2),
                    onSubtitlesToggle: vi.fn()
                })
            );

        it('sets subtitleMenuAnchor on handleSubtitleClick', () => {
            const { result } = setup();
            const el = document.createElement('button');
            act(() => {
                result.current.handleSubtitleClick(
                    { currentTarget: el } as unknown as React.MouseEvent<HTMLElement>
                );
            });
            expect(result.current.subtitleMenuAnchor).toBe(el);
        });

        it('clears subtitleMenuAnchor on handleCloseSubtitleMenu', () => {
            const { result } = setup();
            const el = document.createElement('button');
            act(() => {
                result.current.handleSubtitleClick(
                    { currentTarget: el } as unknown as React.MouseEvent<HTMLElement>
                );
            });
            act(() => result.current.handleCloseSubtitleMenu());
            expect(result.current.subtitleMenuAnchor).toBeNull();
        });
    });

    // ── handleSelectSubtitle ───────────────────────────────────────────────

    describe('handleSelectSubtitle', () => {
        const setup = (trackCount = 2, initialEnabled = false) => {
            const videoRef = makeVideoRef(trackCount);
            const onSubtitlesToggle = vi.fn();
            const subs = trackCount === 3 ? subtitles3 : subtitles2;
            const result = renderHook(() =>
                useSubtitles({
                    subtitles: subs,
                    initialSubtitlesEnabled: initialEnabled,
                    videoRef,
                    onSubtitlesToggle
                })
            );
            return { ...result, videoRef, onSubtitlesToggle };
        };

        it('adds a subtitle to the selection', () => {
            const { result } = setup();
            act(() => result.current.handleSelectSubtitle(1));
            expect(result.current.selectedSubtitleIndices).toContain(1);
            expect(result.current.subtitlesEnabled).toBe(true);
        });

        it('removes a subtitle when it is toggled off', () => {
            const { result } = setup(2, true); // starts with [0] selected
            act(() => result.current.handleSelectSubtitle(0));
            expect(result.current.selectedSubtitleIndices).not.toContain(0);
            expect(result.current.subtitlesEnabled).toBe(false);
        });

        it('allows selecting up to 2 subtitles simultaneously', () => {
            const { result } = setup(3);
            act(() => result.current.handleSelectSubtitle(0));
            act(() => result.current.handleSelectSubtitle(2));
            expect(result.current.selectedSubtitleIndices).toEqual([0, 2]);
        });

        it('ignores a third selection when 2 are already active', () => {
            const { result } = setup(3);
            act(() => result.current.handleSelectSubtitle(0));
            act(() => result.current.handleSelectSubtitle(1));
            act(() => result.current.handleSelectSubtitle(2)); // must be ignored
            expect(result.current.selectedSubtitleIndices).toHaveLength(2);
            expect(result.current.selectedSubtitleIndices).not.toContain(2);
        });

        it('clears all selections when index -1 ("Off") is passed', () => {
            const { result } = setup(2, true); // starts with [0]
            act(() => result.current.handleSelectSubtitle(-1));
            expect(result.current.selectedSubtitleIndices).toEqual([]);
            expect(result.current.subtitlesEnabled).toBe(false);
        });

        it('closes the menu when index -1 is passed', () => {
            const { result } = setup();
            const el = document.createElement('button');
            act(() => {
                result.current.handleSubtitleClick(
                    { currentTarget: el } as unknown as React.MouseEvent<HTMLElement>
                );
            });
            act(() => result.current.handleSelectSubtitle(-1));
            expect(result.current.subtitleMenuAnchor).toBeNull();
        });

        it('keeps the menu open after a normal subtitle selection', () => {
            const { result } = setup();
            const el = document.createElement('button');
            act(() => {
                result.current.handleSubtitleClick(
                    { currentTarget: el } as unknown as React.MouseEvent<HTMLElement>
                );
            });
            act(() => result.current.handleSelectSubtitle(0));
            expect(result.current.subtitleMenuAnchor).toBe(el); // still open
        });

        it('calls onSubtitlesToggle(true) when first subtitle is selected', () => {
            const { result, onSubtitlesToggle } = setup();
            act(() => result.current.handleSelectSubtitle(0));
            expect(onSubtitlesToggle).toHaveBeenCalledWith(true);
        });

        it('calls onSubtitlesToggle(false) when the last active subtitle is deselected', () => {
            const { result, onSubtitlesToggle } = setup(2, true); // [0] active
            act(() => result.current.handleSelectSubtitle(0));
            expect(onSubtitlesToggle).toHaveBeenCalledWith(false);
        });

        it('sets the selected track mode to "showing" and others to "hidden"', () => {
            const { result, videoRef } = setup(2);
            act(() => result.current.handleSelectSubtitle(1));
            expect(videoRef.current.textTracks[0].mode).toBe('hidden');
            expect(videoRef.current.textTracks[1].mode).toBe('showing');
        });

        it('sets both selected track modes to "showing" when 2 are active', () => {
            const { result, videoRef } = setup(3);
            act(() => result.current.handleSelectSubtitle(0));
            act(() => result.current.handleSelectSubtitle(2));
            expect(videoRef.current.textTracks[0].mode).toBe('showing');
            expect(videoRef.current.textTracks[1].mode).toBe('hidden');
            expect(videoRef.current.textTracks[2].mode).toBe('showing');
        });

        it('hides the track when a subtitle is deselected', () => {
            const { result, videoRef } = setup(2, true); // [0] active
            act(() => result.current.handleSelectSubtitle(0)); // deselect
            expect(videoRef.current.textTracks[0].mode).toBe('hidden');
        });
    });

    // ── initializeSubtitles ────────────────────────────────────────────────

    describe('initializeSubtitles', () => {
        it('shows the first track and sets selectedSubtitleIndices to [0] when enabled', () => {
            const { result } = renderHook(() =>
                useSubtitles({
                    subtitles: subtitles2,
                    initialSubtitlesEnabled: true,
                    videoRef: makeVideoRef(2),
                    onSubtitlesToggle: vi.fn()
                })
            );
            const tracks = makeTracks(2);
            act(() => {
                result.current.initializeSubtitles(
                    { currentTarget: { textTracks: tracks } } as unknown as React.SyntheticEvent<HTMLVideoElement>
                );
            });
            expect(tracks[0].mode).toBe('showing');
            expect(tracks[1].mode).toBe('hidden');
            expect(result.current.selectedSubtitleIndices).toEqual([0]);
        });

        it('hides all tracks and sets selectedSubtitleIndices to [] when disabled', () => {
            const { result } = renderHook(() =>
                useSubtitles({
                    subtitles: subtitles2,
                    initialSubtitlesEnabled: false,
                    videoRef: makeVideoRef(2),
                    onSubtitlesToggle: vi.fn()
                })
            );
            const tracks = makeTracks(2);
            act(() => {
                result.current.initializeSubtitles(
                    { currentTarget: { textTracks: tracks } } as unknown as React.SyntheticEvent<HTMLVideoElement>
                );
            });
            expect(tracks[0].mode).toBe('hidden');
            expect(tracks[1].mode).toBe('hidden');
            expect(result.current.selectedSubtitleIndices).toEqual([]);
        });
    });
});
