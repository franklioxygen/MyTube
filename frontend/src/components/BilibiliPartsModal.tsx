import { Close } from '@mui/icons-material';
import {
    Box,
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
import { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

interface BilibiliPartsModalProps {
    isOpen: boolean;
    onClose: () => void;
    videosNumber: number;
    videoTitle: string;
    onDownloadAll: (collectionName: string, subscribeInfo?: { interval: number }) => void;
    onDownloadCurrent: () => void;
    isLoading: boolean;
    type?: 'parts' | 'collection' | 'series' | 'playlist';
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
    const [subscribeToPlaylist, setSubscribeToPlaylist] = useState<boolean>(false);
    const [subscriptionInterval, setSubscriptionInterval] = useState<number>(60);

    const handleDownloadAll = () => {
        const subscribeInfo = subscribeToPlaylist ? { interval: subscriptionInterval } : undefined;
        onDownloadAll(collectionName || videoTitle, subscribeInfo);
    };

    // Reset state when modal closes
    const handleClose = () => {
        setSubscribeToPlaylist(false);
        setSubscriptionInterval(60);
        onClose();
    };

    // Dynamic text based on type
    const getHeaderText = () => {
        switch (type) {
            case 'collection':
                return t('bilibiliCollectionDetected');
            case 'series':
                return t('bilibiliSeriesDetected');
            case 'playlist':
                return t('playlistDetected');
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
            case 'playlist':
                return t('playlistHasVideos', { count: videosNumber });
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
            case 'playlist':
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
            case 'playlist':
                return t('downloadThisVideoOnly');
            default:
                return t('downloadCurrentPartOnly');
        }
    };

    return (
        <Dialog
            open={isOpen}
            onClose={handleClose}
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
                    onClick={handleClose}
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
                    {type === 'parts' ? t('wouldYouLikeToDownloadAllParts') : type === 'playlist' ? t('downloadPlaylistAndCreateCollection') : t('wouldYouLikeToDownloadAllVideos')}
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
                        helperText={type === 'parts' ? t('allPartsAddedToCollection') : type === 'playlist' ? t('allVideosAddedToCollection') : t('allVideosAddedToCollection')}
                    />
                </Box>

                {/* Subscription option - show for playlist, collection, and series types */}
                {(type === 'playlist' || type === 'collection' || type === 'series') && (
                    <Box sx={{ mt: 3 }}>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={subscribeToPlaylist}
                                    onChange={(e) => setSubscribeToPlaylist(e.target.checked)}
                                    disabled={isLoading}
                                />
                            }
                            label={t('subscribeToPlaylist')}
                        />
                        {subscribeToPlaylist && (
                            <Box sx={{ mt: 2, ml: 4 }}>
                                <TextField
                                    type="number"
                                    label={t('checkIntervalMinutes')}
                                    value={subscriptionInterval}
                                    onChange={(e) => setSubscriptionInterval(Math.max(1, parseInt(e.target.value) || 60))}
                                    disabled={isLoading}
                                    size="small"
                                    slotProps={{ htmlInput: { min: 1 } }}
                                    helperText={t('subscribePlaylistDescription')}
                                    sx={{ width: 200 }}
                                />
                            </Box>
                        )}
                    </Box>
                )}
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                <Button
                    onClick={() => {
                        handleClose();
                        onDownloadCurrent();
                    }}
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
                    {subscribeToPlaylist && (type === 'playlist' || type === 'collection' || type === 'series')
                        ? t('downloadAndSubscribe') 
                        : getDownloadAllButtonText()}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default BilibiliPartsModal;
