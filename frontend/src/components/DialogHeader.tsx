import { Close } from '@mui/icons-material';
import { DialogTitle, IconButton, Typography } from '@mui/material';
import React from 'react';

interface DialogHeaderProps {
    /** Title content, rendered as a bold h6. */
    title: React.ReactNode;
    /** When provided, a close (X) button is shown that calls this handler. */
    onClose?: () => void;
    /** Disables the close button, e.g. while an action is pending. */
    closeDisabled?: boolean;
    /** Accessible label for the close button. Pass a translated string. */
    closeLabel?: string;
    /** Optional id for the title element (referenced by aria-labelledby). */
    id?: string;
}

/**
 * Standard dialog header: a bold h6 title with an optional close button.
 * Extracted from the many modals that repeated this exact markup so the
 * title styling and close-button affordance stay consistent in one place.
 *
 * Intentionally free of context dependencies so it can be reused (and unit
 * tested) without a LanguageProvider; the close label is passed by callers.
 */
const DialogHeader: React.FC<DialogHeaderProps> = ({
    title,
    onClose,
    closeDisabled = false,
    closeLabel = 'Close',
    id,
}) => {
    return (
        <DialogTitle
            id={id}
            sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
            <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
                {title}
            </Typography>
            {onClose && (
                <IconButton
                    aria-label={closeLabel}
                    onClick={onClose}
                    disabled={closeDisabled}
                    sx={{ color: (theme) => theme.palette.grey[500] }}
                >
                    <Close />
                </IconButton>
            )}
        </DialogTitle>
    );
};

export default DialogHeader;
