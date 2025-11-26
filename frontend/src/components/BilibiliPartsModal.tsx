import { Close } from '@mui/icons-material';
import {
    Box,
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
import { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

interface BilibiliPartsModalProps {
    isOpen: boolean;
    onClose: () => void;
    videosNumber: number;
    videoTitle: string;
    onDownloadAll: (collectionName: string) => void;
    onDownloadCurrent: () => void;
    isLoading: boolean;
    type?: 'parts' | 'collection' | 'series';
}

const BilibiliPartsModal: React.FC<BilibiliPartsModalProps> = ({
    isOpen,
    onClose,
    videosNumber,
    videoTitle,
    onDownloadAll,
    onDownloadCurrent,
    isLoading,
    type = 'parts'
}) => {
    const { t } = useLanguage();
    const [collectionName, setCollectionName] = useState<string>('');

    const handleDownloadAll = () => {
        onDownloadAll(collectionName || videoTitle);
    };

    // Dynamic text based on type
    const getHeaderText = () => {
        switch (type) {
            case 'collection':
                return t('bilibiliCollectionDetected');
            case 'series':
                return t('bilibiliSeriesDetected');
            default:
                return t('multiPartVideoDetected');
        }
    };

    const getDescriptionText = () => {
        switch (type) {
            case 'collection':
                return t('collectionHasVideos', { count: videosNumber });
            case 'series':
                return t('seriesHasVideos', { count: videosNumber });
            default:
                return t('videoHasParts', { count: videosNumber });
        }
    };

    const getDownloadAllButtonText = () => {
        if (isLoading) return t('processing');

        switch (type) {
            case 'collection':
                return t('downloadAllVideos', { count: videosNumber });
            case 'series':
                return t('downloadAllVideos', { count: videosNumber });
            default:
                return t('downloadAllParts', { count: videosNumber });
        }
    };

    const getCurrentButtonText = () => {
        if (isLoading) return t('processing');

        switch (type) {
            case 'collection':
                return t('downloadThisVideoOnly');
            case 'series':
                return t('downloadThisVideoOnly');
            default:
                return t('downloadCurrentPartOnly');
        }
    };

    return (
        <Dialog
            open={isOpen}
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
                    {getHeaderText()}
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
                <DialogContentText sx={{ mb: 2 }}>
                    {getDescriptionText()}
                </DialogContentText>
                <Typography variant="body2" gutterBottom>
                    <strong>{t('title')}:</strong> {videoTitle}
                </Typography>
                <Typography variant="body1" sx={{ mt: 2, mb: 1 }}>
                    {type === 'parts' ? t('wouldYouLikeToDownloadAllParts') : t('wouldYouLikeToDownloadAllVideos')}
                </Typography>

                <Box sx={{ mt: 2 }}>
                    <TextField
                        fullWidth
                        label={t('collectionName')}
                        variant="outlined"
                        value={collectionName}
                        onChange={(e) => setCollectionName(e.target.value)}
                        placeholder={videoTitle}
                        disabled={isLoading}
                        helperText={type === 'parts' ? t('allPartsAddedToCollection') : t('allVideosAddedToCollection')}
                    />
                </Box>
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                <Button
                    onClick={onDownloadCurrent}
                    disabled={isLoading}
                    color="inherit"
                >
                    {getCurrentButtonText()}
                </Button>
                <Button
                    onClick={handleDownloadAll}
                    disabled={isLoading}
                    variant="contained"
                    color="primary"
                >
                    {getDownloadAllButtonText()}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default BilibiliPartsModal;
