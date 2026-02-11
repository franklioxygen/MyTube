import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@mui/material', async () => {
    const actual = await vi.importActual<typeof import('@mui/material')>('@mui/material');
    return {
        ...actual,
        Slider: ({ value, onChange, onChangeCommitted, onMouseDown }: any) => (
            <input
                data-testid="mock-progress-slider"
                role="slider"
                defaultValue={value}
                onChange={(event) => onChange?.(event, Number((event.target as HTMLInputElement).value))}
                onMouseDown={onMouseDown}
                onMouseUp={(event) =>
                    onChangeCommitted?.(event, [Number((event.currentTarget as HTMLInputElement).value)])
                }
            />
        ),
    };
});

import ProgressBar from '../ProgressBar';

describe('ProgressBar onChangeCommitted', () => {
    it('calls onProgressChangeCommitted with normalized slider value', () => {
        const onProgressChange = vi.fn();
        const onProgressChangeCommitted = vi.fn();
        const onProgressMouseDown = vi.fn();

        render(
            <ProgressBar
                currentTime={50}
                duration={100}
                onProgressChange={onProgressChange}
                onProgressChangeCommitted={onProgressChangeCommitted}
                onProgressMouseDown={onProgressMouseDown}
            />
        );

        const slider = screen.getByTestId('mock-progress-slider');
        fireEvent.change(slider, { target: { value: '66' } });
        fireEvent.mouseUp(slider);

        expect(onProgressChange).toHaveBeenCalledWith(66);
        expect(onProgressChangeCommitted).toHaveBeenCalledWith(66);
    });
});
