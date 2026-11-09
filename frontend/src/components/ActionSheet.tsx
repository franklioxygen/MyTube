import { Drawer, useMediaQuery } from '@mui/material';
import type { DrawerProps } from '@mui/material';

const TRANSITION_DURATION = { enter: 260, exit: 220 };

/** Shared backdrop and motion, including panels mounted on first open. */
export default function ActionSheet({
    anchor = 'bottom',
    slotProps,
    transitionDuration = TRANSITION_DURATION,
    ...props
}: DrawerProps) {
    const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

    return <Drawer
        {...props}
        anchor={anchor}
        transitionDuration={reduceMotion ? 0 : transitionDuration}
        slotProps={{
            ...slotProps,
            backdrop: (ownerState) => ({
                invisible: false,
                ...(typeof slotProps?.backdrop === 'function'
                    ? slotProps.backdrop(ownerState)
                    : slotProps?.backdrop),
            }),
            transition: (ownerState) => ({
                ...(typeof slotProps?.transition === 'function'
                    ? slotProps.transition(ownerState)
                    : slotProps?.transition),
                appear: true,
            }),
        }}
    />;
}
