import express from 'express';
import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';
const search = vi.hoisted(() => vi.fn());
vi.mock('../../services/downloaders/bilibili/bilibiliAuthorSearch', () => ({
  searchBilibiliAuthors: search,
  AuthorSearchUnavailableError: class extends Error {
    constructor(readonly code: 'AUTHOR_SEARCH_UNAVAILABLE' | 'AUTHOR_SEARCH_RISK_CONTROLLED' = 'AUTHOR_SEARCH_UNAVAILABLE') { super(); }
  },
}));
vi.mock('../../services/passwordService', () => ({ isLoginRequired: () => true }));
import { searchAuthors, authorSearchLimiter } from '../../controllers/authorSearchController';
import { AuthorSearchUnavailableError } from '../../services/downloaders/bilibili/bilibiliAuthorSearch';
import { asyncHandler, errorHandler } from '../../middleware/errorHandler';
import { roleBasedAuthMiddleware } from '../../middleware/roleBasedAuthMiddleware';
const app = express();
app.use((req, _res, next) => { req.user = { role: 'visitor' } as typeof req.user; next(); });
app.use(roleBasedAuthMiddleware);
app.get('/search/authors', asyncHandler(searchAuthors));
app.post('/subscriptions', (_req, res) => res.sendStatus(201));
app.use(errorHandler);
beforeEach(() => { vi.clearAllMocks(); search.mockResolvedValue({ results: [], page: 1, hasMore: false, mode: 'keyword' }); });
it('lets visitors read author results without granting subscription writes', async () => {
  expect((await request(app).get('/search/authors').query({ query: '极客湾', source: 'bilibili' })).status).toBe(200);
  expect((await request(app).post('/subscriptions')).status).toBe(403);
  expect(search).toHaveBeenCalledWith('极客湾', 1);
});
it.each([
  { source: 'youtube', query: 'author' }, { source: 'bilibili', query: '' },
  { source: 'bilibili', query: 'x'.repeat(101) }, { source: 'bilibili', query: ['one', 'two'] },
  { source: 'bilibili', query: 'author', page: '11' }, { source: 'bilibili', query: 'author', page: '1.5' },
  { source: 'bilibili', query: 'https://evil.test/123' }, { source: 'bilibili', query: '0' },
])('rejects invalid author search input %j before calling upstream', async (params) => {
  expect((await request(app).get('/search/authors').query(params)).status).toBe(400);
  expect(search).not.toHaveBeenCalled();
});
it('distinguishes upstream failure from a successful empty result', async () => {
  search.mockRejectedValue(new AuthorSearchUnavailableError());
  const response = await request(app).get('/search/authors').query({ query: 'author', source: 'bilibili' });
  expect(response.status).toBe(502);
  expect(response.body.code).toBe('AUTHOR_SEARCH_UNAVAILABLE');
  expect(response.body.results).toBeUndefined();
});
it('exposes persistent upstream risk control separately from ordinary failures', async () => {
  search.mockRejectedValue(new AuthorSearchUnavailableError('AUTHOR_SEARCH_RISK_CONTROLLED'));
  const response = await request(app).get('/search/authors').query({ query: 'author', source: 'bilibili' });
  expect(response.status).toBe(502);
  expect(response.body.code).toBe('AUTHOR_SEARCH_RISK_CONTROLLED');
  expect(response.body.results).toBeUndefined();
});
it('limits upstream amplification separately from general API traffic', async () => {
  const limitedApp = express();
  limitedApp.get('/search/authors', authorSearchLimiter, asyncHandler(searchAuthors));
  for (let i = 0; i < 30; i++) {
    expect((await request(limitedApp).get('/search/authors?source=bilibili&query=author')).status).toBe(200);
  }
  expect((await request(limitedApp).get('/search/authors?source=bilibili&query=author')).status).toBe(429);
  expect(search).toHaveBeenCalledTimes(30);
});

it('shares an IPv6 prefix limit across rotating addresses while keeping other prefixes independent', async () => {
  const limitedApp = express();
  limitedApp.set('trust proxy', 1);
  limitedApp.get('/search/authors', authorSearchLimiter, asyncHandler(searchAuthors));
  for (let i = 0; i < 30; i++) {
    const ip = `2001:0db8:1234:${(0x5600 + i).toString(16)}:0000:0000:0000:0001`;
    const response = await request(limitedApp).get('/search/authors?source=bilibili&query=author').set('X-Forwarded-For', ip);
    expect(response.status).toBe(200);
  }
  const blocked = await request(limitedApp).get('/search/authors?source=bilibili&query=author').set('X-Forwarded-For', '2001:0db8:1234:56ff:0000:0000:0000:0002');
  expect(blocked.status).toBe(429);
  expect(search).toHaveBeenCalledTimes(30);
  const otherPrefix = await request(limitedApp).get('/search/authors?source=bilibili&query=author').set('X-Forwarded-For', '2001:0db8:1234:5700:0000:0000:0000:0001');
  expect(otherPrefix.status).toBe(200);
});

it('keeps distinct IPv4 clients in separate rate-limit buckets', async () => {
  const limitedApp = express();
  limitedApp.set('trust proxy', 1);
  limitedApp.get('/search/authors', authorSearchLimiter, asyncHandler(searchAuthors));
  for (let i = 0; i < 30; i++) {
    const response = await request(limitedApp).get('/search/authors?source=bilibili&query=author').set('X-Forwarded-For', '203.0.113.10');
    expect(response.status).toBe(200);
  }
  const blocked = await request(limitedApp).get('/search/authors?source=bilibili&query=author').set('X-Forwarded-For', '203.0.113.10');
  expect(blocked.status).toBe(429);
  const otherClient = await request(limitedApp).get('/search/authors?source=bilibili&query=author').set('X-Forwarded-For', '203.0.113.11');
  expect(otherClient.status).toBe(200);
  expect(search).toHaveBeenCalledTimes(31);
});
