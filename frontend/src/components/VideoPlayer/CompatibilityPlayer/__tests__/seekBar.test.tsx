import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    PlaybackSnapshot,
    PlaybackStatus,
} from '../playbackEngine';

const harness = vi.hoisted(() => ({
    engines: [] as FakeEngine[],
    pendingSeeks: [] as Array<{ target: number; resolve: () => void }>,
    pendingSeekBys: [] as Array<{ delta: number; resolve: () => void }>,
}));

interface FakeEngine {
    options: {
        onChange: (snapshot: PlaybackSnapshot) => void;
        onSeeked?: (currentTime: number) => void;
        onEnded?: () => void;
    };
    seek: ReturnType<typeof vi.fn>;
    seekBy: ReturnType<typeof vi.fn>;
}

vi.mock('../playbackEngine', () => ({
    CompatibilityPlaybackEngine: class {
        options: FakeEngine['options'];
        load = vi.fn(async () => undefined);
        play = vi.fn(async () => undefined);
        toggle = vi.fn(async () => undefined);
        seekBy = vi.fn(
            (delta: number) =>
                new Promise<void>((resolve) => {
                    harness.pendingSeekBys.push({ delta, resolve });
                })
        );
        destroy = vi.fn(async () => undefined);
        // Held open so a test can decide when a seek finishes, the way the real
        // engine keeps one running across several drag updates.
        seek = vi.fn(
            (target: number) =>
                new Promise<void>((resolve) => {
                    harness.pendingSeeks.push({ target, resolve });
                })
        );

        constructor(_canvas: HTMLCanvasElement, options: FakeEngine['options']) {
            this.options = options;
            harness.engines.push(this as unknown as FakeEngine);
        }
    },
}));

vi.mock('../../../../utils/compatibilityMode/support', () => ({
    isCompatibilityModeSupported: () => true,
    getMissingCompatibilityModeApis: () => [],
}));

vi.mock('../../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../../hooks/useCompatibilityStatisticsWatchTracker', () => ({
    useCompatibilityStatisticsWatchTracker: () => ({ onEnded: vi.fn() }),
}));

// The real Slider needs layout to translate a drag into a value, which jsdom
// cannot provide; this stands in for the pointer gestures instead.
vi.mock('@mui/material', async () => {
    const actual = await vi.importActual<typeof import('@mui/material')>('@mui/material');
    return {
        ...actual,
        Slider: ({ value, disabled, onChange, onChangeCommitted, onMouseDown }: any) => (
            <input
                data-testid="seek-slider"
                role="slider"
                disabled={disabled}
                value={value}
                onMouseDown={onMouseDown}
                onChange={(event) =>
                    onChange?.(event, Number((event.target as HTMLInputElement).value))
                }
                onMouseUp={(event) =>
                    onChangeCommitted?.(
                        event,
                        Number((event.currentTarget as HTMLInputElement).value)
                    )
                }
            />
        ),
    };
});

import CompatibilityPlayer from '../index';
import { DEFAULT_PLAYER_SEEK_INTERVALS } from '../../../../utils/playerSeekIntervals';

const SHORT_SECONDS = DEFAULT_PLAYER_SEEK_INTERVALS.shortSeconds;

const snapshotOf = (overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot => ({
    status: 'paused' as PlaybackStatus,
    currentTime: 10,
    duration: 120,
    error: null,
    pipeline: 'test',
    unsupported: false,
    aspectRatio: 16 / 9,
    buffering: false,
    canSeek: true,
    ...overrides,
});

const renderPlayer = async (props: { startTime?: number } = {}) => {
    const view = render(<CompatibilityPlayer src="clip.webm" {...props} />);
    const engine = harness.engines[0];
    await act(async () => {
        engine.options.onChange(snapshotOf());
    });
    return { engine, view };
};

const drag = (toSeconds: number) => {
    fireEvent.change(screen.getByTestId('seek-slider'), {
        target: { value: String(toSeconds) },
    });
};

const release = () => {
    fireEvent.mouseUp(screen.getByTestId('seek-slider'));
};

describe('D Mode progress bar seeking', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        harness.engines.length = 0;
        harness.pendingSeeks.length = 0;
        harness.pendingSeekBys.length = 0;
    });

    it('follows the drag without seeking until the thumb is released', async () => {
        const { engine } = await renderPlayer();

        drag(60);

        expect(engine.seek).not.toHaveBeenCalled();
        expect(screen.getByText('1:00')).toBeInTheDocument();

        release();

        expect(engine.seek).toHaveBeenCalledWith(60);
    });

    it('keeps showing the dragged position while the seek is still running', async () => {
        const { engine } = await renderPlayer();

        drag(60);
        release();

        // The engine is still playing out the old position until the seek lands.
        await act(async () => {
            engine.options.onChange(snapshotOf({ currentTime: 11 }));
        });

        expect(screen.getByText('1:00')).toBeInTheDocument();
        expect(screen.queryByText('0:11')).not.toBeInTheDocument();

        await act(async () => {
            harness.pendingSeeks[0].resolve();
        });
        await act(async () => {
            engine.options.onChange(snapshotOf({ currentTime: 60 }));
        });

        expect(screen.getByText('1:00')).toBeInTheDocument();
    });

    it('performs a release that lands while an earlier seek is still running', async () => {
        const { engine } = await renderPlayer();

        drag(60);
        release();
        expect(engine.seek).toHaveBeenCalledTimes(1);

        // The engine drops seeks issued mid-seek, so this one has to wait
        // rather than be forwarded and lost.
        drag(90);
        release();
        expect(engine.seek).toHaveBeenCalledTimes(1);

        await act(async () => {
            harness.pendingSeeks[0].resolve();
        });

        expect(engine.seek).toHaveBeenCalledTimes(2);
        expect(engine.seek).toHaveBeenLastCalledWith(90);
        expect(screen.getByText('1:30')).toBeInTheDocument();
    });

    it('performs a release made while the saved-position restore is running', async () => {
        render(<CompatibilityPlayer src="clip.webm" startTime={30} />);
        const engine = harness.engines[0];
        await act(async () => {
            engine.options.onChange(snapshotOf());
        });

        // The restore seek holds the engine, which would refuse any other.
        expect(engine.seek).toHaveBeenCalledTimes(1);
        expect(engine.seek).toHaveBeenCalledWith(30);

        drag(60);
        release();
        expect(engine.seek).toHaveBeenCalledTimes(1);

        await act(async () => {
            harness.pendingSeeks[0].resolve();
        });

        expect(engine.seek).toHaveBeenCalledTimes(2);
        expect(engine.seek).toHaveBeenLastCalledWith(60);
        expect(screen.getByText('1:00')).toBeInTheDocument();
    });

    it('performs a release made while a skip-button seek is running', async () => {
        const { engine } = await renderPlayer();

        fireEvent.click(screen.getAllByLabelText('seekForwardBy')[0]);
        expect(harness.pendingSeekBys).toEqual([
            expect.objectContaining({ delta: SHORT_SECONDS }),
        ]);

        drag(60);
        release();
        expect(engine.seek).not.toHaveBeenCalled();

        await act(async () => {
            harness.pendingSeekBys[0].resolve();
        });

        expect(engine.seek).toHaveBeenCalledWith(60);
    });

    it('stacks a skip onto the target a release is already heading for', async () => {
        const { engine } = await renderPlayer();

        drag(60);
        release();
        expect(engine.seek).toHaveBeenCalledWith(60);

        // The engine's clock still reads 0:10, so a skip counted from it would
        // land at 0:20. It has to count from where the release is going.
        fireEvent.click(screen.getAllByLabelText('seekForwardBy')[0]);
        await act(async () => {
            harness.pendingSeeks[0].resolve();
        });

        expect(engine.seekBy).not.toHaveBeenCalled();
        expect(engine.seek).toHaveBeenCalledTimes(2);
        expect(engine.seek).toHaveBeenLastCalledWith(60 + SHORT_SECONDS);
    });

    it('never lands a queued target on the video navigated to next', async () => {
        const { engine, view } = await renderPlayer();

        drag(60);
        release();
        drag(90);
        release();
        expect(engine.seek).toHaveBeenCalledTimes(1);

        view.rerender(<CompatibilityPlayer src="next-clip.webm" />);
        const nextEngine = harness.engines[1];
        expect(nextEngine).not.toBe(engine);

        await act(async () => {
            harness.pendingSeeks[0].resolve();
            nextEngine.options.onChange(snapshotOf({ currentTime: 0 }));
        });

        expect(nextEngine.seek).not.toHaveBeenCalled();
        // The bar opens on the new video, not on the abandoned scrub position.
        expect(screen.getByText('0:00')).toBeInTheDocument();
        expect(screen.queryByText('1:30')).not.toBeInTheDocument();
    });

    it('locks the bar for a source that cannot be repositioned', async () => {
        render(<CompatibilityPlayer src="clip.webm" />);
        await act(async () => {
            harness.engines[0].options.onChange(snapshotOf({ canSeek: false }));
        });

        expect(screen.getByTestId('seek-slider')).toBeDisabled();
    });
});
