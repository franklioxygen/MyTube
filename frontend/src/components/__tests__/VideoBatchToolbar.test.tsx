import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBulkVideoActions } from '../../hooks/useBulkVideoActions';
import { useVideoSelection } from '../../hooks/useVideoSelection';
import { en } from '../../utils/locales/en';
import { createCollectionId } from '../../utils/bulkVideoOrganization';
import VideoBatchToolbar from '../VideoBatchToolbar';
import { ensureCsrfToken } from '../../utils/apiClient';

const mocks = vi.hoisted(() => ({ post: vi.fn(), snackbar: vi.fn() }));
vi.mock('../../utils/apiClient', () => ({ api: { post: mocks.post }, ensureCsrfToken: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ userRole: 'admin', loginRequired: true, checkingAuth: false }) }));
vi.mock('../../contexts/SnackbarContext', () => ({ useSnackbar: () => ({ showSnackbar: mocks.snackbar }) }));
vi.mock('../../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key: keyof typeof en, args: Record<string, string | number> = {}) =>
    Object.entries(args).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key] || key) }) }));
vi.mock('../../contexts/CollectionContext', () => ({ useCollection: () => ({ collections: [{ id: 'c1', name: 'Study', videos: [] }] }) }));

const videos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const saved = { data: { success: true, data: { requestedCount: 2, changedVideoIds: ['a', 'b'], unchangedVideoIds: [], catalogChanged: true } } };
const observers: Array<() => void> = [];
function observe<T>(client: QueryClient, queryKey: readonly unknown[], initialData: T, fetch: () => Promise<T>) {
    const read = vi.fn(fetch);
    const observer = new QueryObserver(client, { queryKey, initialData, queryFn: read, staleTime: Infinity, retry: false });
    observers.push(observer.subscribe(() => {}));
    return read;
}
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
    await user.click(screen.getByRole('checkbox', { name: en.bulkSelectPageDescription }));
    await user.click(screen.getByRole('button', { name: en.addTags }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('combobox'), 'New tag');
    return dialog;
}

beforeEach(() => { vi.clearAllMocks(); mocks.post.mockResolvedValue(saved); });
afterEach(() => { observers.splice(0).forEach((stop) => stop()); });

describe('bulk organization interaction', () => {
    it('keeps the All label while explaining and selecting only the current page', async () => {
        const { user } = setup();
        expect(screen.getByText(en.bulkSelectPage)).toBeVisible();
        expect(screen.getByTitle(en.bulkSelectPageDescription)).toBeInTheDocument();
        await user.click(screen.getByRole('checkbox', { name: en.bulkSelectPageDescription }));
        expect(screen.getByText('2 selected')).toBeInTheDocument();
        await user.click(screen.getByRole('checkbox', { name: en.bulkSelectPageDescription }));
        expect(screen.getByText('0 selected')).toBeInTheDocument();
    });
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
        expect(screen.getByText('2 selected')).toBeInTheDocument();
        expect(mocks.snackbar).toHaveBeenCalledOnce();
    });
    it('cancels a new-tag draft without writing settings or video tags', async () => {
        const { user } = setup(); const dialog = await selectTags(user);
        await user.click(within(dialog).getByRole('button', { name: en.cancel }));
        expect(mocks.post).not.toHaveBeenCalled();
        expect(screen.getByText('2 selected')).toBeInTheDocument();
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
    it('refreshes committed tags after a lost response while retaining the draft', async () => {
        const { client, user } = setup();
        let committed = false;
        const before = { id: 'a', title: 'Current', tags: ['old'] };
        const after = { ...before, tags: ['old', 'New tag'] };
        const readVideos = observe(client, ['videos'], [before], async () => committed ? [after] : [before]);
        const readDetail = observe(client, ['video', 'a'], before, async () => committed ? after : before);
        const readSettings = observe(client, ['settings'], { tags: ['old'] }, async () => ({ tags: committed ? after.tags : before.tags }));
        const readSignals = observe(client, ['recommendations', 'signals', 'admin', true], { changed: false }, async () => ({ changed: committed }));
        mocks.post.mockImplementationOnce(async () => { committed = true; throw new Error('response lost'); });
        const dialog = await selectTags(user);
        await user.click(within(dialog).getByRole('button', { name: en.addTags }));
        expect(await within(dialog).findByText(en.bulkRequestUnknown)).toBeInTheDocument();
        expect(within(dialog).getByRole('combobox')).toHaveValue('New tag');
        expect(client.getQueryData(['videos'])).toEqual([after]);
        expect(client.getQueryData(['video', 'a'])).toEqual(after);
        expect(client.getQueryData(['settings'])).toEqual({ tags: after.tags });
        expect(client.getQueryData(['recommendations', 'signals', 'admin', true])).toEqual({ changed: true });
        for (const read of [readVideos, readDetail, readSettings, readSignals]) expect(read).toHaveBeenCalledOnce();
        expect(mocks.post).toHaveBeenCalledOnce();
        expect(mocks.snackbar).not.toHaveBeenCalled();
    });
    it('refreshes existing collection and favorite caches after an unconfirmed write', async () => {
        const { client, user } = setup();
        let committed = false;
        const current = { id: 'c1', name: 'Study', videos: [] as string[] };
        const latest = { ...current, videos: ['a', 'b'] };
        const readCollections = observe(client, ['collections', 'admin'], [current], async () => committed ? [latest] : [current]);
        const readFavorites = observe(client, ['favorite-collections', 'admin'], [current], async () => committed ? [latest] : [current]);
        mocks.post.mockImplementationOnce(async () => { committed = true; throw new Error('connection reset'); });
        await user.click(screen.getByRole('checkbox', { name: en.bulkSelectPageDescription }));
        await user.click(screen.getByRole('button', { name: en.bulkAddToCollection }));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('combobox'));
        await user.click(await screen.findByRole('option', { name: 'Study' }));
        await user.click(within(dialog).getByRole('button', { name: en.bulkAddToCollection }));
        expect(await within(dialog).findByText(en.bulkRequestUnknown)).toBeInTheDocument();
        expect(within(dialog).getByRole('combobox')).toHaveValue('Study');
        expect(client.getQueryData(['collections', 'admin'])).toEqual([latest]);
        expect(client.getQueryData(['favorite-collections', 'admin'])).toEqual([latest]);
        expect(readCollections).toHaveBeenCalledOnce();
        expect(readFavorites).toHaveBeenCalledOnce();
        expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/collections/batch-add', { videoIds: ['a', 'b'], collectionId: 'c1' });
    });
    it('preserves the draft and original unknown-write error when cache refetch also fails', async () => {
        const { client, user } = setup();
        const original = [{ id: 'a', tags: ['old'] }];
        const readVideos = observe(client, ['videos'], original, async () => { throw new Error('refetch offline'); });
        mocks.post.mockRejectedValueOnce(new Error('write response lost'));
        const dialog = await selectTags(user);
        await user.click(within(dialog).getByRole('button', { name: en.addTags }));
        expect(await within(dialog).findByText(en.bulkRequestUnknown)).toBeInTheDocument();
        expect(within(dialog).getByRole('combobox')).toHaveValue('New tag');
        expect(within(dialog).getByRole('button', { name: en.addTags })).toBeEnabled();
        expect(client.getQueryData(['videos'])).toEqual(original);
        expect(client.getQueryState(['videos'])?.error?.message).toBe('refetch offline');
        expect(readVideos).toHaveBeenCalledOnce();
        expect(mocks.post).toHaveBeenCalledOnce();
        expect(mocks.snackbar).not.toHaveBeenCalled();
    });
    it('keeps confirmed validation failures distinct from unknown writes', async () => {
        const { client, user } = setup();
        const original = [{ id: 'a', tags: ['old'] }];
        const readVideos = observe(client, ['videos'], original, async () => original);
        mocks.post.mockRejectedValueOnce({ response: { status: 400, data: { error: 'Invalid tags' } } });
        const dialog = await selectTags(user);
        await user.click(within(dialog).getByRole('button', { name: en.addTags }));
        expect(await within(dialog).findByText('Invalid tags')).toBeInTheDocument();
        expect(within(dialog).getByRole('combobox')).toHaveValue('New tag');
        expect(readVideos).not.toHaveBeenCalled();
        expect(mocks.post).toHaveBeenCalledOnce();
    });
    it('refreshes a newly created collection after an uncertain response and reuses its UUID on retry', async () => {
        const { client, user } = setup();
        const created: Array<{ id: string; name: string; videos: string[] }> = [];
        const readCollections = observe(client, ['collections', 'admin'], [] as typeof created, async () => created);
        const readFavorites = observe(client, ['favorite-collections', 'admin'], [] as typeof created, async () => created);
        mocks.post.mockImplementationOnce(async (_url, body) => {
            created.push({ ...body.newCollection, videos: body.videoIds });
            throw new Error('timeout');
        });
        await user.click(screen.getByRole('checkbox', { name: en.bulkSelectPageDescription }));
        await user.click(screen.getByRole('button', { name: en.bulkAddToCollection }));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('radio', { name: en.bulkNewCollection }));
        await user.type(within(dialog).getByRole('textbox', { name: en.bulkNewCollection }), 'New collection');
        await user.click(within(dialog).getByRole('button', { name: en.bulkAddToCollection }));
        expect(await within(dialog).findByText(en.bulkRequestUnknown)).toBeInTheDocument();
        const first = mocks.post.mock.calls[0][1];
        expect(within(dialog).getByRole('textbox', { name: en.bulkNewCollection })).toHaveValue('New collection');
        expect(client.getQueryData(['collections', 'admin'])).toEqual(created);
        expect(client.getQueryData(['favorite-collections', 'admin'])).toEqual(created);
        expect(readCollections).toHaveBeenCalledOnce();
        expect(readFavorites).toHaveBeenCalledOnce();
        expect(mocks.post).toHaveBeenCalledOnce();
        await user.click(within(dialog).getByRole('button', { name: en.bulkAddToCollection }));
        await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
        expect(mocks.post.mock.calls[1][1]).toEqual(first);
        expect(first.newCollection.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(first.videoIds).toEqual(['a', 'b']);
    });
    it('treats cache refresh failure as saved and does not retry the write', async () => {
        const { client, user } = setup();
        const original = [{ id: 'a', tags: ['old'] }];
        const readVideos = observe(client, ['videos'], original, async () => { throw new Error('offline'); });
        const dialog = await selectTags(user);
        await user.click(within(dialog).getByRole('button', { name: en.addTags }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(mocks.post).toHaveBeenCalledOnce();
        expect(readVideos).toHaveBeenCalledOnce();
        expect(client.getQueryData(['videos'])).toEqual(original);
        expect(client.getQueryState(['videos'])?.error?.message).toBe('offline');
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
        await user.click(screen.getByRole('checkbox', { name: en.bulkSelectPageDescription }));
        await act(async () => finish(saved));
        expect(screen.getByText('2 selected')).toBeInTheDocument();
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

it('reports a CSRF preflight failure as not sent without refreshing write caches', async () => {
    vi.mocked(ensureCsrfToken).mockRejectedValueOnce(new Error('preflight offline'));
    const { client, user } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const dialog = await selectTags(user);
    await user.click(within(dialog).getByRole('button', { name: en.addTags }));
    expect(await within(dialog).findByText(en.bulkRequestNotSent)).toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
});
it('reports the damaged count without raw IDs and can exclude them from a retry', async () => {
    const { user } = setup();
    mocks.post.mockRejectedValueOnce({ response: { status: 409, data: {
        error: 'Stored tags are invalid', details: { invalidVideoIds: ['a'] },
    } } });
    const dialog = await selectTags(user);
    await user.click(within(dialog).getByRole('button', { name: en.addTags }));
    expect(await within(dialog).findByText(en.bulkInvalidVideos.replace('{count}', '1'))).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox')).toHaveValue('New tag');
    await user.click(within(dialog).getByRole('button', { name: en.bulkRemoveInvalid }));
    expect(within(dialog).getByText(en.bulkTagsTitle.replace('{count}', '1'))).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: en.addTags }));
    await waitFor(() => expect(mocks.post).toHaveBeenLastCalledWith('/videos/batch/tags', {
        videoIds: ['b'], tags: ['New tag'],
    }));
});
it('hides the entry button when the current results are empty', () => {
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><EmptyHarness /></QueryClientProvider>);
    expect(screen.queryByRole('button', { name: en.bulkSelectVideos })).not.toBeInTheDocument();
});
function EmptyHarness() {
    const selection = useVideoSelection({ scopeKey: 'empty', videos: [] });
    return <VideoBatchToolbar selection={selection} pageIds={[]} orderedIds={[]} />;
}

it('preselects the existing collection after a name conflict and requires an explicit retry', async () => {
    const { user } = setup();
    mocks.post.mockRejectedValueOnce({ response: { status: 409, data: {
        error: 'Name already exists', details: { existingCollectionId: 'c1' },
    } } });
    await user.click(screen.getByRole('checkbox', { name: en.bulkSelectPageDescription }));
    await user.click(screen.getByRole('button', { name: en.bulkAddToCollection }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: en.bulkNewCollection }));
    await user.type(within(dialog).getByRole('textbox', { name: en.bulkNewCollection }), 'study');
    await user.click(within(dialog).getByRole('button', { name: en.bulkAddToCollection }));
    expect(await within(dialog).findByText(en.bulkCollectionConflict)).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: en.bulkExistingCollection })).toBeChecked();
    expect(within(dialog).getByRole('combobox')).toHaveValue('Study');
    expect(mocks.post).toHaveBeenCalledOnce();
    await user.click(within(dialog).getByRole('button', { name: en.bulkAddToCollection }));
    await waitFor(() => expect(mocks.post).toHaveBeenLastCalledWith('/collections/batch-add', {
        videoIds: ['a', 'b'], collectionId: 'c1',
    }));
});

it('disables saving after all damaged videos are excluded without sending an empty write', async () => {
    const { user } = setup();
    mocks.post.mockRejectedValueOnce({ response: { status: 409, data: {
        error: 'Invalid tags', details: { invalidVideoIds: ['a', 'b'] },
    } } });
    const dialog = await selectTags(user);
    await user.click(within(dialog).getByRole('button', { name: en.addTags }));
    await user.click(await within(dialog).findByRole('button', { name: en.bulkRemoveInvalid }));
    expect(within(dialog).getByRole('button', { name: en.addTags })).toBeDisabled();
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(within(dialog).getByRole('button', { name: en.cancel })).toBeEnabled();
});

it('blocks a second write synchronously before pending reaches the next render', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useBulkVideoActions(), { wrapper });
    const captured = result.current;
    await act(async () => {
        const operation = { kind: 'tags' as const, videoIds: ['a'], tags: ['New tag'] };
        const first = captured.run(operation);
        expect(captured.isPending).toBe(false);
        await expect(captured.run(operation)).rejects.toThrow('A bulk operation is already in progress');
        await first;
    });
    expect(mocks.post).toHaveBeenCalledOnce();
});
