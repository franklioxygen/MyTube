import { useState } from 'react';

type OpenState = {
    isMobile: boolean;
    isOpen: boolean;
};

type OpenStateUpdate = boolean | ((current: boolean) => boolean);

export const useBreakpointSynchronizedOpen = (isMobile: boolean) => {
    const [openState, setOpenState] = useState<OpenState>(() => ({
        isMobile,
        isOpen: !isMobile,
    }));
    const isOpen = openState.isMobile === isMobile ? openState.isOpen : !isMobile;

    const setIsOpen = (update: OpenStateUpdate) => {
        setOpenState((currentState) => {
            const current =
                currentState.isMobile === isMobile ? currentState.isOpen : !isMobile;
            const next = typeof update === 'function' ? update(current) : update;

            return {
                isMobile,
                isOpen: next,
            };
        });
    };

    return [isOpen, setIsOpen] as const;
};
