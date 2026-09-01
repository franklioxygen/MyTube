import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    PlaybackSnapshot,
    PlaybackStatus,
} from '../playbackEngine';

const harness = vi.hoisted(() => ({
    engines: [] as FakeEngine[],
    pendingSeeks: [] as Array<{ target: number; resolve: () => void }>,
}));

interface FakeEngine {
    options: {
        onChange: (snapshot: PlaybackSnapshot) => void;
        onSeeked?: (currentTime: number) => void;
        onEnded?: () => void;
    };
    seek: ReturnType<typeof vi.fn>;
}

vi.mock('../playbackEngine', () => ({
    CompatibilityPlaybackEngine: class {
        options: FakeEngine['options'];
        load = vi.fn(async () => undefined);
        play = vi.fn(async () => undefined);
        toggle = vi.fn(async () => undefined);
        seekBy = vi.fn(async () => undefined);
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

const renderPlayer = async () => {
    render(<CompatibilityPlayer src="clip.webm" />);
    const engine = harness.engines[0];
    await act(async () => {
        engine.options.onChange(snapshotOf());
    });
    return engine;
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
    });

    it('follows the drag without seeking until the thumb is released', async () => {
        const engine = await renderPlayer();

        drag(60);

        expect(engine.seek).not.toHaveBeenCalled();
        expect(screen.getByText('1:00')).toBeInTheDocument();

        release();

        expect(engine.seek).toHaveBeenCalledWith(60);
    });

    it('keeps showing the dragged position while the seek is still running', async () => {
        const engine = await renderPlayer();

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
        const engine = await renderPlayer();

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

    it('locks the bar for a source that cannot be repositioned', async () => {
        render(<CompatibilityPlayer src="clip.webm" />);
        await act(async () => {
            harness.engines[0].options.onChange(snapshotOf({ canSeek: false }));
        });

        expect(screen.getByTestId('seek-slider')).toBeDisabled();
    });
});
