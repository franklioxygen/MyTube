import { Alert, Avatar, Box, Button, Card, CardContent, CircularProgress, Grid, Link, Stack, TextField, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { SUBSCRIPTIONS_QUERY_KEY, useSubscriptions } from '../hooks/useSubscriptions';
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
        <Box component="section" aria-label={t('bilibiliAuthors')} sx={{ mt: 4 }}>
            <Typography component="h2" variant="h5" fontWeight={600} gutterBottom>{t('bilibiliAuthors')}</Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>{t('authorSearchHint')}</Typography>
            <Box component="form" onSubmit={(event) => {
                event.preventDefault();
                if (!input.trim()) return;
                setSelectedAuthor(null);
                setPage(1);
                setLookupQuery(input.trim());
            }} sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center' }}>
                <TextField label={t('authorLookupLabel')} value={input} onChange={(event) => setInput(event.target.value)}
                    size="small" fullWidth slotProps={{ htmlInput: { maxLength: 100 } }} />
                <Button type="submit" variant="outlined" disabled={!input.trim()}>{t('search')}</Button>
            </Box>
            {authors.isPending ? (
                <Stack direction="row" spacing={2} alignItems="center" role="status">
                    <CircularProgress size={24} /><Typography>{t('loadingAuthors')}</Typography>
                </Stack>
            ) : authors.isError ? (
                <Alert severity="warning" action={<Button color="inherit" onClick={() => { void authors.refetch(); }}>{t('retry')}</Button>}>
                    {t('authorSearchFailed')}
                </Alert>
            ) : (
                <>
                    {canSubscribe && subscriptions.isError && (
                        <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" onClick={() => { void subscriptions.refetch(); }}>{t('retry')}</Button>}>
                            {t('authorSubscriptionStatusFailed')}
                        </Alert>
                    )}
                    {authors.data.results.length === 0 ? <Typography>{t('noAuthorsFound')}</Typography> : (
                        <Grid container spacing={2}>
                            {authors.data.results.map((author) => {
                                const subscribed = subscribedIds.has(author.authorId) || existingIds.has(author.authorId);
                                return (
                                    <Grid key={author.authorId} size={{ xs: 12, sm: 6, lg: 4 }}>
                                        <Card sx={{ height: '100%' }}>
                                            <CardContent>
                                                <Stack direction="row" spacing={2} alignItems="center">
                                                    <Avatar src={author.avatarUrl} slotProps={{ img: { referrerPolicy: 'no-referrer' } }}>{author.displayName.charAt(0)}</Avatar>
                                                    <Box sx={{ minWidth: 0, flex: 1 }}>
                                                        <Link href={`https://space.bilibili.com/${author.authorId}`} target="_blank" rel="noopener noreferrer" sx={{ overflowWrap: 'anywhere' }}>
                                                            {author.displayName}
                                                        </Link>
                                                        <Typography variant="body2" color="text.secondary">Bilibili · UID {author.authorId}</Typography>
                                                    </Box>
                                                </Stack>
                                                {canSubscribe && (
                                                    <Button variant="outlined" sx={{ mt: 2 }} disabled={subscribed || subscriptions.isPending || subscriptions.isError}
                                                        onClick={() => setSelectedAuthor(author)}>
                                                        {subscribed ? t('authorAlreadySubscribed') : t('subscribe')}
                                                    </Button>
                                                )}
                                            </CardContent>
                                        </Card>
                                    </Grid>
                                );
                            })}
                        </Grid>
                    )}
                    {(page > 1 || authors.data.hasMore) && (
                        <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 2 }}>
                            <Button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>{t('previous')}</Button>
                            <Typography>{t('authorSearchPage', { page })}</Typography>
                            <Button disabled={!authors.data.hasMore} onClick={() => setPage((value) => value + 1)}>{t('next')}</Button>
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
