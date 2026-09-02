import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    Typography,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import {
    GESTURE_LOGIN_STATUS_QUERY_KEY,
    configureGestureLogin,
    getGestureErrorBody,
    getGestureErrorTranslationKey,
} from '../../utils/gestureLogin';
import DialogHeader from '../DialogHeader';
import GesturePattern from './GesturePattern';

interface GestureLoginSetupDialogProps {
    open: boolean;
    /** Replacement keeps the existing gesture working until the new one saves. */
    mode: 'create' | 'change';
    onClose: () => void;
    onSuccess?: () => void;
}

const GestureLoginSetupDialogContent: React.FC<GestureLoginSetupDialogProps> = ({
    open,
    mode,
    onClose,
    onSuccess,
}) => {
    const { t } = useLanguage();
    const queryClient = useQueryClient();

    // The first draw lives here and nowhere else: not in storage, not in a
    // query cache, not in a URL, and never sent to the server on its own.
    const [firstPattern, setFirstPattern] = useState<number[] | null>(null);
    const [announcement, setAnnouncement] = useState('');
    const [errorText, setErrorText] = useState('');
    const [outcome, setOutcome] = useState<'idle' | 'error'>('idle');

    const reset = () => {
        setFirstPattern(null);
        setAnnouncement('');
        setErrorText('');
        setOutcome('idle');
    };

    const saveMutation = useMutation({
        // Wrapped rather than passed by reference: React Query calls mutationFn
        // with a second context argument, which has no business reaching an API
        // helper whose signature is (pattern).
        mutationFn: (pattern: number[]) => configureGestureLogin(pattern),
        onSuccess: () => {
            // Clear every copy of the pattern before anything else.
            reset();
            queryClient.invalidateQueries({ queryKey: GESTURE_LOGIN_STATUS_QUERY_KEY });
            onSuccess?.();
            onClose();
        },
        onError: (error: unknown) => {
            // Start the two-draw flow over rather than retrying a half-remembered
            // pattern, and never surface the raw sequence in the message.
            const body = getGestureErrorBody(error);
            const key = getGestureErrorTranslationKey(body.code);
            setFirstPattern(null);
            setOutcome('error');
            setErrorText(
                (key ? t(key as never) : '') ||
                    t('gestureLoginSaveFailed') ||
                    'Gesture Login could not be saved. Please try again.'
            );
        },
    });

    const step = firstPattern === null ? 1 : 2;
    const saving = saveMutation.isPending;

    const handleComplete = (pattern: number[]) => {
        if (saving) return;

        if (firstPattern === null) {
            setOutcome('idle');
            setErrorText('');
            setFirstPattern(pattern);
            setAnnouncement(
                t('gestureLoginStepTwoAnnouncement') || 'Draw the same gesture again to confirm.'
            );
            return;
        }

        const matches =
            firstPattern.length === pattern.length &&
            firstPattern.every((dot, index) => dot === pattern[index]);

        if (!matches) {
            setFirstPattern(null);
            setOutcome('error');
            setErrorText(
                t('gestureLoginMismatch') || 'Gestures do not match. Start again.'
            );
            setAnnouncement('');
            return;
        }

        setOutcome('idle');
        setErrorText('');
        saveMutation.mutate(pattern);
    };

    const handleClose = () => {
        // The dialog cannot be dismissed mid-save: closing would leave the
        // caller unable to say whether a credential now exists.
        if (saving) return;
        reset();
        onClose();
    };

    const title =
        mode === 'change'
            ? t('gestureLoginChangeTitle') || 'Change Gesture'
            : t('gestureLoginSetUpTitle') || 'Set Up Gesture Login';

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
            <DialogHeader
                title={title}
                onClose={handleClose}
                closeDisabled={saving}
                closeLabel={t('close') || 'Close'}
            />
            <DialogContent>
                <Typography variant="subtitle2" data-testid="gesture-setup-step">
                    {(t('gestureLoginStep') || 'Step {current} of {total}')
                        .replace('{current}', String(step))
                        .replace('{total}', '2')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {step === 1
                        ? t('gestureLoginDrawInstruction') ||
                          'Draw a gesture connecting at least 3 dots.'
                        : t('gestureLoginConfirmInstruction') ||
                          'Draw the same gesture again to confirm.'}
                </Typography>

                {errorText && (
                    <Alert severity="error" sx={{ mb: 2 }} data-testid="gesture-setup-error">
                        {errorText}
                    </Alert>
                )}

                <Box sx={{ position: 'relative' }}>
                    <GesturePattern
                        mode="enroll"
                        disabled={saving}
                        outcome={outcome}
                        onComplete={handleComplete}
                        ariaLabel={title}
                        instructions={
                            t('gestureLoginReleaseInstruction') ||
                            'Press and hold to draw. Release to confirm this step.'
                        }
                        liveMessage={announcement}
                        minimumDotsMessage={
                            t('gestureLoginMinimumDots') ||
                            'Draw a gesture connecting at least 3 dots.'
                        }
                    />
                    {saving && (
                        <Box
                            data-testid="gesture-setup-saving"
                            sx={{
                                position: 'absolute',
                                inset: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <CircularProgress size={32} />
                        </Box>
                    )}
                </Box>

                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                    {t('gestureLoginConvenienceWarning') ||
                        'A gesture is a convenience, not a replacement for your password. Use HTTPS where possible.'}
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} disabled={saving}>
                    {t('cancel') || 'Cancel'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

const GestureLoginSetupDialog: React.FC<GestureLoginSetupDialogProps> = (props) => {
    // Unmounting the stateful flow on close guarantees that no first draw or
    // error can survive into the next opening, without synchronously resetting
    // several state values from an effect.
    if (!props.open) return null;
    return <GestureLoginSetupDialogContent key={props.mode} {...props} />;
};

export default GestureLoginSetupDialog;
