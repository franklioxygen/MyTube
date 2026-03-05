import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CinemaModeControl from '../CinemaModeControl';

const mockUseMediaQuery = vi.hoisted(() => vi.fn());

vi.mock('@mui/material', async () => {
    const actual = await vi.importActual<typeof import('@mui/material')>('@mui/material');
    return {
        ...actual,
        useMediaQuery: mockUseMediaQuery,
    };
});

vi.mock('../../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => key,
    }),
}));

describe('CinemaModeControl', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseMediaQuery.mockReturnValue(false);
    });

    it('shows enter-cinema icon and stops click propagation', () => {
        const onToggle = vi.fn();
        const parentClick = vi.fn();

        render(
            <div onClick={parentClick}>
                <CinemaModeControl isCinemaMode={false} onToggle={onToggle} />
            </div>
        );

        expect(screen.getByTestId('MovieIcon')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button'));

        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(parentClick).not.toHaveBeenCalled();
    });

    it('shows exit-cinema icon when cinema mode is active', () => {
        mockUseMediaQuery.mockReturnValue(true);

        render(<CinemaModeControl isCinemaMode={true} onToggle={vi.fn()} />);

        expect(screen.getByTestId('MovieFilterIcon')).toBeInTheDocument();
    });
});
