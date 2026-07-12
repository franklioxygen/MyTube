import { Warning } from '@mui/icons-material';
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    Stack
} from '@mui/material';
import React, { useState } from 'react';
import DialogHeader from './DialogHeader';

interface DeleteCollectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onDeleteCollectionOnly: () => void | Promise<void>;
    onDeleteCollectionAndVideos: () => void | Promise<void>;
    collectionName: string;
    videoCount: number;
}

import { useLanguage } from '../contexts/LanguageContext';

const DeleteCollectionModal: React.FC<DeleteCollectionModalProps> = ({
    isOpen,
    onClose,
    onDeleteCollectionOnly,
    onDeleteCollectionAndVideos,
    collectionName,
    videoCount
}) => {
    const { t } = useLanguage();
    const [pendingAction, setPendingAction] = useState<'collection' | 'collectionAndVideos' | null>(null);

    const handleClose = () => {
        if (!pendingAction) {
            onClose();
        }
    };

    const handleDelete = async (action: 'collection' | 'collectionAndVideos') => {
        setPendingAction(action);
        try {
            await (action === 'collection' ? onDeleteCollectionOnly() : onDeleteCollectionAndVideos());
            onClose();
        } catch {
            // Keep the modal open so the action can be retried.
        } finally {
            setPendingAction(null);
        }
    };

    return (
        <Dialog
            open={isOpen}
            onClose={handleClose}
            disableEscapeKeyDown={Boolean(pendingAction)}
            maxWidth="sm"
            fullWidth
            slotProps={{
                paper: {
                    sx: { borderRadius: 2 }
                }
            }}
        >
            <DialogHeader
                title={t('deleteCollectionTitle')}
                onClose={handleClose}
                closeDisabled={Boolean(pendingAction)}
                closeLabel={t('close')}
            />
            <DialogContent dividers>
                <DialogContentText sx={{ mb: 2, color: 'text.primary' }}>
                    {t('deleteCollectionConfirmation')} <strong>"{collectionName}"</strong>?
                </DialogContentText>
                <DialogContentText sx={{ mb: 3 }}>
                    {t('collectionContains')} <strong>{videoCount}</strong> {t('videos')}.
                </DialogContentText>

                <Stack spacing={2}>
                    <Button
                        variant="outlined"
                        color="inherit"
                        onClick={() => { void handleDelete('collection'); }}
                        disabled={Boolean(pendingAction)}
                        loading={pendingAction === 'collection'}
                        loadingPosition="start"
                        fullWidth
                        sx={{ justifyContent: 'center', py: 1.5 }}
                    >
                        {t('deleteCollectionOnly')}
                    </Button>

                    {videoCount > 0 && (
                        <Button
                            variant="outlined"
                            color="error"
                            onClick={() => { void handleDelete('collectionAndVideos'); }}
                            disabled={Boolean(pendingAction)}
                            loading={pendingAction === 'collectionAndVideos'}
                            loadingPosition="start"
                            fullWidth
                            startIcon={<Warning />}
                            sx={{
                                justifyContent: 'center',
                                py: 1.5,
                                fontWeight: 600,
                                boxShadow: (theme) => `0 4px 12px ${theme.palette.error.main}40`
                            }}
                        >
                            {t('deleteCollectionAndVideos')}
                        </Button>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                <Button onClick={handleClose} color="inherit" disabled={Boolean(pendingAction)}>
                    {t('cancel')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default DeleteCollectionModal;
