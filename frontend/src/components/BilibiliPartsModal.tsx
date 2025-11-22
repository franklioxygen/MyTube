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
    const [collectionName, setCollectionName] = useState<string>('');

    const handleDownloadAll = () => {
        onDownloadAll(collectionName || videoTitle);
    };

    // Dynamic text based on type
    const getHeaderText = () => {
        switch (type) {
            case 'collection':
                return 'Bilibili Collection Detected';
            case 'series':
                return 'Bilibili Series Detected';
            default:
                return 'Multi-part Video Detected';
        }
    };

    const getDescriptionText = () => {
        switch (type) {
            case 'collection':
                return `This Bilibili collection has ${videosNumber} videos.`;
            case 'series':
                return `This Bilibili series has ${videosNumber} videos.`;
            default:
                return `This Bilibili video has ${videosNumber} parts.`;
        }
    };

    const getDownloadAllButtonText = () => {
        if (isLoading) return 'Processing...';

        switch (type) {
            case 'collection':
                return `Download All ${videosNumber} Videos`;
            case 'series':
                return `Download All ${videosNumber} Videos`;
            default:
                return `Download All ${videosNumber} Parts`;
        }
    };

    const getCurrentButtonText = () => {
        if (isLoading) return 'Processing...';

        switch (type) {
            case 'collection':
                return 'Download This Video Only';
            case 'series':
                return 'Download This Video Only';
            default:
                return 'Download Current Part Only';
        }
    };

    return (
        <Dialog
            open={isOpen}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            PaperProps={{
                sx: { borderRadius: 2 }
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
                    <strong>Title:</strong> {videoTitle}
                </Typography>
                <Typography variant="body1" sx={{ mt: 2, mb: 1 }}>
                    Would you like to download all {type === 'parts' ? 'parts' : 'videos'}?
                </Typography>

                <Box sx={{ mt: 2 }}>
                    <TextField
                        fullWidth
                        label="Collection Name"
                        variant="outlined"
                        value={collectionName}
                        onChange={(e) => setCollectionName(e.target.value)}
                        placeholder={videoTitle}
                        disabled={isLoading}
                        helperText={`All ${type === 'parts' ? 'parts' : 'videos'} will be added to this collection`}
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
