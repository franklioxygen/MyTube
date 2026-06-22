import { Alert, Box, Button } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useLiveTranslationControl } from '../../contexts/LiveTranslationContext';

interface LiveTranslationStatusAlertProps {
    isCinemaMode?: boolean;
}

/**
 * Surfaces live translation session errors (with an optional retry) below the
 * player. The trigger itself now lives in the control bar, so this only renders
 * when there is an active error to report.
 */
const LiveTranslationStatusAlert: React.FC<LiveTranslationStatusAlertProps> = ({
    isCinemaMode = false,
}) => {
    const { t } = useLanguage();
    const { errorVisible, errorText, retryable, retry } = useLiveTranslationControl();

    if (!errorVisible) {
        return null;
    }

    return (
        <Box
            sx={{
                px: { xs: 2, md: 0 },
                mt: 1,
                maxWidth: isCinemaMode ? '1200px' : 'none',
                mx: isCinemaMode ? 'auto' : 0,
                width: '100%',
            }}
        >
            <Alert
                severity="error"
                action={
                    retryable ? (
                        <Button color="inherit" size="small" onClick={retry}>
                            {t('liveTranslationRetry')}
                        </Button>
                    ) : undefined
                }
            >
                {errorText}
            </Alert>
        </Box>
    );
};

export default LiveTranslationStatusAlert;
