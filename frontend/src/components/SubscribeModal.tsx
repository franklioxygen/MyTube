import { Close } from '@mui/icons-material';
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    IconButton,
    TextField,
    Typography
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

interface SubscribeModalProps {
    open: boolean;
    onClose: () => void;
    onConfirm: (interval: number) => void;
    authorName?: string;
    url: string;
}

const SubscribeModal: React.FC<SubscribeModalProps> = ({
    open,
    onClose,
    onConfirm,
    authorName,
    url
}) => {
    const { t } = useLanguage();
    const [interval, setInterval] = useState<number>(60); // Default 60 minutes

    const handleConfirm = () => {
        onConfirm(interval);
        onClose();
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            slotProps={{
                paper: {
                    sx: { borderRadius: 2 }
                }
            }}
        >
            <DialogTitle sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
                    {t('subscribeToAuthor')}
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
                    {t('subscribeConfirmationMessage', { author: authorName || url })}
                </DialogContentText>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    {t('subscribeDescription')}
                </Typography>
                <TextField
                    autoFocus
                    margin="dense"
                    id="interval"
                    label={t('checkIntervalMinutes')}
                    type="number"
                    fullWidth
                    variant="outlined"
                    value={interval}
                    onChange={(e) => setInterval(Number(e.target.value))}
                    inputProps={{ min: 1 }}
                />
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                <Button onClick={onClose} color="inherit">
                    {t('cancel')}
                </Button>
                <Button onClick={handleConfirm} variant="contained" color="primary">
                    {t('subscribe')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default SubscribeModal;
