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
    onConfirm: (urls: string[]) => void | Promise<void>;
}

const BatchDownloadModal: React.FC<BatchDownloadModalProps> = ({ open, onClose, onConfirm }) => {
    const { t } = useLanguage();
    const [text, setText] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleConfirm = async () => {
        const urls = text
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        setIsSubmitting(true);
        try {
            await onConfirm(urls);
            setText('');
            onClose();
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClose = () => {
        if (isSubmitting) return;
        setText('');
        onClose();
    };

    return (
        <Dialog open={open} onClose={handleClose} disableEscapeKeyDown={isSubmitting} maxWidth="sm" fullWidth>
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
                    disabled={isSubmitting}
                    placeholder="https://www.youtube.com/watch?v=...\nhttps://www.bilibili.com/video/..."
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} disabled={isSubmitting}>{t('cancel') || 'Cancel'}</Button>
                <Button
                    onClick={() => { void handleConfirm(); }}
                    variant="contained"
                    disabled={!text.trim()}
                    loading={isSubmitting}
                    loadingPosition="start"
                >
                    {t('addToQueue') || 'Add to Queue'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default BatchDownloadModal;
