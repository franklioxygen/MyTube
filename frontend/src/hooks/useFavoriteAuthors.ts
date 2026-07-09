import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import type { FavoriteAuthorItem } from '../types';
import { api } from '../utils/apiClient';
import { defaultQueryConfig } from '../utils/queryConfig';

export interface FavoriteAuthorDraft {
    author: string;
    displayName?: string;
    avatarPath?: string;
    channelUrl?: string;
}

type ToggleInput = FavoriteAuthorDraft & { remove: boolean };

const getFavoriteScope = (
    loginRequired: boolean,
    userRole: 'admin' | 'visitor' | null,
    username: string | null,
) => loginRequired
    ? `${userRole ?? 'anonymous'}:${username ?? '__legacy_admin__'}`
    : '__owner__';

export const useFavoriteAuthors = () => {
    const { isAuthenticated, loginRequired, userRole, username } = useAuth();
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const queryClient = useQueryClient();
    const favoriteScope = getFavoriteScope(loginRequired, userRole, username);
    const queryKey = ['favorite-authors', favoriteScope] as const;

    const query = useQuery({
        queryKey,
        queryFn: async () => (await api.get<FavoriteAuthorItem[]>('/favorites/authors')).data,
        enabled: isAuthenticated,
        ...defaultQueryConfig,
    });

    useEffect(() => {
        if (!isAuthenticated) {
            queryClient.removeQueries({ queryKey: ['favorite-authors'] });
        }
    }, [isAuthenticated, queryClient]);

    const toggleMutation = useMutation({
        mutationFn: async (draft: ToggleInput) => {
            if (draft.remove) {
                await api.delete('/favorites/authors', { data: { author: draft.author } });
            } else {
                const { remove: _remove, ...authorDraft } = draft;
                await api.post('/favorites/authors', authorDraft);
            }
        },
        onMutate: async (draft) => {
            await queryClient.cancelQueries({ queryKey });
            const previous = queryClient.getQueryData<FavoriteAuthorItem[]>(queryKey);
            const current = previous ?? [];

            if (current.some((favorite) => favorite.author === draft.author)) {
                queryClient.setQueryData<FavoriteAuthorItem[]>(
                    queryKey,
                    current.filter((favorite) => favorite.author !== draft.author),
                );
            } else {
                queryClient.setQueryData<FavoriteAuthorItem[]>(queryKey, [
                    {
                        author: draft.author,
                        displayName: draft.displayName || draft.author,
                        avatarPath: draft.avatarPath,
                        channelUrl: draft.channelUrl,
                        videoCount: 0,
                        favoritedAt: Date.now(),
                    },
                    ...current,
                ]);
            }

            return { previous };
        },
        onError: (_error, _variables, context) => {
            if (context) {
                queryClient.setQueryData(queryKey, context.previous);
                if (context.previous === undefined) {
                    queryClient.removeQueries({ queryKey, exact: true });
                }
            }
            showSnackbar(t('favoritesUpdateFailed'), 'error');
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey });
        },
    });

    const refreshMutation = useMutation({
        mutationFn: async (draft: FavoriteAuthorDraft) => {
            await api.post('/favorites/authors', draft);
        },
        onError: () => {
            showSnackbar(t('favoritesUpdateFailed'), 'error');
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey });
        },
    });

    const isFavorite = useCallback(
        (author: string) => query.data?.some((favorite) => favorite.author === author) ?? false,
        [query.data],
    );

    const toggle = useCallback(
        (draft: FavoriteAuthorDraft) => toggleMutation.mutate({ ...draft, remove: isFavorite(draft.author) }),
        [isFavorite, toggleMutation],
    );

    const toggleAsync = useCallback(
        (draft: FavoriteAuthorDraft) => toggleMutation.mutateAsync({ ...draft, remove: isFavorite(draft.author) }),
        [isFavorite, toggleMutation],
    );

    const refreshMetadata = useCallback(
        (draft: FavoriteAuthorDraft) => refreshMutation.mutate(draft),
        [refreshMutation],
    );

    return {
        ...query,
        isFavorite,
        toggle,
        toggleAsync,
        refreshMetadata,
        isToggling: toggleMutation.isPending,
    };
};
