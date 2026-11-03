import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuthorSearchSection from '../AuthorSearchSection';
import SearchPage from '../../pages/SearchPage';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), snackbar: vi.fn(), download: vi.fn(), retryVideo: vi.fn() }));
let role = 'admin';
let showBilibili = true;
let videoSearchError: 'risk_control' | 'unavailable' | null = null;
vi.mock('../../utils/apiClient', () => ({ api: { get: mocks.get, post: mocks.post } }));
vi.mock('../../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ userRole: role, loginRequired: true }) }));
vi.mock('../../contexts/SnackbarContext', () => ({ useSnackbar: () => ({ showSnackbar: mocks.snackbar }) }));
vi.mock('../../contexts/CollectionContext', () => ({ useCollection: () => ({ collections: [] }) }));
vi.mock('../../contexts/DownloadContext', () => ({ useDownload: () => ({ handleVideoSubmit: mocks.download }) }));
vi.mock('../VideoCard', () => ({ default: () => null }));
vi.mock('../SortControl', () => ({ default: () => null }));
vi.mock('../../contexts/VideoContext', () => ({ useVideo: () => ({
  localSearchResults: [], searchResults: [], youtubeLoading: false,
  handleSearch: vi.fn(), searchTerm: 'query', showYoutubeSearch: false,
  bilibiliSearchResults: [{ id: 'BV123', title: 'Usable video', source: 'bilibili', sourceUrl: 'https://www.bilibili.com/video/BV123' }],
  bilibiliLoading: false, showBilibiliSearch: showBilibili, downloadingIds: new Set(),
  bilibiliSearchError: videoSearchError, loadingMoreBilibili: false, loadMoreBilibiliSearchResults: mocks.retryVideo,
}) }));
const author = (id = '123', name = 'Same name') => ({ platform: 'bilibili', authorId: id, displayName: name, channelUrl: `https://space.bilibili.com/${id}`, avatarUrl: '' });
const page = (results = [author()], hasMore = false) => ({ data: { results, hasMore, page: 1, mode: 'keyword' } });
let subscriptions: unknown[] = [];
let clients: QueryClient[] = [];
const makeClient = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return client;
};
const renderSection = (query = 'query') => {
  const client = makeClient();
  return { client, ...render(<QueryClientProvider client={client}><AuthorSearchSection key={query} query={query} /></QueryClientProvider>) };
};
beforeEach(() => {
  vi.clearAllMocks(); role = 'admin'; showBilibili = true; videoSearchError = null; subscriptions = [];
  mocks.get.mockImplementation(async (path: string) => path === '/subscriptions' ? { data: subscriptions } : page());
  mocks.post.mockResolvedValue({ data: { subscription: { id: 'new' } } });
});
afterEach(() => { clients.forEach((client) => client.clear()); clients = []; });

describe('AuthorSearchSection', () => {
  it('matches existing subscriptions by UID rather than same display name or playlist type', async () => {
    subscriptions = [{ author: 'Renamed', authorUrl: 'http://space.bilibili.com/00123/video?from=old' }, { authorUrl: 'https://space.bilibili.com/456', subscriptionType: 'playlist' }];
    mocks.get.mockImplementation(async (path: string) => path === '/subscriptions' ? { data: subscriptions } : page([author(), author('456')]));
    renderSection();
    expect(await screen.findByRole('button', { name: 'authorAlreadySubscribed' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'subscribe' })).toBeEnabled();
    expect(screen.getAllByRole('link', { name: 'Same name' }).map((link) => link.getAttribute('href'))).toEqual(['https://space.bilibili.com/123', 'https://space.bilibili.com/456']);
  });
  it('reuses the confirmation form, sends its options and immediately marks the exact author subscribed', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'subscribe' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('checkIntervalMinutes'), { target: { value: '30' } });
    fireEvent.click(within(dialog).getByLabelText('downloadAllPreviousVideos'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'subscribe' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/subscriptions', { url: 'https://space.bilibili.com/123', authorName: 'Same name', interval: 30, downloadAllPrevious: true, downloadShorts: false, downloadOrder: 'dateDesc' }));
    expect(await screen.findByRole('button', { name: 'authorAlreadySubscribed' })).toBeDisabled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
  it('treats a create conflict as already subscribed and refreshes shared state', async () => {
    mocks.post.mockRejectedValue({ isAxiosError: true, response: { status: 409 } });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'subscribe' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'subscribe' }));
    expect(await screen.findByRole('button', { name: 'authorAlreadySubscribed' })).toBeDisabled();
    expect(mocks.snackbar).toHaveBeenCalledWith('subscriptionAlreadyExists', 'info');
  });
  it('keeps the confirmation form open after a failed create so it can be retried', async () => {
    mocks.post.mockRejectedValue({ isAxiosError: true, response: { status: 503, data: { error: 'Subscription unavailable' } } });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'subscribe' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'subscribe' }));
    await waitFor(() => expect(mocks.snackbar).toHaveBeenCalledWith('Subscription unavailable', 'error'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'authorAlreadySubscribed' })).not.toBeInTheDocument();
  });
  it('lets visitors inspect profiles without fetching subscriptions or offering writes', async () => {
    role = 'visitor'; renderSection();
    expect(await screen.findByRole('link', { name: 'Same name' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'subscribe' })).not.toBeInTheDocument();
    expect(mocks.get.mock.calls.some(([path]) => path === '/subscriptions')).toBe(false);
  });
  it('distinguishes loading, empty and failed searches with retry', async () => {
    mocks.get.mockImplementation(async (path: string) => path === '/subscriptions' ? { data: [] } : Promise.reject(new Error('risk control')));
    renderSection();
    expect(screen.getByRole('status')).toHaveTextContent('loadingAuthors');
    expect(await screen.findByText('authorSearchFailed')).toBeInTheDocument();
    expect(screen.queryByText('noAuthorsFound')).not.toBeInTheDocument();
    mocks.get.mockImplementation(async (path: string) => path === '/subscriptions' ? { data: [] } : page([]));
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(await screen.findByText('noAuthorsFound')).toBeInTheDocument();
  });
  it('explains persistent Bilibili risk control and clears the warning after a successful retry', async () => {
    mocks.get.mockImplementation(async (path: string) => path === '/subscriptions' ? { data: [] } : Promise.reject({
      isAxiosError: true, response: { status: 502, data: { code: 'AUTHOR_SEARCH_RISK_CONTROLLED' } },
    }));
    renderSection();
    expect(await screen.findByRole('alert')).toHaveTextContent('authorSearchRiskControlled');
    expect(screen.queryByText('authorSearchFailed')).not.toBeInTheDocument();
    expect(screen.queryByText('noAuthorsFound')).not.toBeInTheDocument();
    mocks.get.mockImplementation(async (path: string) => path === '/subscriptions' ? { data: [] } : page());
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(await screen.findByRole('link', { name: 'Same name' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it.each(['AUTHOR_SEARCH_UNAVAILABLE', 'UNKNOWN_ERROR'])('keeps %s separate from risk control', async (code) => {
    mocks.get.mockImplementation(async (path: string) => path === '/subscriptions' ? { data: [] } : Promise.reject({
      isAxiosError: true, response: { status: 502, data: { code } },
    }));
    renderSection();
    expect(await screen.findByRole('alert')).toHaveTextContent('authorSearchFailed');
    expect(screen.queryByText('authorSearchRiskControlled')).not.toBeInTheDocument();
  });
  it('blocks creates when subscription state cannot be loaded', async () => {
    mocks.get.mockImplementation(async (path: string) => path === '/subscriptions' ? Promise.reject(new Error('failed')) : page());
    renderSection();
    expect(await screen.findByText('authorSubscriptionStatusFailed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'subscribe' })).toBeDisabled();
  });
  it('paginates authors separately and resets the page for a UID/profile lookup', async () => {
    mocks.get.mockImplementation(async (path: string, options: any) => {
      if (path === '/subscriptions') return { data: [] };
      return page([author(options.params.page === 2 ? '456' : '123')], options.params.page === 1);
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'next' }));
    expect(await screen.findByText('UID 456')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('authorLookupLabel'), { target: { value: 'https://space.bilibili.com/789' } });
    fireEvent.click(screen.getByRole('button', { name: 'search' }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/search/authors', expect.objectContaining({ params: { source: 'bilibili', query: 'https://space.bilibili.com/789', page: 1 } })));
  });
  it('keeps the current page visible and blocks further paging while the next page loads', async () => {
    let resolveNext!: (value: ReturnType<typeof page>) => void;
    mocks.get.mockImplementation(async (path: string, options: any) => {
      if (path === '/subscriptions') return { data: [] };
      if (options.params.page === 2) return new Promise((resolve) => { resolveNext = resolve; });
      return page([author('123', 'First page')], true);
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'next' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'next' })).toBeDisabled());
    expect(screen.getByRole('link', { name: 'First page' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await waitFor(() => expect(resolveNext).toBeDefined());
    await act(async () => { resolveNext(page([author('456', 'Second page')])); });
    expect(await screen.findByRole('link', { name: 'Second page' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'First page' })).not.toBeInTheDocument();
  });
  it('shows the loading state rather than old results while a new lookup loads', async () => {
    mocks.get.mockImplementation(async (path: string, options: any) => {
      if (path === '/subscriptions') return { data: [] };
      if (options.params.query === 'other') return new Promise(() => {});
      return page([author('123', 'Old lookup')]);
    });
    renderSection();
    expect(await screen.findByRole('link', { name: 'Old lookup' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('authorLookupLabel'), { target: { value: 'other' } });
    fireEvent.click(screen.getByRole('button', { name: 'search' }));
    expect(await screen.findByRole('status')).toHaveTextContent('loadingAuthors');
    expect(screen.queryByRole('link', { name: 'Old lookup' })).not.toBeInTheDocument();
  });
  it('never replaces a new query with a late response from an old query', async () => {
    let resolveOld!: (value: ReturnType<typeof page>) => void;
    mocks.get.mockImplementation(async (path: string, options: any) => {
      if (path === '/subscriptions') return { data: [] };
      if (options.params.query === 'old') return new Promise((resolve) => { resolveOld = resolve; });
      return page([author('456', 'New author')]);
    });
    const { client, rerender } = renderSection('old');
    rerender(<QueryClientProvider client={client}><AuthorSearchSection key="new" query="new" /></QueryClientProvider>);
    expect(await screen.findByRole('link', { name: 'New author' })).toBeInTheDocument();
    await act(async () => { resolveOld(page([author('123', 'Old author')])); });
    expect(screen.queryByRole('link', { name: 'Old author' })).not.toBeInTheDocument();
  });
  it('keeps successful video results downloadable if author search fails', async () => {
    mocks.get.mockImplementation(async (path: string) => path === '/subscriptions' ? { data: [] } : Promise.reject(new Error('risk control')));
    render(<QueryClientProvider client={makeClient()}><MemoryRouter initialEntries={['/search?q=query']}><SearchPage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('authorSearchFailed')).toBeInTheDocument();
    expect(screen.getByText('Usable video')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'download' }));
    expect(mocks.download).toHaveBeenCalledWith('https://www.bilibili.com/video/BV123', false, expect.any(Object));
  });
  it('wires the video failure and retry while leaving author results usable', async () => {
    videoSearchError = 'risk_control';
    render(<QueryClientProvider client={makeClient()}><MemoryRouter initialEntries={['/search?q=query']}><SearchPage /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole('alert')).toHaveTextContent('bilibiliSearchRiskControlled');
    expect(await screen.findByRole('link', { name: 'Same name' })).toBeInTheDocument();
    expect(screen.getByText('Usable video')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(mocks.retryVideo).toHaveBeenCalledTimes(1);
  });
});
