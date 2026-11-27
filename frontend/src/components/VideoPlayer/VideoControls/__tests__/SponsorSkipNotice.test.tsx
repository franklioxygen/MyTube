import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SkipRange } from '../../../../utils/sponsorBlock';
import SponsorSkipNotice from '../SponsorSkipNotice';

vi.mock('../../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string, replacements?: Record<string, string>) =>
            replacements?.category ? `${key}:${replacements.category}` : key,
    }),
}));

const range = (key: string, categories: SkipRange['categories']): SkipRange => ({
    key, uuids: [key], categories, start: 0, end: 10, mode: 'auto', toEnd: false,
});

describe('SponsorSkipNotice', () => {
    it('renders nothing without a notice', () => {
        const { container } = render(<SponsorSkipNotice notice={null} onUndo={vi.fn()} onSkip={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('offers Undo for a skip and a button for the range it landed in, together', () => {
        const onUndo = vi.fn();
        const onSkip = vi.fn();
        render(
            <SponsorSkipNotice
                notice={{ skipped: range('a', ['sponsor', 'selfpromo']), prompt: range('b', ['outro']) }}
                onUndo={onUndo}
                onSkip={onSkip}
            />
        );
        expect(screen.getByRole('status')).toHaveTextContent(
            'sponsorBlockSkipped:sponsorBlockCategorySponsor / sponsorBlockCategorySelfpromo'
        );
        fireEvent.click(screen.getByRole('button', { name: /sponsorBlockUndo/ }));
        fireEvent.click(screen.getByRole('button', { name: /sponsorBlockSkip:sponsorBlockCategoryOutro/ }));
        expect(onUndo).toHaveBeenCalledTimes(1);
        expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it('keeps its clicks away from the play/pause surface behind it', () => {
        const togglePlayback = vi.fn();
        render(
            <div onClick={togglePlayback}>
                <SponsorSkipNotice notice={{ prompt: range('b', ['intro']) }} onUndo={vi.fn()} onSkip={vi.fn()} />
            </div>
        );
        fireEvent.click(screen.getByRole('button', { name: /sponsorBlockSkip/ }));
        expect(togglePlayback).not.toHaveBeenCalled();
    });
});
