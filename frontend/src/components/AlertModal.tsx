import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Typography
} from '@mui/material';
import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';

interface AlertModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    message: string;
}

const AlertModal: React.FC<AlertModalProps> = ({ open, onClose, title, message }) => {
    const { t } = useLanguage();

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="xs"
            fullWidth
            slotProps={{
                paper: {
                    sx: { borderRadius: 2 }
                }
            }}
        >
            <DialogTitle sx={{ m: 0, p: 2 }}>
                <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
                    {title}
                </Typography>
            </DialogTitle>
            <DialogContent dividers>
                <DialogContentText sx={{ color: 'text.primary' }}>
                    {message}
                </DialogContentText>
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                <Button onClick={onClose} variant="contained" color="primary" autoFocus>
                    {t('confirm')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default AlertModal;
