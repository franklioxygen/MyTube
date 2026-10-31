import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { api, ensureCsrfToken } from '../utils/apiClient';
import { bulkErrorDetails } from '../utils/bulkVideoOrganization';
import type { BulkOperation, BulkResult } from '../utils/bulkVideoOrganization';

export function useBulkVideoActions() {
    const client = useQueryClient();
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const inFlight = useRef(false);

    const refresh = async (operation: BulkOperation, catalogChanged = false) => {
        const ids = new Set(operation.videoIds);
        const detailFilter = { predicate: (query: { queryKey: readonly unknown[] }) =>
            query.queryKey[0] === 'video' && ids.has(String(query.queryKey[1])) };
        if (operation.kind === 'tags') {
            await Promise.all([
                client.cancelQueries({ queryKey: ['videos'] }), client.cancelQueries(detailFilter),
                client.cancelQueries({ queryKey: ['recommendations', 'signals'] }),
            ]);
            await Promise.all([
                client.invalidateQueries({ queryKey: ['videos'] }, { throwOnError: true }),
                client.invalidateQueries(detailFilter, { throwOnError: true }),
                client.invalidateQueries({ queryKey: ['recommendations', 'signals'] }, { throwOnError: true }),
                ...(catalogChanged ? [client.invalidateQueries({ queryKey: ['settings'] }, { throwOnError: true })] : []),
            ]);
        } else {
            await Promise.all([
                client.cancelQueries({ queryKey: ['collections'] }),
                client.cancelQueries({ queryKey: ['favorite-collections'] }),
            ]);
            await Promise.all([
                client.invalidateQueries({ queryKey: ['collections'] }, { throwOnError: true }),
                client.invalidateQueries({ queryKey: ['favorite-collections'] }, { throwOnError: true }),
            ]);
        }
    };

    const mutation = useMutation({
        retry: false,
        mutationFn: async (operation: BulkOperation) => {
            await ensureCsrfToken();
            const { kind, ...body } = operation;
            const response = await api.post<{ success: boolean; data: BulkResult }>(
                kind === 'tags' ? '/videos/batch/tags' : '/collections/batch-add', body,
            );
            const data = response.data.data;
            let refreshFailed = false;
            try { await refresh(operation, data.catalogChanged); }
            catch { refreshFailed = true; }
            showSnackbar(
                refreshFailed ? t('bulkSavedRefreshFailed') : data.changedVideoIds.length
                    ? t('bulkSaved', { changed: data.changedVideoIds.length, unchanged: data.unchangedVideoIds.length })
                    : t('bulkUnchanged'),
                refreshFailed ? 'warning' : 'success',
            );
            return data;
        },
        onError: async (error, operation) => {
            const { status } = bulkErrorDetails(error);
            if (status === 401 || status === 403) void client.invalidateQueries({ queryKey: ['authSettings'] });
            if (!status) {
                // A lost response can hide a committed write, including new catalog tags.
                try { await refresh(operation, operation.kind === 'tags'); }
                catch { /* Preserve the original write error and the dialog draft. */ }
            }
        },
    });

    const run = async (operation: BulkOperation) => {
        if (inFlight.current) throw new Error('A bulk operation is already in progress');
        inFlight.current = true;
        try { return await mutation.mutateAsync(operation); }
        finally { inFlight.current = false; }
    };

    return { run, isPending: mutation.isPending, refresh };
}
