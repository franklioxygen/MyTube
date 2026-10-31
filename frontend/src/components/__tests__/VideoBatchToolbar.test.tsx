import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVideoSelection } from '../../hooks/useVideoSelection';
import { en } from '../../utils/locales/en';
import { createCollectionId } from '../../utils/bulkVideoOrganization';
import VideoBatchToolbar from '../VideoBatchToolbar';

const mocks = vi.hoisted(() => ({ post: vi.fn(), snackbar: vi.fn() }));
vi.mock('../../utils/apiClient', () => ({ api: { post: mocks.post }, ensureCsrfToken: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ userRole: 'admin', loginRequired: true, checkingAuth: false }) }));
vi.mock('../../contexts/SnackbarContext', () => ({ useSnackbar: () => ({ showSnackbar: mocks.snackbar }) }));
vi.mock('../../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key: keyof typeof en, args: Record<string, string | number> = {}) =>
    Object.entries(args).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key] || key) }) }));
vi.mock('../../contexts/CollectionContext', () => ({ useCollection: () => ({ collections: [{ id: 'c1', name: 'Study', videos: [] }] }) }));

const videos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const saved = { data: { success: true, data: { requestedCount: 2, changedVideoIds: ['a', 'b'], unchangedVideoIds: [], catalogChanged: true } } };
function Harness({ scope = 'all', infiniteScroll = false, rows = videos }: { scope?: string; infiniteScroll?: boolean; rows?: { id: string }[] }) {
    const selection = useVideoSelection({ scopeKey: scope, videos: rows, alwaysOn: true });
    return <VideoBatchToolbar selection={selection} pageIds={rows.slice(0, 2).map((v) => v.id)}
        orderedIds={rows.map((v) => v.id)} availableTags={['Music']} infiniteScroll={infiniteScroll} alwaysOn />;
}
function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const user = userEvent.setup();
    const view = render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
    return { client, user, ...view };
}
async function selectTags(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('checkbox', { name: en.bulkSelectPage }));
    await user.click(screen.getByRole('button', { name: en.addTags }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('combobox'), 'New tag');
    return dialog;
}

beforeEach(() => { vi.clearAllMocks(); mocks.post.mockResolvedValue(saved); });

describe('bulk organization interaction', () => {
    it('appends tags with one request, preserves selection, refreshes caches without overwriting video objects', async () => {
        const { client, user } = setup();
        client.setQueryData(['videos'], [{ id: 'a', title: 'Current', tags: ['old'] }]);
        client.setQueryData(['video', 'a'], { id: 'a', title: 'Current', tags: ['old'] });
        client.setQueryData(['settings'], { tags: [] });
        client.setQueryData(['recommendations', 'signals', 'admin', true], { tags: {} });
        const dialog = await selectTags(user);
        expect(mocks.post).not.toHaveBeenCalled();
        await user.click(within(dialog).getByRole('button', { name: en.addTags }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/videos/batch/tags', { videoIds: ['a', 'b'], tags: ['New tag'] });
        expect(client.getQueryState(['videos'])?.isInvalidated).toBe(true);
        expect(client.getQueryState(['video', 'a'])?.isInvalidated).toBe(true);
        expect(client.getQueryState(['settings'])?.isInvalidated).toBe(true);
        expect(client.getQueryState(['recommendations', 'signals', 'admin', true])?.isInvalidated).toBe(true);
        expect(client.getQueryData(['video', 'a'])).toEqual({ id: 'a', title: 'Current', tags: ['old'] });
        expect(client.getQueryData(['video', 'b'])).toBeUndefined();
        expect(screen.getByText('2 videos selected')).toBeInTheDocument();
        expect(mocks.snackbar).toHaveBeenCalledOnce();
    });
    it('cancels a new-tag draft without writing settings or video tags', async () => {
        const { user } = setup(); const dialog = await selectTags(user);
        await user.click(within(dialog).getByRole('button', { name: en.cancel }));
        expect(mocks.post).not.toHaveBeenCalled();
        expect(screen.getByText('2 videos selected')).toBeInTheDocument();
    });
    it('retains the draft on failure and requires explicit removal of missing IDs before retry', async () => {
        const { user } = setup();
        mocks.post.mockRejectedValueOnce({ response: { status: 404, data: { details: { missingVideoIds: ['b'] } } } });
        const dialog = await selectTags(user);
        await user.click(within(dialog).getByRole('button', { name: en.addTags }));
        expect(await within(dialog).findByText('1 selected videos no longer exist. This request changed no videos.')).toBeInTheDocument();
        expect(mocks.post).toHaveBeenCalledTimes(1);
        await user.click(within(dialog).getByRole('button', { name: en.bulkRemoveMissing }));
        expect(within(dialog).getByText('Add tags to 1 videos')).toBeInTheDocument();
        await user.click(within(dialog).getByRole('button', { name: en.addTags }));
        await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
        expect(mocks.post.mock.calls[1][1]).toEqual({ videoIds: ['a'], tags: ['New tag'] });
    });
    it('creates a collection atomically and reuses its UUID after an uncertain response', async () => {
        const { user } = setup();
        mocks.post.mockRejectedValueOnce(new Error('timeout'));
        await user.click(screen.getByRole('checkbox', { name: en.bulkSelectPage }));
        await user.click(screen.getByRole('button', { name: en.bulkAddToCollection }));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('radio', { name: en.bulkNewCollection }));
        await user.type(within(dialog).getByRole('textbox', { name: en.bulkNewCollection }), 'New collection');
        await user.click(within(dialog).getByRole('button', { name: en.bulkAddToCollection }));
        expect(await within(dialog).findByText(en.bulkRequestUnknown)).toBeInTheDocument();
        const first = mocks.post.mock.calls[0][1];
        await user.click(within(dialog).getByRole('button', { name: en.bulkAddToCollection }));
        await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
        expect(mocks.post.mock.calls[1][1]).toEqual(first);
        expect(first.newCollection.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(first.videoIds).toEqual(['a', 'b']);
    });
    it('treats cache refresh failure as saved and does not retry the write', async () => {
        const { client, user } = setup();
        vi.spyOn(client, 'invalidateQueries').mockRejectedValue(new Error('offline'));
        const dialog = await selectTags(user);
        await user.click(within(dialog).getByRole('button', { name: en.addTags }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(mocks.post).toHaveBeenCalledOnce();
        expect(mocks.snackbar).toHaveBeenCalledExactlyOnceWith(en.bulkSavedRefreshFailed, 'warning');
    });
    it('blocks duplicate saves while a request is pending', async () => {
        let finish!: (value: typeof saved) => void;
        mocks.post.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
        const { user } = setup(); const dialog = await selectTags(user);
        const button = within(dialog).getByRole('button', { name: en.addTags });
        await user.dblClick(button);
        expect(mocks.post).toHaveBeenCalledOnce();
        expect(within(dialog).getByRole('button', { name: en.cancel })).toBeDisabled();
        await act(async () => finish(saved));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });
    it('does not reopen an old draft or clear a new scope when its request completes', async () => {
        let finish!: (value: typeof saved) => void;
        mocks.post.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
        const { client, user, rerender } = setup(); const dialog = await selectTags(user);
        await user.click(within(dialog).getByRole('button', { name: en.addTags }));
        rerender(<QueryClientProvider client={client}><Harness scope="different" /></QueryClientProvider>);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('checkbox', { name: en.bulkSelectPage }));
        await act(async () => finish(saved));
        expect(screen.getByText('2 videos selected')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    it('labels virtual results explicitly and disables result-wide selection over 500', () => {
        const client = new QueryClient();
        const rows = Array.from({ length: 501 }, (_, i) => ({ id: String(i) }));
        render(<QueryClientProvider client={client}><Harness rows={rows} infiniteScroll /></QueryClientProvider>);
        expect(screen.getByRole('checkbox', { name: 'Select current results (501)' })).toBeDisabled();
    });
    it('generates UUID v4 on HTTP browsers without randomUUID', () => {
        const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
        Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
        try { expect(createCollectionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); }
        finally {
            if (descriptor) Object.defineProperty(crypto, 'randomUUID', descriptor);
            else Reflect.deleteProperty(crypto, 'randomUUID');
        }
    });
});
