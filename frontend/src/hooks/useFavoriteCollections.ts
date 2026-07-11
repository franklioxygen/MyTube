import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import type { FavoriteCollectionItem } from '../types';
import { api } from '../utils/apiClient';
import { defaultQueryConfig } from '../utils/queryConfig';

type OptimisticCollection = Partial<FavoriteCollectionItem>;
type ToggleInput = {
    collectionId: string;
    optimistic?: OptimisticCollection;
    remove: boolean;
};

const getFavoriteScope = (
    loginRequired: boolean,
    userRole: 'admin' | 'visitor' | null,
    username: string | null,
) => loginRequired
    ? `${userRole ?? 'anonymous'}:${username ?? '__legacy_admin__'}`
    : '__owner__';

export const useFavoriteCollections = () => {
    const { isAuthenticated, loginRequired, userRole, username } = useAuth();
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const queryClient = useQueryClient();
    const favoriteScope = getFavoriteScope(loginRequired, userRole, username);
    const queryKey = ['favorite-collections', favoriteScope] as const;

    const query = useQuery({
        queryKey,
        queryFn: async () => (await api.get<FavoriteCollectionItem[]>('/favorites/collections')).data,
        enabled: isAuthenticated,
        ...defaultQueryConfig,
    });

    useEffect(() => {
        if (!isAuthenticated) {
            queryClient.removeQueries({ queryKey: ['favorite-collections'] });
        }
    }, [isAuthenticated, queryClient]);

    const toggleMutation = useMutation({
        mutationFn: async ({ collectionId, remove }: ToggleInput) => {
            if (remove) {
                await api.delete(`/favorites/collections/${encodeURIComponent(collectionId)}`);
            } else {
                await api.post(`/favorites/collections/${encodeURIComponent(collectionId)}`);
            }
        },
        onMutate: async ({ collectionId, optimistic }) => {
            await queryClient.cancelQueries({ queryKey });
            const previous = queryClient.getQueryData<FavoriteCollectionItem[]>(queryKey);
            const current = previous ?? [];

            if (current.some((favorite) => favorite.collectionId === collectionId)) {
                queryClient.setQueryData<FavoriteCollectionItem[]>(
                    queryKey,
                    current.filter((favorite) => favorite.collectionId !== collectionId),
                );
            } else {
                queryClient.setQueryData<FavoriteCollectionItem[]>(queryKey, [
                    {
                        collectionId,
                        name: optimistic?.name ?? '',
                        title: optimistic?.title,
                        sourcePlatform: optimistic?.sourcePlatform,
                        videoCount: optimistic?.videoCount ?? 0,
                        thumbnailVideoId: optimistic?.thumbnailVideoId,
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

    const isFavorite = useCallback(
        (collectionId: string) => query.data?.some((favorite) => favorite.collectionId === collectionId) ?? false,
        [query.data],
    );

    const toggle = useCallback(
        (collectionId: string, optimistic?: OptimisticCollection) => {
            toggleMutation.mutate({ collectionId, optimistic, remove: isFavorite(collectionId) });
        },
        [isFavorite, toggleMutation],
    );

    const toggleAsync = useCallback(
        (collectionId: string, optimistic?: OptimisticCollection) =>
            toggleMutation.mutateAsync({ collectionId, optimistic, remove: isFavorite(collectionId) }),
        [isFavorite, toggleMutation],
    );

    return {
        ...query,
        isFavorite,
        toggle,
        toggleAsync,
        isToggling: toggleMutation.isPending,
    };
};
