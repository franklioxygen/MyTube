import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText
} from '@mui/material';
import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import DialogHeader from './DialogHeader';

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
            <DialogHeader title={title} />
            <DialogContent dividers>
                <DialogContentText
                    sx={{
                        color: 'text.primary',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                    }}
                >
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
