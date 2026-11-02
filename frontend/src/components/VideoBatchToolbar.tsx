import { Checklist, Deselect, Label, PlaylistAdd } from '@mui/icons-material';
import { Alert, Box, Button, Checkbox, Collapse, FormControlLabel, Paper, Typography, useMediaQuery } from '@mui/material';
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
    hideEntryButton?: boolean;
}

export default function VideoBatchToolbar(props: Props) {
    const { t } = useLanguage();
    const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const { active } = props.selection;
    const duration = reduceMotion ? 0 : 250;
    if (!props.selection.canWrite) return null;
    if (!active && props.orderedIds.length === 0) return null;
    return <Box sx={{ position: active ? 'sticky' : 'relative', top: active ? 64 : undefined, zIndex: 11, mb: props.hideEntryButton ? 0 : 2 }}>
        <Collapse in={!active && !props.hideEntryButton} timeout={duration} unmountOnExit aria-hidden={active} inert={active}
            sx={{ opacity: active ? 0 : 1, transition: `height ${duration}ms ease, opacity ${duration}ms ease` }}>
            <Button startIcon={<Checklist />} onClick={props.selection.enter} variant="outlined"
                sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary' }}>
                {t('bulkSelectVideos')}
            </Button>
        </Collapse>
        <Collapse in={active} timeout={duration} mountOnEnter unmountOnExit aria-hidden={!active} inert={!active}
            sx={{ opacity: active ? 1 : 0, transition: `height ${duration}ms ease, opacity ${duration}ms ease` }}>
            <Box sx={{ pb: props.hideEntryButton ? 2 : 0 }}>
                {/* Remount drafts immediately when the selection/authorization scope changes. */}
                <VideoBatchToolbarContent key={props.selection.scope} {...props} />
            </Box>
        </Collapse>
    </Box>;
}

function VideoBatchToolbarContent({ selection, pageIds, orderedIds, availableTags = [], infiniteScroll = false, alwaysOn = false, hideEntryButton = false }: Props) {
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
            : error.invalidVideoIds.length ? t('bulkInvalidVideos', { count: error.invalidVideoIds.length })
            : error.requestNotSent ? t('bulkRequestNotSent')
            : !error.status ? t('bulkRequestUnknown') : error.message || t('error')}
        {(error.missingVideoIds.length > 0 || error.invalidVideoIds.length > 0) && <Button disabled={actions.isPending} onClick={() => {
            const excluded = new Set([...error.missingVideoIds, ...error.invalidVideoIds]);
            setSnapshot((ids) => ids.filter((id) => !excluded.has(id)));
            setError(null);
        }}>{error.invalidVideoIds.length ? t('bulkRemoveInvalid') : t('bulkRemoveMissing')}</Button>}
    </Alert> : null;
    const targetIds = infiniteScroll ? orderedIds : pageIds;
    const selectionLabel = infiniteScroll ? t('bulkSelectResults', { count: targetIds.length }) : t('bulkSelectPage');
    const selectionDescription = infiniteScroll ? selectionLabel : t('bulkSelectPageDescription');
    const pageSelected = targetIds.filter((id) => selection.selectedIds.has(id)).length;
    const overLimit = targetIds.length > MAX_BULK_VIDEOS;
    const showExitButton = !alwaysOn && !hideEntryButton;
    return <>
        <Paper variant="outlined" sx={{
            p: { xs: 0, sm: 1 },
            borderRadius: { xs: 0, sm: 1 },
            borderLeftWidth: { xs: 0, sm: 1 },
            borderRightWidth: { xs: 0, sm: 1 },
        }}>
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: { xs: 0, sm: 2 } }}>
                <Box sx={{
                    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, minWidth: 0,
                    width: { xs: '100%', sm: 'auto' },
                    justifyContent: { xs: 'space-between', sm: 'flex-start' },
                    px: { xs: 2, sm: 0 }, py: { xs: 0.5, sm: 0 },
                }}>
                    <FormControlLabel control={<Checkbox checked={targetIds.length > 0 && pageSelected === targetIds.length}
                        indeterminate={pageSelected > 0 && pageSelected < targetIds.length}
                        disabled={selection.locked || overLimit || targetIds.length === 0}
                        slotProps={{ input: { 'aria-label': selectionDescription } }}
                        onChange={() => selection.togglePage(targetIds)} />}
                        label={selectionLabel} title={selectionDescription}
                        sx={{ m: 0, minHeight: 40 }} />
                    <Typography aria-live="polite" color="text.secondary" sx={{
                        fontSize: { xs: '0.8125rem', sm: '0.875rem' },
                        borderLeft: { xs: 'none', sm: '1px solid' }, borderColor: 'divider',
                        pl: { xs: 0, sm: 2 }, ml: { xs: 0, sm: 1 },
                    }}>
                        {t('bulkSelectedCount', { count: selection.selectedIds.size })}
                    </Typography>
                </Box>
                {/* Keep actions together so wrapping starts with Add Tags. */}
                <Box sx={{
                    display: { xs: 'grid', sm: 'flex' }, alignItems: 'center', flexWrap: 'wrap',
                    gridTemplateColumns: { xs: `repeat(${showExitButton ? 2 : 3}, minmax(0, 1fr))`, sm: 'none' },
                    gap: { xs: 0.75, sm: 1 }, flexBasis: { xs: '100%', sm: 'max-content' }, maxWidth: '100%',
                    ml: { xs: 0, sm: 'auto' },
                    px: { xs: 1.5, sm: 0 }, pt: { xs: 0.5, sm: 0 }, pb: { xs: 1, sm: 0 },
                    '& .MuiButton-root': {
                        minWidth: 0, minHeight: 40, px: { xs: 0.75, sm: 1.5 },
                        fontSize: { xs: '0.8125rem', sm: '0.875rem' }, whiteSpace: 'nowrap',
                        bgcolor: 'action.hover',
                        '& .MuiButton-startIcon': { ml: 0, mr: { xs: 0.5, sm: 1 }, flexShrink: 0 },
                    },
                }}>
                    <Button startIcon={<Label />} aria-label={t('addTags')} title={t('addTags')}
                        disabled={!selection.selectedIds.size || selection.locked} onClick={() => open('tags')}>
                        <Box component="span" sx={{ display: { xs: 'block', sm: 'none' }, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('tags')}</Box>
                        <Box component="span" sx={{ display: { xs: 'none', sm: 'block' } }}>{t('addTags')}</Box>
                    </Button>
                    <Button startIcon={<PlaylistAdd />} aria-label={t('bulkAddToCollection')} title={t('bulkAddToCollection')}
                        disabled={!selection.selectedIds.size || selection.locked} onClick={() => open('collection')}>
                        <Box component="span" sx={{ display: { xs: 'block', sm: 'none' }, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('collection')}</Box>
                        <Box component="span" sx={{ display: { xs: 'none', sm: 'block' } }}>{t('bulkAddToCollection')}</Box>
                    </Button>
                    <Button startIcon={<Deselect />} title={t('bulkClearSelection')}
                        disabled={!selection.selectedIds.size || selection.locked} onClick={selection.clear}>
                        <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('bulkClearSelection')}</Box>
                    </Button>
                    {showExitButton && <Button disabled={selection.locked} onClick={selection.exit} title={t('bulkExitSelection')}>
                        <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('bulkExitSelection')}</Box>
                    </Button>}
                </Box>
            </Box>
            {overLimit && <Typography variant="caption" color="text.secondary">{t('bulkSelectionLimit')}</Typography>}
        </Paper>
        <Suspense fallback={null}>
        {modal === 'tags' && <BulkTagsModal count={snapshot.length} availableTags={availableTags}
            pending={actions.isPending} error={errorContent} onClose={close}
            onSave={(tags) => save({ kind: 'tags', videoIds: snapshot, tags })} />}
        {modal === 'collection' && <BulkCollectionModal count={snapshot.length} collections={collections}
            conflictingCollectionId={error?.existingCollectionId}
            pending={actions.isPending} error={errorContent} onClose={close}
            onSave={(target) => save({ kind: 'collection', videoIds: snapshot, ...target })} />}
        </Suspense>
    </>;
}
