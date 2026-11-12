import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../utils/apiClient';
import { useAuth } from '../contexts/AuthContext';

export interface AuthorProfile {
    author: string;
    customAvatarPath: string | null;
    effectiveAvatarPath: string | null;
    defaultAvatarPath: string | null;
    avatarOrigin: 'custom' | 'auto' | 'none';
    videoCount: number;
    multipleSources: boolean;
    avatarSources: Array<{ platform: "youtube" | "bilibili" | "twitch"; channelUrl: string }>;
}

export function useAuthorProfile(author: string, enabled = true) {
    const { loginRequired, userRole } = useAuth();
    const canManage = !loginRequired || userRole === 'admin';
    const queryClient = useQueryClient();
    const queryKey = ['author-profile', author] as const;
    const query = useQuery({
        queryKey,
        queryFn: async ({ signal }) => (await api.get<{ data: AuthorProfile }>('/authors/profile', { params: { author }, signal })).data.data,
        enabled: enabled && canManage && !!author.trim(),
        staleTime: 0,
    });
    const save = async (file: Blob | null) => {
        let profile: AuthorProfile;
        if (file) {
            const body = new FormData();
            body.append('author', author);
            body.append('avatar', file, 'avatar.png');
            profile = (await api.put<{ data: AuthorProfile }>('/authors/avatar', body, {
                headers: { 'Content-Type': 'multipart/form-data' }, timeout: 30000,
            })).data.data;
        } else {
            profile = (await api.delete<{ data: AuthorProfile }>('/authors/avatar', { data: { author }, timeout: 30000 })).data.data;
        }
        queryClient.setQueryData(queryKey, profile);
        // Refetch failures must not turn a successful write into an upload error.
        void Promise.all([
            queryClient.invalidateQueries({ queryKey: ['videos'] }),
            queryClient.invalidateQueries({ queryKey: ['video'] }),
            queryClient.invalidateQueries({ queryKey: ['favorite-authors'] }),
        ]);
        return profile;
    };
    const fetchFromSource = async (channelUrl: string, signal?: AbortSignal) => {
        const response = await api.post<Blob>('/authors/avatar/from-source', { author, channelUrl }, {
            responseType: 'blob', timeout: 65000, signal,
        });
        return new File([response.data], 'channel-avatar', { type: response.data.type });
    };
    return { ...query, canManage, save, fetchFromSource };
}
