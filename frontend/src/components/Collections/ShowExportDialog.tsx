import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    List,
    ListItemButton,
    ListItemText,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import {
    Collection,
    CollectionShowCandidate,
    CollectionShowExportResponse,
    CollectionShowSearchResponse,
} from '../../types';
import { api } from '../../utils/apiClient';

interface ShowExportDialogProps {
    open: boolean;
    collection: Collection;
    onClose: () => void;
    onActivated: (response: CollectionShowExportResponse) => void;
}

/**
 * Setup flow for exporting a collection as its own media-server show.
 *
 * The toggle is not fire-and-forget: the user must choose the metadata first,
 * because confirming allocates the show's directory name from the accepted
 * title and that folder is never moved afterwards.
 */
const ShowExportDialog: React.FC<ShowExportDialogProps> = ({
    open,
    collection,
    onClose,
    onActivated,
}) => {
    const { t } = useLanguage();
    const [query, setQuery] = useState(collection.title || collection.name || '');
    const [searching, setSearching] = useState(false);
    const [searched, setSearched] = useState(false);
    const [noCredential, setNoCredential] = useState(false);
    const [candidates, setCandidates] = useState<CollectionShowCandidate[]>([]);
    const [selected, setSelected] = useState<CollectionShowCandidate | null>(null);
    const [manualTitle, setManualTitle] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const wasSeason = Boolean(collection.mediaServerSeasonNumber);

    const handleSearch = async () => {
        setSearching(true);
        setError(null);
        try {
            const res = await api.post<CollectionShowSearchResponse>(
                `/collections/${collection.id}/tmdb/search`,
                { query }
            );
            setNoCredential(res.data.status === 'no_credential');
            setCandidates(res.data.candidates || []);
            setSelected(null);
            setSearched(true);
        } catch {
            setError(t('collectionShowSearchFailed'));
        } finally {
            setSearching(false);
        }
    };

    const activate = async (body: Record<string, unknown>) => {
        setSubmitting(true);
        setError(null);
        try {
            const res = await api.put<CollectionShowExportResponse>(
                `/collections/${collection.id}/show-export`,
                { enabled: true, ...body }
            );
            onActivated(res.data);
        } catch (e: unknown) {
            const code = (e as { response?: { data?: { code?: string } } })?.response
                ?.data?.code;
            setError(
                code === 'lock_unavailable'
                    ? t('collectionShowLockBusy')
                    : code === 'layout_not_playlist_tv'
                      ? t('collectionShowWrongLayout')
                      : t('collectionShowActivationFailed')
            );
        } finally {
            setSubmitting(false);
        }
    };

    const proposedName = selected?.title || manualTitle.trim() || collection.title || collection.name;

    return (
        <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{t('collectionShowDialogTitle')}</DialogTitle>
            <DialogContent>
                <Typography variant="body2" color="text.secondary">
                    {t('collectionShowDialogDescription')}
                </Typography>

                {wasSeason && (
                    <Alert severity="warning" sx={{ mt: 2 }}>
                        {t('collectionShowPromotionWarning')}
                    </Alert>
                )}

                <Divider sx={{ my: 2 }} />

                <Typography variant="subtitle2" component="h3" gutterBottom>
                    {t('collectionShowSearchHeading')}
                </Typography>
                <Stack direction="row" spacing={1}>
                    <TextField
                        fullWidth
                        size="small"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        label={t('collectionShowSearchLabel')}
                        inputProps={{ maxLength: 200 }}
                    />
                    <Button
                        variant="outlined"
                        onClick={() => { void handleSearch(); }}
                        disabled={searching || !query.trim()}
                    >
                        {searching ? <CircularProgress size={20} /> : t('collectionShowSearchAction')}
                    </Button>
                </Stack>

                {noCredential && (
                    <Alert severity="info" sx={{ mt: 2 }}>
                        {t('collectionShowNoCredential')}
                    </Alert>
                )}

                {searched && !noCredential && candidates.length === 0 && (
                    <Alert severity="info" sx={{ mt: 2 }}>
                        {t('collectionShowNoResults')}
                    </Alert>
                )}

                {candidates.length > 0 && (
                    <List dense sx={{ mt: 1, maxHeight: 260, overflowY: 'auto' }}>
                        {candidates.map((candidate) => (
                            <ListItemButton
                                key={`${candidate.mediaType}-${candidate.tmdbId}`}
                                selected={selected?.tmdbId === candidate.tmdbId}
                                onClick={() => { setSelected(candidate); setManualTitle(''); }}
                            >
                                <ListItemText
                                    primary={
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <span>{candidate.title}</span>
                                            <Chip
                                                size="small"
                                                label={
                                                    candidate.mediaType === 'tv'
                                                        ? t('collectionShowMediaTypeTv')
                                                        : t('collectionShowMediaTypeMovie')
                                                }
                                            />
                                            {/* Low-confidence results are still selectable, but
                                                must be visibly labelled as suggestions. */}
                                            {!candidate.highConfidence && (
                                                <Chip
                                                    size="small"
                                                    color="warning"
                                                    variant="outlined"
                                                    label={t('collectionShowSuggestion')}
                                                />
                                            )}
                                        </Box>
                                    }
                                    secondary={[candidate.premiereDate?.slice(0, 4), candidate.overview]
                                        .filter(Boolean)
                                        .join(' · ')
                                        .slice(0, 180)}
                                />
                            </ListItemButton>
                        ))}
                    </List>
                )}

                <Divider sx={{ my: 2 }} />

                <Typography variant="subtitle2" component="h3" gutterBottom>
                    {t('collectionShowManualHeading')}
                </Typography>
                <TextField
                    fullWidth
                    size="small"
                    value={manualTitle}
                    onChange={(e) => { setManualTitle(e.target.value); setSelected(null); }}
                    label={t('collectionShowManualLabel')}
                    inputProps={{ maxLength: 200 }}
                />

                <Alert severity="info" sx={{ mt: 2 }}>
                    {t('collectionShowFolderNotice').replace('{name}', proposedName)}
                </Alert>

                {error && (
                    <Alert severity="error" sx={{ mt: 2 }}>
                        {error}
                    </Alert>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={submitting}>
                    {t('cancel')}
                </Button>
                <Button
                    onClick={() => { void activate({ mode: 'collection' }); }}
                    disabled={submitting}
                >
                    {t('collectionShowUseCollectionMetadata')}
                </Button>
                <Button
                    onClick={() => {
                        if (selected) {
                            void activate({
                                mode: 'tmdb',
                                tmdbId: selected.tmdbId,
                                mediaType: selected.mediaType,
                            });
                        } else {
                            void activate({ mode: 'manual', title: manualTitle.trim() });
                        }
                    }}
                    variant="contained"
                    disabled={submitting || (!selected && !manualTitle.trim())}
                >
                    {t('collectionShowConfirm')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ShowExportDialog;
