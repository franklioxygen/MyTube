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
    MenuItem,
    Select,
    FormControl,
    InputLabel,
    TextField,
    Typography
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

type DownloadOrder = 'dateDesc' | 'dateAsc' | 'viewsDesc' | 'viewsAsc';

interface SubscribeModalProps {
    open: boolean;
    onClose: () => void;
    onConfirm: (interval: number, downloadAllPrevious: boolean, downloadShorts: boolean, downloadOrder: DownloadOrder) => void;
    authorName?: string;
    url: string;
    source?: string;
    title?: string;
    description?: string;
    enableDownloadOrder?: boolean;
}

const SubscribeModal: React.FC<SubscribeModalProps> = ({
    open,
    onClose,
    onConfirm,
    authorName,
    url,
    source,
    title,
    description,
    enableDownloadOrder = true,
}) => {
    const { t } = useLanguage();
    const [interval, setInterval] = useState<number>(60); // Default 60 minutes
    const [downloadAllPrevious, setDownloadAllPrevious] = useState<boolean>(false);
    const [downloadShorts, setDownloadShorts] = useState<boolean>(false);
    const [downloadOrder, setDownloadOrder] = useState<DownloadOrder>('dateDesc');

    const handleConfirm = () => {
        onConfirm(interval, downloadAllPrevious, downloadShorts, downloadOrder);
        onClose();
    };

    const showOrderDropdown = downloadAllPrevious && enableDownloadOrder;

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
                    slotProps={{ htmlInput: { min: 1 } }}
                    sx={{ mb: 2 }}
                />
                {source !== 'bilibili' && (
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={downloadShorts}
                                onChange={(e) => setDownloadShorts(e.target.checked)}
                            />
                        }
                        label={t('downloadShorts') || "Download Shorts"}
                    />
                )}
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={downloadAllPrevious}
                            onChange={(e) => setDownloadAllPrevious(e.target.checked)}
                        />
                    }
                    label={t('downloadAllPreviousVideos')}
                />
                {showOrderDropdown && (
                    <FormControl fullWidth sx={{ mt: 2 }}>
                        <InputLabel id="download-order-label">{t('downloadOrder') || 'Download Order'}</InputLabel>
                        <Select
                            labelId="download-order-label"
                            value={downloadOrder}
                            label={t('downloadOrder') || 'Download Order'}
                            onChange={(e) => setDownloadOrder(e.target.value as DownloadOrder)}
                        >
                            <MenuItem value="dateDesc">{t('downloadOrderDateDesc') || 'Date (Newest First)'}</MenuItem>
                            <MenuItem value="dateAsc">{t('downloadOrderDateAsc') || 'Date (Oldest First)'}</MenuItem>
                            <MenuItem value="viewsDesc">{t('downloadOrderViewsDesc') || 'Views (Most First)'}</MenuItem>
                            <MenuItem value="viewsAsc">{t('downloadOrderViewsAsc') || 'Views (Least First)'}</MenuItem>
                        </Select>
                    </FormControl>
                )}
                {downloadAllPrevious && (
                    <Alert
                        severity="warning"
                        icon={<Warning />}
                        sx={{ mt: 2 }}
                    >
                        <Typography variant="body2" component="div">
                            {t('downloadAllPreviousWarning')}
                        </Typography>
                        {enableDownloadOrder && (
                            <Typography variant="body2" component="div" sx={{ mt: 0.5 }}>
                                {t('downloadOrderLargeChannelHint') || 'Large channels may take longer to fetch metadata before downloading begins.'}
                            </Typography>
                        )}
                        {downloadShorts && (
                            <Typography variant="body2" component="div" sx={{ mt: 0.5 }}>
                                {t('downloadOrderShortsHint') || 'Two download tasks will be created: one for main videos and one for Shorts.'}
                            </Typography>
                        )}
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
