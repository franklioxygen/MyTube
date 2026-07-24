import { Warning } from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    FormControlLabel,
    MenuItem,
    Select,
    FormControl,
    InputLabel,
    TextField,
    Typography
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import DialogHeader from './DialogHeader';
import SubscriptionFilenameTemplateField from './SubscriptionFilenameTemplateField';

type DownloadOrder = 'dateDesc' | 'dateAsc' | 'viewsDesc' | 'viewsAsc';

export interface SubscribeFormValues {
    interval: number;
    downloadAllPrevious: boolean;
    downloadShorts: boolean;
    downloadOrder: DownloadOrder;
    filenameTemplate: string | null;
}

interface SubscribeModalProps {
    open: boolean;
    onClose: () => void;
    onConfirm: (values: SubscribeFormValues) => void | Promise<void>;
    authorName?: string;
    url: string;
    source?: string;
    title?: string;
    description?: string;
    enableDownloadOrder?: boolean;
    /** When true the modal is creating channel-playlists subscriptions; the
     *  template field validates as "playlist". */
    playlistMode?: boolean;
    /**
     * Optional playlist-specific overrides for the "download previous" checkbox
     * (design §10.4). When supplied they replace the author-oriented default
     * copy so the channel "subscribe to all playlists" dialog reads correctly.
     */
    downloadPreviousLabel?: string;
    downloadPreviousHelp?: string;
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
    playlistMode = false,
    downloadPreviousLabel,
    downloadPreviousHelp,
}) => {
    const { t } = useLanguage();
    const [interval, setInterval] = useState<number>(60); // Default 60 minutes
    const [downloadAllPrevious, setDownloadAllPrevious] = useState<boolean>(false);
    const [downloadShorts, setDownloadShorts] = useState<boolean>(false);
    const [downloadOrder, setDownloadOrder] = useState<DownloadOrder>('dateDesc');
    const [filenameTemplate, setFilenameTemplate] = useState<string>('');
    const [isTemplateValid, setIsTemplateValid] = useState<boolean>(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const isTwitch = source === 'twitch';
    const showDownloadShorts = source !== 'bilibili' && source !== 'twitch';
    const resolvedTitle =
        title || (isTwitch ? (t('subscribeToChannel') || 'Subscribe to Channel') : t('subscribeToAuthor'));
    const resolvedDescription =
        description || (
            isTwitch
                ? t('twitchSubscriptionDescription')
                : t('subscribeConfirmationMessage', { author: authorName || url })
        );
    const resolvedHelpText = isTwitch
        ? t('twitchSubscriptionVodsOnly')
        : t('subscribeDescription');

    const handleClose = () => {
        if (!isSubmitting) {
            onClose();
        }
    };

    const handleConfirm = async () => {
        setIsSubmitting(true);
        try {
            await onConfirm({
                interval,
                downloadAllPrevious,
                downloadShorts,
                downloadOrder,
                filenameTemplate: filenameTemplate.trim() || null,
            });
            onClose();
        } catch {
            // Keep the modal open so the action can be retried.
        } finally {
            setIsSubmitting(false);
        }
    };

    const showOrderDropdown = downloadAllPrevious && enableDownloadOrder;
    const canSubmit = isTemplateValid;

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            disableEscapeKeyDown={isSubmitting}
            maxWidth="sm"
            fullWidth
            slotProps={{
                paper: {
                    sx: { borderRadius: 2 }
                }
            }}
        >
            <DialogHeader title={resolvedTitle} onClose={handleClose} closeDisabled={isSubmitting} closeLabel={t('close')} />
            <DialogContent dividers>
                <DialogContentText sx={{ mb: 2, color: 'text.primary' }}>
                    {resolvedDescription}
                </DialogContentText>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    {resolvedHelpText}
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
                    disabled={isSubmitting}
                    sx={{ mb: 2 }}
                />
                {showDownloadShorts && (
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={downloadShorts}
                                onChange={(e) => setDownloadShorts(e.target.checked)}
                                disabled={isSubmitting}
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
                            disabled={isSubmitting}
                        />
                    }
                    label={downloadPreviousLabel || t('downloadAllPreviousVideos')}
                />
                {downloadAllPrevious && downloadPreviousHelp && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, ml: 4 }}>
                        {downloadPreviousHelp}
                    </Typography>
                )}
                {showOrderDropdown && (
                    <FormControl fullWidth sx={{ mt: 2 }}>
                        <InputLabel id="download-order-label">{t('downloadOrder') || 'Download Order'}</InputLabel>
                        <Select
                            labelId="download-order-label"
                            value={downloadOrder}
                            label={t('downloadOrder') || 'Download Order'}
                            onChange={(e) => setDownloadOrder(e.target.value as DownloadOrder)}
                            disabled={isSubmitting}
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
                        {downloadShorts && showDownloadShorts && (
                            <Typography variant="body2" component="div" sx={{ mt: 0.5 }}>
                                {t('downloadOrderShortsHint') || 'Two download tasks will be created: one for main videos and one for Shorts.'}
                            </Typography>
                        )}
                    </Alert>
                )}
                <Box sx={{ mt: 2 }}>
                    <SubscriptionFilenameTemplateField
                        value={filenameTemplate}
                        onChange={setFilenameTemplate}
                        sourceCollectionType={playlistMode ? 'playlist' : 'channel'}
                        disabled={isSubmitting}
                        onValidityChange={setIsTemplateValid}
                    />
                </Box>
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                <Button onClick={handleClose} color="inherit" disabled={isSubmitting}>
                    {t('cancel')}
                </Button>
                <Button
                    onClick={() => { void handleConfirm(); }}
                    variant="contained"
                    color="primary"
                    disabled={!canSubmit || isSubmitting}
                    loading={isSubmitting}
                    loadingPosition="start"
                >
                    {t('subscribe')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default SubscribeModal;
