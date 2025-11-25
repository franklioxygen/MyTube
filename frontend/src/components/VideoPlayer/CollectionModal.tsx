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
import { useLanguage } from '../../contexts/LanguageContext';
import { Collection } from '../../types';

interface CollectionModalProps {
    open: boolean;
    onClose: () => void;
    videoCollections: Collection[];
    collections: Collection[];
    onAddToCollection: (collectionId: string) => Promise<void>;
    onCreateCollection: (name: string) => Promise<void>;
    onRemoveFromCollection: () => void;
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
        if (!newCollectionName.trim()) return;
        await onCreateCollection(newCollectionName);
        handleClose();
    };

    const handleAdd = async () => {
        if (!selectedCollection) return;
        await onAddToCollection(selectedCollection);
        handleClose();
    };

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle>{t('addToCollection')}</DialogTitle>
            <DialogContent dividers>
                {videoCollections.length > 0 && (
                    <Alert severity="info" sx={{ mb: 3 }} action={
                        <Button color="error" size="small" onClick={() => {
                            onRemoveFromCollection();
                            handleClose();
                        }}>
                            {t('remove')}
                        </Button>
                    }>
                        {t('currentlyIn')} <strong>{videoCollections[0].name}</strong>
                        <Typography variant="caption" display="block">
                            {t('collectionWarning')}
                        </Typography>
                    </Alert>
                )}

                {collections && collections.length > 0 && (
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
                                    {collections.map(collection => (
                                        <MenuItem
                                            key={collection.id}
                                            value={collection.id}
                                            disabled={videoCollections.length > 0 && videoCollections[0].id === collection.id}
                                        >
                                            {collection.name} {videoCollections.length > 0 && videoCollections[0].id === collection.id ? t('current') : ''}
                                        </MenuItem>
                                    ))}
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
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} color="inherit">{t('cancel')}</Button>
            </DialogActions>
        </Dialog>
    );
};

export default CollectionModal;
