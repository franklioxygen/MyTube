import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import RssFilterEditor from '../RssFeedSettings/RssFilterEditor';

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string, replacements?: Record<string, string | number>) => {
            if (key === 'rssDays') return `${replacements?.days} days`;
            if (!replacements) return key;
            return Object.entries(replacements).reduce(
                (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
                key
            );
        },
    }),
}));

describe('RssFilterEditor', () => {
    it('disables author input when channel URLs are selected', () => {
        render(
            <RssFilterEditor
                filters={{ channelUrls: ['https://example.com/channel'] }}
                onChange={vi.fn()}
                channelOptions={[{ channelUrl: 'https://example.com/channel', author: 'Author' }]}
                authorOptions={['Author']}
            />
        );

        expect(screen.getByPlaceholderText('rssChannelsSelectedAuthorDisabled')).toBeDisabled();
    });

    it('includes cloud as a source option and emits normalized source updates', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();

        render(<RssFilterEditor filters={{}} onChange={onChange} />);

        await user.click(screen.getByLabelText('cloud'));

        expect(onChange).toHaveBeenCalledWith({ sources: ['cloud'] });
    });

    it('shows unrestricted sources as an explicit state and clears source filters', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();

        const { rerender } = render(
            <RssFilterEditor filters={{ maxItems: 50 }} onChange={onChange} />
        );

        expect(screen.getByLabelText('rssFilterAllSources')).toBeChecked();

        rerender(
            <RssFilterEditor
                filters={{ maxItems: 50, sources: ['youtube'] }}
                onChange={onChange}
            />
        );

        expect(screen.getByLabelText('rssFilterAllSources')).not.toBeChecked();
        expect(screen.getByLabelText('youtube')).toBeChecked();

        await user.click(screen.getByLabelText('rssFilterAllSources'));

        expect(onChange).toHaveBeenCalledWith({ maxItems: 50 });
    });

    it('emits filter updates for channel, author, tag, and day range inputs', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();

        const channelOptions = [
            { channelUrl: 'https://example.com/channels/alpha', author: 'Alpha Channel' },
        ];

        render(
            <RssFilterEditor
                filters={{ authors: ['Legacy Author'], maxItems: 50 }}
                onChange={onChange}
                channelOptions={channelOptions}
                authorOptions={['Author One']}
                tagOptions={['tag-one']}
            />
        );

        await user.click(screen.getByPlaceholderText('rssFilterChannels'));
        await user.click(await screen.findByRole('option', { name: 'Alpha Channel' }));

        expect(onChange).toHaveBeenCalledWith({
            authors: [],
            channelUrls: ['https://example.com/channels/alpha'],
            maxItems: 50,
        });

        await user.click(screen.getByPlaceholderText('rssFilterAuthors'));
        await user.click(await screen.findByRole('option', { name: 'Author One' }));

        expect(onChange).toHaveBeenCalledWith({
            authors: ['Legacy Author', 'Author One'],
            maxItems: 50,
        });

        await user.click(screen.getByPlaceholderText('rssFilterTags'));
        await user.click(await screen.findByRole('option', { name: 'tag-one' }));

        expect(onChange).toHaveBeenCalledWith({
            authors: ['Legacy Author'],
            tags: ['tag-one'],
            maxItems: 50,
        });

        fireEvent.mouseDown(screen.getByText('rssFilterAllVideos'));
        await user.click(await screen.findByRole('option', { name: '30 days' }));

        expect(onChange).toHaveBeenCalledWith({
            authors: ['Legacy Author'],
            dayRange: 30,
            maxItems: 50,
        });
    });

    it('limits the max items slider to 10-200 and emits maxItems updates', async () => {
        const onChange = vi.fn();

        render(<RssFilterEditor filters={{}} onChange={onChange} />);

        const slider = screen.getByRole('slider');
        expect(slider).toHaveAttribute('aria-valuemin', '10');
        expect(slider).toHaveAttribute('aria-valuemax', '200');
        expect(slider).toHaveAttribute('aria-valuenow', '50');

        fireEvent.change(slider, { target: { value: '80' } });

        await waitFor(() => {
            expect(onChange).toHaveBeenCalledWith({ maxItems: 80 });
        });
    });
});
