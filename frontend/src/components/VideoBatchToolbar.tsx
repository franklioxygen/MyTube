import { Checklist, Label, PlaylistAdd } from '@mui/icons-material';
import { Alert, Box, Button, Checkbox, FormControlLabel, Paper, Typography } from '@mui/material';
import { Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '../contexts/LanguageContext';
import { useCollection } from '../contexts/CollectionContext';
import { useBulkVideoActions } from '../hooks/useBulkVideoActions';
import type { VideoSelection } from '../hooks/useVideoSelection';
import { bulkErrorDetails, MAX_BULK_VIDEOS } from '../utils/bulkVideoOrganization';
import type { BulkOperation } from '../utils/bulkVideoOrganization';
import { lazyWithRetry } from '../utils/lazyWithRetry';

const BulkTagsModal = lazyWithRetry(() => import('./BulkTagsModal'), 'bulk-tags-modal');
const BulkCollectionModal = lazyWithRetry(() => import('./BulkCollectionModal'), 'bulk-collection-modal');

interface Props {
    selection: VideoSelection;
    pageIds: string[];
    orderedIds: string[];
    availableTags?: string[];
    infiniteScroll?: boolean;
    alwaysOn?: boolean;
}

export default function VideoBatchToolbar(props: Props) {
    const { t } = useLanguage();
    if (!props.selection.canWrite) return null;
    if (!props.selection.active) return <Box sx={{ mb: 2 }}>
        <Button startIcon={<Checklist />} onClick={props.selection.enter}>{t('bulkSelectVideos')}</Button>
    </Box>;
    // Remount all drafts when the selection/authorization scope changes.
    return <VideoBatchToolbarContent key={props.selection.scope} {...props} />;
}

function VideoBatchToolbarContent({ selection, pageIds, orderedIds, availableTags = [], infiniteScroll = false, alwaysOn = false }: Props) {
    const { t } = useLanguage();
    const { collections } = useCollection();
    const client = useQueryClient();
    const actions = useBulkVideoActions();
    const [modal, setModal] = useState<'tags' | 'collection' | null>(null);
    const [snapshot, setSnapshot] = useState<string[]>([]);
    const [error, setError] = useState<ReturnType<typeof bulkErrorDetails> | null>(null);

    const close = () => {
        if (actions.isPending) return;
        setModal(null);
        setError(null);
        selection.setLocked(false);
    };
    const open = (kind: 'tags' | 'collection') => {
        const ordered = orderedIds.filter((id) => selection.selectedIds.has(id));
        const remaining = [...selection.selectedIds].filter((id) => !ordered.includes(id));
        setSnapshot([...ordered, ...remaining]);
        setError(null);
        setModal(kind);
        selection.setLocked(true);
    };
    const save = async (operation: BulkOperation) => {
        setError(null);
        try {
            await actions.run(operation);
            setModal(null);
            selection.setLocked(false);
        } catch (failure) {
            const details = bulkErrorDetails(failure);
            setError(details);
            if (details.missingVideoIds.length) {
                void client.invalidateQueries({ queryKey: ['videos'] });
            }
            if (details.existingCollectionId || details.status === 404) {
                void client.invalidateQueries({ queryKey: ['collections'] });
            }
            throw failure;
        }
    };
    const errorContent = error ? <Alert severity="error" sx={{ mb: 2 }}>
        {error.missingVideoIds.length ? t('bulkMissingVideos', { count: error.missingVideoIds.length })
            : error.existingCollectionId ? t('bulkCollectionConflict')
            : !error.status ? t('bulkRequestUnknown') : error.message || t('error')}
        {error.missingVideoIds.length > 0 && <Button disabled={actions.isPending} onClick={() => {
            setSnapshot((ids) => ids.filter((id) => !error.missingVideoIds.includes(id)));
            setError(null);
        }}>{t('bulkRemoveMissing')}</Button>}
    </Alert> : null;
    const targetIds = infiniteScroll ? orderedIds : pageIds;
    const pageSelected = targetIds.filter((id) => selection.selectedIds.has(id)).length;
    const overLimit = targetIds.length > MAX_BULK_VIDEOS;
    return <>
        <Paper variant="outlined" sx={{ position: 'sticky', top: 64, zIndex: 11, p: 1, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                <FormControlLabel control={<Checkbox checked={targetIds.length > 0 && pageSelected === targetIds.length}
                    indeterminate={pageSelected > 0 && pageSelected < targetIds.length}
                    disabled={selection.locked || overLimit || targetIds.length === 0}
                    onChange={() => selection.togglePage(targetIds)} />}
                    label={infiniteScroll ? t('bulkSelectResults', { count: targetIds.length }) : t('bulkSelectPage')} />
                <Typography aria-live="polite">{t('bulkSelectedCount', { count: selection.selectedIds.size })}</Typography>
                <Button startIcon={<Label />} disabled={!selection.selectedIds.size || selection.locked} onClick={() => open('tags')}>{t('addTags')}</Button>
                <Button startIcon={<PlaylistAdd />} disabled={!selection.selectedIds.size || selection.locked} onClick={() => open('collection')}>{t('bulkAddToCollection')}</Button>
                <Button disabled={!selection.selectedIds.size || selection.locked} onClick={selection.clear}>{t('bulkClearSelection')}</Button>
                {!alwaysOn && <Button disabled={selection.locked} onClick={selection.exit}>{t('bulkExitSelection')}</Button>}
            </Box>
            {overLimit && <Typography variant="caption" color="text.secondary">{t('bulkSelectionLimit')}</Typography>}
        </Paper>
        <Suspense fallback={null}>
        {modal === 'tags' && <BulkTagsModal count={snapshot.length} availableTags={availableTags}
            pending={actions.isPending} error={errorContent} onClose={close}
            onSave={(tags) => save({ kind: 'tags', videoIds: snapshot, tags })} />}
        {modal === 'collection' && <BulkCollectionModal count={snapshot.length} collections={collections}
            pending={actions.isPending} error={errorContent} onClose={close}
            onSave={(target) => save({ kind: 'collection', videoIds: snapshot, ...target })} />}
        </Suspense>
    </>;
}
