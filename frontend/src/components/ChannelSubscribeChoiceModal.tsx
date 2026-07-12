import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    Typography
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import DialogHeader from './DialogHeader';

interface ChannelSubscribeChoiceModalProps {
    open: boolean;
    onClose: () => void;
    onChooseVideos: () => void | Promise<void>;
    onChoosePlaylists: () => void | Promise<void>;
}

const ChannelSubscribeChoiceModal: React.FC<ChannelSubscribeChoiceModalProps> = ({
    open,
    onClose,
    onChooseVideos,
    onChoosePlaylists
}) => {
    const { t } = useLanguage();
    const [pendingAction, setPendingAction] = useState<'playlists' | 'videos' | null>(null);

    const handleClose = () => {
        if (!pendingAction) {
            onClose();
        }
    };

    const handleChoose = async (action: 'playlists' | 'videos') => {
        setPendingAction(action);
        try {
            await (action === 'playlists' ? onChoosePlaylists() : onChooseVideos());
            onClose();
        } catch {
            // Keep the modal open so the action can be retried.
        } finally {
            setPendingAction(null);
        }
    };

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            disableEscapeKeyDown={Boolean(pendingAction)}
            maxWidth="sm"
            fullWidth
            slotProps={{
                paper: {
                    sx: { borderRadius: 2 }
                }
            }}
        >
            <DialogHeader
                title={t('subscribeToChannel') || 'Subscribe to Channel'}
                onClose={handleClose}
                closeDisabled={Boolean(pendingAction)}
                closeLabel={t('close')}
            />
            <DialogContent dividers>
                <DialogContentText sx={{ mb: 3, color: 'text.primary' }}>
                    {t('subscribeChannelChoiceMessage') || 'How would you like to subscribe to this channel?'}
                </DialogContentText>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('subscribeChannelChoiceDescription') || 'Choose to subscribe to all videos or all playlists from this channel.'}
                </Typography>
            </DialogContent>
            <DialogActions sx={{ p: 2, gap: 1, flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'flex-end' }}>
                <Button onClick={handleClose} color="inherit" variant="outlined" disabled={Boolean(pendingAction)} sx={{ width: { xs: '100%', sm: 'auto' } }}>
                    {t('cancel')}
                </Button>
                <Button
                    onClick={() => { void handleChoose('playlists'); }}
                    variant="contained"
                    color="primary"
                    disabled={Boolean(pendingAction)}
                    loading={pendingAction === 'playlists'}
                    loadingPosition="start"
                    sx={{ width: { xs: '100%', sm: 'auto' } }}
                >
                    {t('subscribeAllPlaylists') || 'Subscribe All Playlists'}
                </Button>
                <Button
                    onClick={() => { void handleChoose('videos'); }}
                    variant="contained"
                    color="primary"
                    disabled={Boolean(pendingAction)}
                    loading={pendingAction === 'videos'}
                    loadingPosition="start"
                    sx={{ width: { xs: '100%', sm: 'auto' } }}
                >
                    {t('subscribeAllVideos') || 'Subscribe All Videos'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ChannelSubscribeChoiceModal;
