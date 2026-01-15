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

interface ChannelSubscribeChoiceModalProps {
    open: boolean;
    onClose: () => void;
    onChooseVideos: () => void;
    onChoosePlaylists: (interval: number, downloadAllPrevious?: boolean) => void;
}

const ChannelSubscribeChoiceModal: React.FC<ChannelSubscribeChoiceModalProps> = ({
    open,
    onClose,
    onChooseVideos,
    onChoosePlaylists
}) => {
    const { t } = useLanguage();
    const [interval, setInterval] = useState<number>(60);
    const [downloadAllPrevious, setDownloadAllPrevious] = useState<boolean>(false);

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
                    {t('subscribeToChannel') || 'Subscribe to Channel'}
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
                <DialogContentText sx={{ mb: 3, color: 'text.primary' }}>
                    {t('subscribeChannelChoiceMessage') || 'How would you like to subscribe to this channel?'}
                </DialogContentText>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('subscribeChannelChoiceDescription') || 'Choose to subscribe to all videos or all playlists from this channel.'}
                </Typography>
                <TextField
                    autoFocus
                    margin="dense"
                    id="interval"
                    label={t('checkIntervalMinutes') || "Check Interval (minutes)"}
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
                    label={t('downloadAllPreviousVideosInPlaylists') || "Download previous videos in playlists"}
                />
                {downloadAllPrevious && (
                    <Alert
                        severity="warning"
                        icon={<Warning />}
                        sx={{ mt: 2 }}
                    >
                        <Typography variant="body2" component="div">
                            {t('downloadAllPlaylistsWarning') || "This will download all videos from all playlists on this channel. This may be a large number of videos."}
                        </Typography>
                    </Alert>
                )}
            </DialogContent>
            <DialogActions sx={{ p: 2, gap: 1, flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'flex-end' }}>
                <Button onClick={onClose} color="inherit" variant="outlined" sx={{ width: { xs: '100%', sm: 'auto' } }}>
                    {t('cancel')}
                </Button>
                <Button
                    onClick={() => {
                        onChoosePlaylists(interval, downloadAllPrevious);
                        onClose();
                    }}
                    variant="contained"
                    color="primary"
                    sx={{ width: { xs: '100%', sm: 'auto' } }}
                >
                    {t('subscribeAllPlaylists') || 'Subscribe All Playlists'}
                </Button>
                <Button
                    onClick={() => {
                        onChooseVideos();
                        onClose();
                    }}
                    variant="contained"
                    color="primary"
                    sx={{ width: { xs: '100%', sm: 'auto' } }}
                >
                    {t('subscribeAllVideos') || 'Subscribe All Videos'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ChannelSubscribeChoiceModal;
