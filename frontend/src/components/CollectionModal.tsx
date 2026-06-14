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
    onRemoveFromCollection?: (collectionId: string) => void;
}

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

    const handleClose = () => {
        setNewCollectionName('');
        setSelectedCollection('');
        onClose();
    };

    const handleCreate = async () => {
        if (!newCollectionName.trim() || !onCreateCollection) return;
        await onCreateCollection(newCollectionName);
        handleClose();
    };

    const handleAdd = async () => {
        if (!selectedCollection || !onAddToCollection) return;
        await onAddToCollection(selectedCollection);
        handleClose();
    };

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle>{t('addToCollection')}</DialogTitle>
            <DialogContent dividers>
                {videoCollections && videoCollections.length > 0 && onRemoveFromCollection && (
                    <Stack spacing={1.5} sx={{ mb: 3 }}>
                        {videoCollections.map((collection) => (
                            <Alert
                                key={collection.id}
                                severity="info"
                                action={
                                    <Button color="error" size="small" onClick={() => {
                                        onRemoveFromCollection(collection.id);
                                        handleClose();
                                    }}>
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
                                onClick={handleAdd}
                                disabled={!selectedCollection}
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
                                onKeyPress={(e) => e.key === 'Enter' && newCollectionName.trim() && handleCreate()}
                            />
                            <Button
                                variant="contained"
                                onClick={handleCreate}
                                disabled={!newCollectionName.trim()}
                            >
                                {t('create')}
                            </Button>
                        </Stack>
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} color="inherit">{t('cancel')}</Button>
            </DialogActions>
        </Dialog>
    );
};

export default CollectionModal;
