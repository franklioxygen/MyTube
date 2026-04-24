import AddIcon from '@mui/icons-material/Add';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { api } from '../../../utils/apiClient';
import { CreateTokenInput, RssToken, UpdateTokenInput, rssApi } from '../../../utils/rssApi';
import RssTokenCard from './RssTokenCard';
import RssTokenDialog from './RssTokenDialog';

interface VideoItem {
    author?: string;
    channelUrl?: string;
    tags?: string[] | string;
}

const getVideoTags = (tags: VideoItem['tags']): string[] => {
    if (Array.isArray(tags)) {
        return tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0);
    }

    if (typeof tags === 'string' && tags.trim().length > 0) {
        try {
            const parsed = JSON.parse(tags);
            return Array.isArray(parsed)
                ? parsed.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
                : [];
        } catch {
            return [];
        }
    }

    return [];
};

const RssTokenList: React.FC = () => {
    const { t } = useLanguage();
    const queryClient = useQueryClient();
    const [showCreateDialog, setShowCreateDialog] = useState(false);

    const { data, isLoading, isError } = useQuery({
        queryKey: ['rss-tokens'],
        queryFn: async () => {
            const res = await rssApi.listTokens();
            return res.data.tokens;
        },
    });

    const { data: videosData } = useQuery({
        queryKey: ['videos-for-rss'],
        queryFn: async () => {
            const res = await api.get<VideoItem[]>('/videos');
            return Array.isArray(res.data) ? res.data : [];
        },
        staleTime: 5 * 60 * 1000,
    });

    const videos: VideoItem[] = videosData ?? [];

    const channelOptions = useMemo(() => {
        const seen = new Set<string>();
        const opts: { channelUrl: string; author: string }[] = [];
        for (const v of videos) {
            if (v.channelUrl && !seen.has(v.channelUrl)) {
                seen.add(v.channelUrl);
                opts.push({ channelUrl: v.channelUrl, author: v.author ?? v.channelUrl });
            }
        }
        return opts;
    }, [videos]);

    const authorOptions = useMemo(() => {
        const seen = new Set<string>();
        for (const v of videos) {
            if (v.author) seen.add(v.author);
        }
        return [...seen].sort();
    }, [videos]);

    const tagOptions = useMemo(() => {
        const seen = new Set<string>();
        for (const v of videos) {
            getVideoTags(v.tags).forEach((tag) => seen.add(tag));
        }
        return [...seen].sort();
    }, [videos]);

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['rss-tokens'] });

    const createMutation = useMutation({
        mutationFn: (input: CreateTokenInput) => rssApi.createToken(input),
        onSuccess: () => {
            invalidate();
            setShowCreateDialog(false);
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: UpdateTokenInput }) =>
            rssApi.updateToken(id, patch),
        onSuccess: () => invalidate(),
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => rssApi.deleteToken(id),
        onSuccess: () => invalidate(),
    });

    const resetMutation = useMutation({
        mutationFn: (id: string) => rssApi.resetToken(id),
        onSuccess: () => invalidate(),
    });

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                <CircularProgress size={28} />
            </Box>
        );
    }

    if (isError) {
        return <Alert severity="error">{t('rssLoadTokensError')}</Alert>;
    }

    const tokens: RssToken[] = data ?? [];

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex' }}>
                <Button
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => setShowCreateDialog(true)}
                >
                    {t('rssCreateToken')}
                </Button>
            </Box>

            {tokens.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    {t('rssNoFeeds')}
                </Typography>
            )}

            {tokens.map((token) => (
                <RssTokenCard
                    key={token.id}
                    token={token}
                    channelOptions={channelOptions}
                    authorOptions={authorOptions}
                    tagOptions={tagOptions}
                    onUpdate={(id, patch) => updateMutation.mutate({ id, patch })}
                    onDelete={(id) => deleteMutation.mutate(id)}
                    onReset={(id) => resetMutation.mutate(id)}
                    isUpdating={updateMutation.isPending}
                />
            ))}

            <RssTokenDialog
                open={showCreateDialog}
                mode="create"
                channelOptions={channelOptions}
                authorOptions={authorOptions}
                tagOptions={tagOptions}
                onClose={() => setShowCreateDialog(false)}
                onCreate={(input) => createMutation.mutate(input)}
                isLoading={createMutation.isPending}
            />
        </Box>
    );
};

export default RssTokenList;
