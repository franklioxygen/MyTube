import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import RssTokenCard from '../RssFeedSettings/RssTokenCard';

const mockShowSnackbar = vi.fn();

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string, replacements?: Record<string, string | number>) => {
            const labels: Record<string, string> = {
                rssAccessCount: 'Created {date} - {count} access(es)',
                rssAuthorsSummary: 'authors: {authors}',
                rssChannelsSummary: '{count} channel(s)',
                rssTagsSummary: 'tags: {tags}',
                rssRecentDaysSummary: 'last {days} days',
                rssFiltersSummary: 'Filters: {filters} - Max {maxItems} items',
                rssFilterAllVideos: 'All videos',
                rssActive: 'Active',
                rssDisabled: 'Disabled',
                rssCopyLink: 'Copy link',
                rssEditAction: 'Edit',
                rssResetLink: 'Reset link',
                rssDisableLink: 'Disable',
                rssEnableLink: 'Enable',
                rssDeleteLink: 'Delete RSS link',
                rssDeleteLinkConfirm: 'Delete forever',
                rssResetLinkConfirm: 'Old link stops working',
                rssLinkCopied: 'Link copied',
                rssNoLabel: '(no label)',
            };
            const template = labels[key] ?? key;
            if (!replacements) return template;
            return Object.entries(replacements).reduce(
                (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
                template
            );
        },
    }),
}));

vi.mock('../../../contexts/SnackbarContext', () => ({
    useSnackbar: () => ({
        showSnackbar: mockShowSnackbar,
    }),
}));

vi.mock('../../ConfirmationModal', () => ({
    default: ({ isOpen, title, onConfirm }: any) =>
        isOpen ? (
            <div role="dialog" aria-label={title}>
                <button onClick={onConfirm}>confirm {title}</button>
            </div>
        ) : null,
}));

vi.mock('../RssFeedSettings/RssTokenDialog', () => ({
    default: () => null,
}));

const token = {
    id: 'token-id',
    label: 'All videos',
    role: 'visitor' as const,
    filters: { maxItems: 50 },
    isActive: true,
    accessCount: 2,
    lastAccessedAt: null,
    createdAt: Date.UTC(2026, 3, 20),
    feedUrl: 'https://mytube.example/feed/token-id',
};

describe('RssTokenCard', () => {
    beforeEach(() => {
        mockShowSnackbar.mockReset();
    });

    it('copies the feed URL to the clipboard and shows feedback', async () => {
        const user = userEvent.setup();
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });

        render(
            <RssTokenCard
                token={token}
                onUpdate={vi.fn()}
                onDelete={vi.fn()}
                onReset={vi.fn()}
            />
        );

        await user.click(screen.getByRole('button', { name: /copy link/i }));

        expect(writeText).toHaveBeenCalledWith(token.feedUrl);
        expect(mockShowSnackbar).toHaveBeenCalledWith('Link copied', 'success');
    });

    it('toggles active state and confirms destructive actions', async () => {
        const user = userEvent.setup();
        const onUpdate = vi.fn();
        const onReset = vi.fn();
        const onDelete = vi.fn();

        render(
            <RssTokenCard
                token={token}
                onUpdate={onUpdate}
                onDelete={onDelete}
                onReset={onReset}
            />
        );

        await user.click(screen.getByRole('button', { name: /disable/i }));
        expect(onUpdate).toHaveBeenCalledWith(token.id, { isActive: false });

        await user.click(screen.getByRole('button', { name: /reset link/i }));
        await user.click(screen.getByRole('button', { name: /confirm reset link/i }));
        expect(onReset).toHaveBeenCalledWith(token.id);

        await user.click(screen.getByRole('button', { name: /delete rss link/i }));
        await user.click(screen.getByRole('button', { name: /confirm delete rss link/i }));
        await waitFor(() => expect(onDelete).toHaveBeenCalledWith(token.id));
    });
});
