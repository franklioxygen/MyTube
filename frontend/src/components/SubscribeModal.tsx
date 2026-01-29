import { Close, Warning } from '@mui/icons-material';
import {
    Alert,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControlLabel,
    IconButton,
    TextField,
    Typography
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

interface SubscribeModalProps {
    open: boolean;
    onClose: () => void;
    onConfirm: (interval: number, downloadAllPrevious: boolean) => void;
    authorName?: string;
    url: string;
    title?: string;
    description?: string;
}

const SubscribeModal: React.FC<SubscribeModalProps> = ({
    open,
    onClose,
    onConfirm,
    authorName,
    url,
    title,
    description
}) => {
    const { t } = useLanguage();
    const [interval, setInterval] = useState<number>(60); // Default 60 minutes
    const [downloadAllPrevious, setDownloadAllPrevious] = useState<boolean>(false);

    const handleConfirm = () => {
        onConfirm(interval, downloadAllPrevious);
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
                    {title || t('subscribeToAuthor')}
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
                    {description || t('subscribeConfirmationMessage', { author: authorName || url })}
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
                    sx={{ mb: 2 }}
                />
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={downloadAllPrevious}
                            onChange={(e) => setDownloadAllPrevious(e.target.checked)}
                        />
                    }
                    label={t('downloadAllPreviousVideos')}
                />
                {downloadAllPrevious && (
                    <Alert
                        severity="warning"
                        icon={<Warning />}
                        sx={{ mt: 2 }}
                    >
                        <Typography variant="body2" component="div">
                            {t('downloadAllPreviousWarning')}
                        </Typography>
                    </Alert>
                )}
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
