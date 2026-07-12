import {
    Alert,
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    TextField,
    Typography
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Collection } from '../types';

interface CollectionModalProps {
    open: boolean;
    onClose: () => void;
    videoCollections?: Collection[];
    collections?: Collection[];
    onAddToCollection?: (collectionId: string) => Promise<void>;
    onCreateCollection?: (name: string) => Promise<void>;
    onRemoveFromCollection?: (collectionId: string) => void | Promise<void>;
}

type PendingAction = 'add' | 'create' | `remove:${string}` | null;

const CollectionModal: React.FC<CollectionModalProps> = ({
    open,
    onClose,
    videoCollections,
    collections,
    onAddToCollection,
    onCreateCollection,
    onRemoveFromCollection
}) => {
    const { t } = useLanguage();
    const [newCollectionName, setNewCollectionName] = useState<string>('');
    const [selectedCollection, setSelectedCollection] = useState<string>('');
    const [pendingAction, setPendingAction] = useState<PendingAction>(null);

    const handleClose = () => {
        if (pendingAction) return;
        setNewCollectionName('');
        setSelectedCollection('');
        onClose();
    };

    const handleCreate = async () => {
        if (!newCollectionName.trim() || !onCreateCollection) return;
        setPendingAction('create');
        try {
            await onCreateCollection(newCollectionName);
            setNewCollectionName('');
            setSelectedCollection('');
            onClose();
        } catch {
            // Keep the modal open so the action can be retried.
        } finally {
            setPendingAction(null);
        }
    };

    const handleAdd = async () => {
        if (!selectedCollection || !onAddToCollection) return;
        setPendingAction('add');
        try {
            await onAddToCollection(selectedCollection);
            setNewCollectionName('');
            setSelectedCollection('');
            onClose();
        } catch {
            // Keep the modal open so the action can be retried.
        } finally {
            setPendingAction(null);
        }
    };

    const handleRemove = async (collectionId: string) => {
        if (!onRemoveFromCollection) return;
        setPendingAction(`remove:${collectionId}`);
        try {
            await onRemoveFromCollection(collectionId);
            setNewCollectionName('');
            setSelectedCollection('');
            onClose();
        } catch {
            // Keep the modal open so the action can be retried.
        } finally {
            setPendingAction(null);
        }
    };

    return (
        <Dialog open={open} onClose={handleClose} disableEscapeKeyDown={Boolean(pendingAction)} maxWidth="sm" fullWidth>
            <DialogTitle>{t('addToCollection')}</DialogTitle>
            <DialogContent dividers>
                {videoCollections && videoCollections.length > 0 && onRemoveFromCollection && (
                    <Stack spacing={1.5} sx={{ mb: 3 }}>
                        {videoCollections.map((collection) => (
                            <Alert
                                key={collection.id}
                                severity="info"
                                action={
                                    <Button
                                        color="error"
                                        size="small"
                                        onClick={() => { void handleRemove(collection.id); }}
                                        disabled={Boolean(pendingAction)}
                                        loading={pendingAction === `remove:${collection.id}`}
                                        loadingPosition="start"
                                    >
                                        {t('remove')}
                                    </Button>
                                }
                            >
                                {t('currentlyIn')} <strong>{collection.name}</strong>
                                <Typography variant="caption" display="block">
                                    {t('collectionWarning')}
                                </Typography>
                            </Alert>
                        ))}
                    </Stack>
                )}

                {collections && collections.length > 0 && onAddToCollection && (
                    <Box sx={{ mb: 4 }}>
                        <Typography variant="subtitle2" gutterBottom>{t('addToExistingCollection')}</Typography>
                        <Stack direction="row" spacing={2}>
                            <FormControl fullWidth size="small">
                                <InputLabel>{t('selectCollection')}</InputLabel>
                                <Select
                                    value={selectedCollection}
                                    label={t('selectCollection')}
                                    onChange={(e) => setSelectedCollection(e.target.value)}
                                    disabled={Boolean(pendingAction)}
                                >
                                    {collections.map(collection => {
                                        const isCurrentCollection = videoCollections?.some(
                                            (videoCollection) => videoCollection.id === collection.id
                                        ) || false;

                                        return (
                                        <MenuItem
                                            key={collection.id}
                                            value={collection.id}
                                            disabled={isCurrentCollection}
                                        >
                                            {collection.name} {isCurrentCollection ? t('current') : ''}
                                        </MenuItem>
                                        );
                                    })}
                                </Select>
                            </FormControl>
                            <Button
                                variant="contained"
                                onClick={() => { void handleAdd(); }}
                                disabled={!selectedCollection || Boolean(pendingAction)}
                                loading={pendingAction === 'add'}
                                loadingPosition="start"
                            >
                                {t('add')}
                            </Button>
                        </Stack>
                    </Box>
                )}

                {onCreateCollection && (
                    <Box>
                        <Typography variant="subtitle2" gutterBottom>{t('createNewCollection')}</Typography>
                        <Stack direction="row" spacing={2}>
                            <TextField
                                fullWidth
                                size="small"
                                label={t('collectionName')}
                                value={newCollectionName}
                                onChange={(e) => setNewCollectionName(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && newCollectionName.trim() && !pendingAction && void handleCreate()}
                                disabled={Boolean(pendingAction)}
                            />
                            <Button
                                variant="contained"
                                onClick={() => { void handleCreate(); }}
                                disabled={!newCollectionName.trim() || Boolean(pendingAction)}
                                loading={pendingAction === 'create'}
                                loadingPosition="start"
                            >
                                {t('create')}
                            </Button>
                        </Stack>
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} color="inherit" disabled={Boolean(pendingAction)}>{t('cancel')}</Button>
            </DialogActions>
        </Dialog>
    );
};

export default CollectionModal;
