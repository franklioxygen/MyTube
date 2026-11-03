import { Alert, Avatar, Box, Button, Card, CardContent, CircularProgress, Link, Stack, TextField, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { SUBSCRIPTIONS_QUERY_KEY, useSubscriptions } from '../hooks/useSubscriptions';
import { platform } from '../theme/colors';
import { api } from '../utils/apiClient';
import { getBilibiliAuthorId } from '../utils/bilibiliAuthor';
import { resolveSubscriptionErrorMessage } from '../utils/subscriptionErrors';
import SubscribeModal, { type SubscribeFormValues } from './SubscribeModal';

interface AuthorResult {
    platform: 'bilibili';
    authorId: string;
    displayName: string;
    channelUrl: string;
    avatarUrl: string;
}

interface AuthorPage {
    results: AuthorResult[];
    page: number;
    hasMore: boolean;
    mode: 'keyword' | 'uid';
}

interface SubscriptionRecord {
    authorUrl: string;
    subscriptionType?: string | null;
}

/** Mounted with a query key by SearchPage so query changes also reset pagination/dialogs. */
const AuthorSearchSection = ({ query }: { query: string }) => {
    const { t } = useLanguage();
    const { userRole, loginRequired } = useAuth();
    const { showSnackbar } = useSnackbar();
    const queryClient = useQueryClient();
    const canSubscribe = !loginRequired || userRole === 'admin';
    const [input, setInput] = useState(query);
    const [lookupQuery, setLookupQuery] = useState(query);
    const [page, setPage] = useState(1);
    const [selectedAuthor, setSelectedAuthor] = useState<AuthorResult | null>(null);
    const [subscribedIds, setSubscribedIds] = useState<Set<string>>(() => new Set());
    const authors = useQuery({
        queryKey: ['authorSearch', 'bilibili', lookupQuery, page],
        queryFn: async ({ signal }) => {
            const response = await api.get<AuthorPage>('/search/authors', {
                params: { source: 'bilibili', query: lookupQuery, page }, signal,
            });
            return response.data;
        },
        staleTime: 60_000,
        retry: false,
        // A page turn keeps the current cards up so the section doesn't collapse
        // and jump the scroll position; a new lookup still shows the loading state.
        placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === lookupQuery ? previous : undefined),
    });
    const subscriptions = useSubscriptions<SubscriptionRecord[]>({ enabled: canSubscribe });
    const existingIds = new Set((subscriptions.data ?? [])
        .filter((item) => !item.subscriptionType || item.subscriptionType === 'author')
        .map((item) => getBilibiliAuthorId(item.authorUrl)));

    const handleSubscribe = async (values: SubscribeFormValues) => {
        if (!selectedAuthor || !canSubscribe) return;
        const author = selectedAuthor;
        try {
            await api.post('/subscriptions', {
                url: `https://space.bilibili.com/${author.authorId}`,
                authorName: author.displayName,
                interval: values.interval,
                downloadAllPrevious: values.downloadAllPrevious,
                downloadShorts: false,
                ...(values.downloadAllPrevious ? { downloadOrder: values.downloadOrder } : {}),
                ...(values.filenameTemplate ? { filenameTemplate: values.filenameTemplate } : {}),
            });
            showSnackbar(t('subscribedSuccessfully'));
        } catch (error) {
            if (!isAxiosError(error) || error.response?.status !== 409) {
                showSnackbar(resolveSubscriptionErrorMessage(error, 'bilibili', t), 'error');
                throw error;
            }
            showSnackbar(t('subscriptionAlreadyExists'), 'info');
        }
        setSubscribedIds((previous) => new Set([...previous, author.authorId]));
        void queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_QUERY_KEY });
        void queryClient.invalidateQueries({ queryKey: ['subscriptionTasks'] });
    };

    return (
        <Box component="section" aria-label={t('bilibiliAuthors')} sx={{ mt: 6 }}>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { md: 'center' }, justifyContent: 'space-between', gap: 2, mb: 3 }}>
                <Box sx={{ minWidth: 0 }}>
                    <Typography component="h2" variant="h5" sx={{ fontWeight: 600, color: platform.bilibili }}>{t('bilibiliAuthors')}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{t('authorSearchHint')}</Typography>
                </Box>
                <Box component="form" onSubmit={(event) => {
                    event.preventDefault();
                    if (!input.trim()) return;
                    setSelectedAuthor(null);
                    setPage(1);
                    setLookupQuery(input.trim());
                }} sx={{ display: 'flex', gap: 1, flexShrink: 0, width: { xs: '100%', md: 420 } }}>
                    <TextField label={t('authorLookupLabel')} value={input} onChange={(event) => setInput(event.target.value)}
                        size="small" fullWidth slotProps={{ htmlInput: { maxLength: 100 } }} />
                    <Button type="submit" variant="outlined" sx={{ flexShrink: 0 }} disabled={!input.trim()}>{t('search')}</Button>
                </Box>
            </Box>
            {authors.isPending ? (
                <Box role="status" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4 }}>
                    <CircularProgress sx={{ color: platform.bilibili }} />
                    <Typography sx={{ mt: 2 }}>{t('loadingAuthors')}</Typography>
                </Box>
            ) : authors.isError ? (
                <Alert severity="warning" action={<Button color="inherit" onClick={() => { void authors.refetch(); }}>{t('retry')}</Button>}>
                    {t(isAxiosError<{ code?: string }>(authors.error) && authors.error.response?.data?.code === 'AUTHOR_SEARCH_RISK_CONTROLLED'
                        ? 'authorSearchRiskControlled' : 'authorSearchFailed')}
                </Alert>
            ) : (
                <>
                    {canSubscribe && subscriptions.isError && (
                        <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" onClick={() => { void subscriptions.refetch(); }}>{t('retry')}</Button>}>
                            {t('authorSubscriptionStatusFailed')}
                        </Alert>
                    )}
                    {authors.data.results.length === 0 ? <Typography color="text.secondary">{t('noAuthorsFound')}</Typography> : (
                        // The 300px minimum and 24px column gap line up with the
                        // four-column video grid above on desktop widths.
                        <Box aria-busy={authors.isPlaceholderData} sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', columnGap: 3, rowGap: 2, opacity: authors.isPlaceholderData ? 0.5 : 1 }}>
                            {authors.data.results.map((author) => {
                                const subscribed = subscribedIds.has(author.authorId) || existingIds.has(author.authorId);
                                return (
                                    <Card key={author.authorId}>
                                        <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1.5, height: '100%', p: 2, '&:last-child': { pb: 2 } }}>
                                            <Avatar src={author.avatarUrl} sx={{ width: 44, height: 44, bgcolor: 'action.selected', color: 'text.secondary' }} slotProps={{ img: { referrerPolicy: 'no-referrer' } }}>{author.displayName.charAt(0)}</Avatar>
                                            <Box sx={{ minWidth: 0, flex: 1 }}>
                                                <Link href={`https://space.bilibili.com/${author.authorId}`} target="_blank" rel="noopener noreferrer" title={author.displayName} underline="hover" color="text.primary"
                                                    sx={{ fontWeight: 600, lineHeight: 1.3, overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                                    {author.displayName}
                                                </Link>
                                                <Typography variant="caption" color="text.secondary" noWrap title={`UID ${author.authorId}`} sx={{ display: 'block' }}>UID {author.authorId}</Typography>
                                            </Box>
                                            {canSubscribe && (
                                                // Long labels wrap rather than squeezing the author name out.
                                                <Button size="small" variant="outlined" sx={{ flexShrink: 0, maxWidth: 110 }} disabled={subscribed || subscriptions.isPending || subscriptions.isError}
                                                    onClick={() => setSelectedAuthor(author)}>
                                                    {subscribed ? t('authorAlreadySubscribed') : t('subscribe')}
                                                </Button>
                                            )}
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </Box>
                    )}
                    {(page > 1 || authors.data.hasMore) && (
                        <Stack direction="row" spacing={2} alignItems="center" justifyContent="center" sx={{ mt: 4 }}>
                            <Button variant="outlined" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>{t('previous')}</Button>
                            <Typography color="text.secondary">{t('authorSearchPage', { page })}</Typography>
                            <Button variant="outlined" disabled={!authors.data.hasMore || authors.isPlaceholderData} onClick={() => setPage((value) => value + 1)}>{t('next')}</Button>
                        </Stack>
                    )}
                </>
            )}
            {selectedAuthor && (
                <SubscribeModal key={selectedAuthor.authorId} open url={selectedAuthor.channelUrl} source="bilibili"
                    authorName={selectedAuthor.displayName} onClose={() => setSelectedAuthor(null)} onConfirm={handleSubscribe} />
            )}
        </Box>
    );
};

export default AuthorSearchSection;
