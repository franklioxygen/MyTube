import {
    Box,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    FormControlLabel,
    TextField,
    Typography
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import DialogHeader from './DialogHeader';
import SubscriptionFilenameTemplateField from './SubscriptionFilenameTemplateField';

/**
 * Structured modal action (design §10.1). Replaces the previous
 * `(collectionName, subscribeInfo?)` callback so subscribe-only and the
 * companion filename-template feature can share one callback shape without
 * boolean/positional ambiguity.
 */
export interface PlaylistSubscribeInfo {
    interval: number;
    downloadAll: boolean;
    filenameTemplate: string | null;
}

export interface PlaylistDialogAction {
    collectionName: string;
    subscribe?: PlaylistSubscribeInfo;
}

interface BilibiliPartsModalProps {
    isOpen: boolean;
    onClose: () => void;
    videosNumber: number;
    videoTitle: string;
    /** Structured confirm callback (design §10.1). */
    onConfirm: (action: PlaylistDialogAction) => void | Promise<void>;
    onDownloadCurrent: () => void;
    isLoading: boolean;
    type?: 'parts' | 'collection' | 'series' | 'playlist';
}

const isSubscribableType = (type: string) =>
    type === 'playlist' || type === 'collection' || type === 'series';

const BilibiliPartsModal: React.FC<BilibiliPartsModalProps> = ({
    isOpen,
    onClose,
    videosNumber,
    videoTitle,
    onConfirm,
    onDownloadCurrent,
    isLoading,
    type = 'parts'
}) => {
    const { t } = useLanguage();
    const [collectionName, setCollectionName] = useState<string>('');
    const [subscribeToPlaylist, setSubscribeToPlaylist] = useState<boolean>(false);
    // Keep the raw interval string so invalid input doesn't get coerced to 60
    // on every keystroke (design §10.2). Submit stays disabled until valid.
    const [intervalInput, setIntervalInput] = useState<string>('60');
    // Historical opt-in. Off by default every time a new source opens; do not
    // persist globally because that makes a high-volume action sticky.
    const [downloadExistingVideos, setDownloadExistingVideos] = useState<boolean>(false);
    // The surrounding download context does not own a loading state for a
    // playlist subscription request. Keep the dialog locked until its async
    // callback settles so users cannot close it or submit a second action.
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [filenameTemplate, setFilenameTemplate] = useState<string>('');
    const [isTemplateValid, setIsTemplateValid] = useState<boolean>(true);

    // The successful submission path closes this controlled dialog from the
    // parent, bypassing handleClose. Reset the destructive choice whenever
    // that happens so it cannot be carried to the next detected playlist.
    useEffect(() => {
        if (!isOpen) {
            setSubscribeToPlaylist(false);
            setDownloadExistingVideos(false);
            setIntervalInput('60');
            setFilenameTemplate('');
            setIsTemplateValid(true);
        }
    }, [isOpen]);

    const subscribable = isSubscribableType(type);

    const parsedInterval = Number(intervalInput);
    const intervalValid =
        Number.isSafeInteger(parsedInterval) && parsedInterval > 0;
    const interval = intervalValid ? parsedInterval : 0;

    const handleConfirm = async () => {
        if (
            subscribable &&
            subscribeToPlaylist &&
            (!intervalValid || !isTemplateValid)
        ) {
            return;
        }
        const action: PlaylistDialogAction = {
            collectionName: collectionName || videoTitle,
        };
        if (subscribable && subscribeToPlaylist) {
            action.subscribe = {
                interval,
                downloadAll: downloadExistingVideos,
                filenameTemplate: filenameTemplate.trim() || null,
            };
        }
        setIsSubmitting(true);
        try {
            await onConfirm(action);
        } catch {
            // DownloadContext displays the actionable error. Keep this dialog
            // open with its current selection so the user can retry.
        } finally {
            setIsSubmitting(false);
        }
    };

    // Reset state when modal closes. The historical opt-in and subscription
    // toggle reset on close/reopen so a destructive choice never leaks across
    // sources (design §10.2).
    const handleClose = () => {
        if (isLoading || isSubmitting) return;
        setSubscribeToPlaylist(false);
        setDownloadExistingVideos(false);
        setIntervalInput('60');
        setFilenameTemplate('');
        setIsTemplateValid(true);
        onClose();
    };

    const toggleSubscription = (checked: boolean) => {
        setSubscribeToPlaylist(checked);
        // Toggling subscription off resets the destructive history opt-in.
        if (!checked) {
            setDownloadExistingVideos(false);
        }
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
        switch (type) {
            case 'collection':
            case 'series':
            case 'playlist':
                return t('downloadAllVideos', { count: videosNumber });
            default:
                return t('downloadAllParts', { count: videosNumber });
        }
    };

    const getCurrentButtonText = () => {
        switch (type) {
            case 'collection':
            case 'series':
            case 'playlist':
                return t('downloadThisVideoOnly');
            default:
                return t('downloadCurrentPartOnly');
        }
    };

    // Primary action text is state-dependent (design §4.1).
    const getPrimaryButtonText = () => {
        if (subscribable && subscribeToPlaylist) {
            // Subscribe on, history off => "Subscribe"; history on => download+subscribe.
            return downloadExistingVideos
                ? (t('downloadAndSubscribe') || 'Download All & Subscribe')
                : (t('subscribe') || 'Subscribe');
        }
        return getDownloadAllButtonText();
    };

    // Submit is disabled while loading or when subscription is on with an
    // invalid interval (design §10.2).
    const busy = isLoading || isSubmitting;
    const submitDisabled =
        busy ||
        (subscribable &&
            subscribeToPlaylist &&
            (!intervalValid || !isTemplateValid));

    return (
        <Dialog
            open={isOpen}
            onClose={handleClose}
            disableEscapeKeyDown={busy}
            maxWidth="sm"
            fullWidth
            slotProps={{
                paper: {
                    sx: { borderRadius: 2 }
                }
            }}
        >
            <DialogHeader title={getHeaderText()} onClose={handleClose} closeDisabled={busy} closeLabel={t('close')} />
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
                        disabled={busy}
                        helperText={type === 'parts' ? t('allPartsAddedToCollection') : type === 'playlist' ? t('allVideosAddedToCollection') : t('allVideosAddedToCollection')}
                    />
                </Box>

                {/* Subscription option - show for playlist, collection, and series types */}
                {subscribable && (
                    <Box sx={{ mt: 3 }}>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={subscribeToPlaylist}
                                    onChange={(e) => toggleSubscription(e.target.checked)}
                                    disabled={busy}
                                />
                            }
                            label={t('subscribeToPlaylist')}
                        />
                        {subscribeToPlaylist && (
                            <Box sx={{ mt: 2, ml: 4 }}>
                                <TextField
                                    type="number"
                                    label={t('checkIntervalMinutes')}
                                    value={intervalInput}
                                    onChange={(e) => setIntervalInput(e.target.value)}
                                    disabled={busy}
                                    size="small"
                                    slotProps={{ htmlInput: { min: 1 } }}
                                    helperText={t('subscribePlaylistDescription')}
                                    error={subscribeToPlaylist && !intervalValid}
                                    sx={{ width: 200 }}
                                />
                                <Box sx={{ mt: 2 }}>
                                    <SubscriptionFilenameTemplateField
                                        value={filenameTemplate}
                                        onChange={setFilenameTemplate}
                                        sourceCollectionType="playlist"
                                        disabled={busy}
                                        onValidityChange={setIsTemplateValid}
                                    />
                                </Box>
                                {/* Subscribe-only / history choice (design §4.1 / §10.2).
                                    Download existing is OFF by default. */}
                                <FormControlLabel
                                    sx={{ display: 'flex', mt: 1 }}
                                    control={
                                        <Checkbox
                                            checked={downloadExistingVideos}
                                            onChange={(e) => setDownloadExistingVideos(e.target.checked)}
                                            disabled={busy}
                                            inputProps={downloadExistingVideos
                                                ? undefined
                                                : { 'aria-describedby': 'playlist-subscribe-only-help' }}
                                        />
                                    }
                                    label={t('downloadExistingPlaylistVideos') || 'Download existing videos now'}
                                />
                                {!downloadExistingVideos && (
                                    <Typography id="playlist-subscribe-only-help" variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                        {t('subscribeOnlyNewPlaylistVideosHelp') || 'Existing playlist videos will not be queued. MyTube will download newly detected videos after this subscription is created.'}
                                    </Typography>
                                )}
                            </Box>
                        )}
                    </Box>
                )}
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                {/* Secondary "download this video only" action never creates a
                    subscription, even if the checkbox had been selected (design §4.1). */}
                <Button
                    onClick={() => {
                        handleClose();
                        onDownloadCurrent();
                    }}
                    disabled={busy}
                    loading={busy}
                    loadingPosition="start"
                    color="inherit"
                >
                    {getCurrentButtonText()}
                </Button>
                <Button
                    onClick={() => { void handleConfirm(); }}
                    loading={busy}
                    loadingPosition="start"
                    variant="contained"
                    color="primary"
                    disabled={submitDisabled}
                >
                    {getPrimaryButtonText()}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default BilibiliPartsModal;
