import { Close, Warning } from '@mui/icons-material';
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    IconButton,
    Stack,
    Typography
} from '@mui/material';
import React from 'react';

interface DeleteCollectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onDeleteCollectionOnly: () => void;
    onDeleteCollectionAndVideos: () => void;
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
    return (
        <Dialog
            open={isOpen}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            PaperProps={{
                sx: { borderRadius: 2 }
            }}
        >
            <DialogTitle sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
                    {t('deleteCollectionTitle')}
                </Typography>
                <IconButton
                    aria-label="close"
                    onClick={onClose}
                    sx={{
                        color: (theme) => theme.palette.grey[500],
                    }}
                >
                    <Close />
                </IconButton>
            </DialogTitle>
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
                        onClick={onDeleteCollectionOnly}
                        fullWidth
                        sx={{ justifyContent: 'center', py: 1.5 }}
                    >
                        {t('deleteCollectionOnly')}
                    </Button>

                    {videoCount > 0 && (
                        <Button
                            variant="outlined"
                            color="error"
                            onClick={onDeleteCollectionAndVideos}
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
                <Button onClick={onClose} color="inherit">
                    {t('cancel')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default DeleteCollectionModal;
