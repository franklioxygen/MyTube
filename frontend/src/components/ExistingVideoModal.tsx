import {
    Delete as DeleteIcon,
    Download as DownloadIcon
} from '@mui/icons-material';
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Typography
} from '@mui/material';
import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';

interface ExistingVideoInfo {
    type: 'deleted';
    title?: string;
    author?: string;
    downloadedAt?: number;
    deletedAt?: number;
}

interface ExistingVideoModalProps {
    open: boolean;
    onClose: () => void;
    videoInfo: ExistingVideoInfo | null;
    onDownloadAgain: () => void;
}

const ExistingVideoModal: React.FC<ExistingVideoModalProps> = ({
    open,
    onClose,
    videoInfo,
    onDownloadAgain
}) => {
    const { t } = useLanguage();

    if (!videoInfo) return null;

    const formatDate = (timestamp?: number) => {
        if (!timestamp) return '';
        return new Date(timestamp).toLocaleString();
    };

    const handleDownloadAgain = () => {
        onDownloadAgain();
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
            <DialogTitle sx={{ m: 0, p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <DeleteIcon color="warning" />
                <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
                    {t('previouslyDeletedVideo')}
                </Typography>
            </DialogTitle>
            <DialogContent dividers>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {/* Title and Author */}
                    <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
                            {videoInfo.title || 'Unknown Title'}
                        </Typography>
                        {videoInfo.author && (
                            <Typography variant="body2" color="text.secondary">
                                {videoInfo.author}
                            </Typography>
                        )}
                    </Box>

                    {/* Status Message */}
                    <Typography variant="body1" color="text.primary">
                        {t('videoWasDeleted')}
                    </Typography>

                    {/* Timestamps */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        {videoInfo.downloadedAt && (
                            <Typography variant="caption" color="text.secondary">
                                {t('downloadedOn')}: {formatDate(videoInfo.downloadedAt)}
                            </Typography>
                        )}
                        {videoInfo.deletedAt && (
                            <Typography variant="caption" color="text.secondary">
                                {t('deletedOn')}: {formatDate(videoInfo.deletedAt)}
                            </Typography>
                        )}
                    </Box>
                </Box>
            </DialogContent>
            <DialogActions sx={{ p: 2, gap: 1 }}>
                <Button onClick={onClose} color="inherit">
                    {t('cancel')}
                </Button>
                <Button
                    onClick={handleDownloadAgain}
                    variant="contained"
                    color="primary"
                    startIcon={<DownloadIcon />}
                    autoFocus
                >
                    {t('downloadAgain')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ExistingVideoModal;

