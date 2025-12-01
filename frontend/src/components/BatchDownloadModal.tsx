import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    TextField
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

interface BatchDownloadModalProps {
    open: boolean;
    onClose: () => void;
    onConfirm: (urls: string[]) => void;
}

const BatchDownloadModal: React.FC<BatchDownloadModalProps> = ({ open, onClose, onConfirm }) => {
    const { t } = useLanguage();
    const [text, setText] = useState('');

    const handleConfirm = () => {
        const urls = text
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        onConfirm(urls);
        setText('');
        onClose();
    };

    const handleClose = () => {
        setText('');
        onClose();
    };

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle>{t('batchDownload') || 'Batch Download'}</DialogTitle>
            <DialogContent>
                <DialogContentText sx={{ mb: 2 }}>
                    {t('batchDownloadDescription') || 'Paste multiple URLs below, one per line.'}
                </DialogContentText>
                <TextField
                    autoFocus
                    margin="dense"
                    id="urls"
                    label={t('urls') || 'URLs'}
                    type="text"
                    fullWidth
                    multiline
                    rows={10}
                    variant="outlined"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=...\nhttps://www.bilibili.com/video/..."
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose}>{t('cancel') || 'Cancel'}</Button>
                <Button onClick={handleConfirm} variant="contained" disabled={!text.trim()}>
                    {t('addToQueue') || 'Add to Queue'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default BatchDownloadModal;
