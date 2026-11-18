import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VideoTags from '../VideoTags';

vi.mock('../../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

// Source tag suggestions (issue #546): shown faded after the user's tags,
// promoted with a click, dismissed with the chip's delete icon.
describe('VideoTags source tag suggestions', () => {
    const autoChips = () => screen.queryAllByTestId('auto-tag-chip');

    it('shows suggestions separately from the user tags in the picker', () => {
        render(
            <VideoTags
                videoId="v1"
                tags={['music']}
                autoTags={['live', 'Music']}
                availableTags={['music']}
                onTagsUpdate={vi.fn()}
                onAutoTagsUpdate={vi.fn()}
            />
        );
        // "Music" duplicates a user tag, so only "live" is suggested.
        expect(autoChips()).toHaveLength(1);
        expect(within(autoChips()[0]).getByText('live')).toBeInTheDocument();
        // The picker's selected chips hold only the user's tag.
        const combobox = screen.getByRole('combobox');
        expect(combobox.closest('.MuiAutocomplete-root')).not.toHaveTextContent('live');
    });

    it('promotes a suggestion into tags using the catalog spelling', () => {
        const onAutoTagsUpdate = vi.fn().mockResolvedValue(undefined);
        render(
            <VideoTags
                videoId="v1"
                tags={['music']}
                autoTags={['live', 'lofi']}
                availableTags={['music', 'Live']}
                onTagsUpdate={vi.fn()}
                onAutoTagsUpdate={onAutoTagsUpdate}
            />
        );
        fireEvent.click(within(autoChips()[0]).getByText('live'));
        expect(onAutoTagsUpdate).toHaveBeenCalledWith({
            tags: ['music', 'Live'],
            autoTags: ['lofi'],
        });
    });

    it('dismisses a suggestion without touching tags', () => {
        const onAutoTagsUpdate = vi.fn().mockResolvedValue(undefined);
        render(
            <VideoTags
                videoId="v1"
                tags={[]}
                autoTags={['live', 'lofi']}
                availableTags={[]}
                onTagsUpdate={vi.fn()}
                onAutoTagsUpdate={onAutoTagsUpdate}
            />
        );
        fireEvent.click(within(autoChips()[1]).getByTestId('CancelIcon'));
        expect(onAutoTagsUpdate).toHaveBeenCalledWith({ autoTags: ['live'] });
    });

    it('shows suggestions read-only when editing is not allowed', () => {
        render(<VideoTags videoId="v1" tags={[]} autoTags={['live']} availableTags={[]} />);
        expect(autoChips()).toHaveLength(1);
        expect(within(autoChips()[0]).queryByTestId('CancelIcon')).not.toBeInTheDocument();
    });

    it('renders nothing read-only when there are no tags or suggestions', () => {
        const { container } = render(<VideoTags videoId="v1" tags={[]} autoTags={[]} availableTags={[]} />);
        expect(container).toBeEmptyDOMElement();
    });
});
