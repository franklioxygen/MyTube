import { useCallback, useSyncExternalStore } from 'react';

export const useHeaderScrollState = (
    isMobile: boolean,
    infiniteScroll: boolean,
    isHomePage: boolean
): boolean => {
    const shouldDetectScroll = isMobile || (infiniteScroll && isHomePage);
    const subscribe = useCallback((onStoreChange: () => void) => {
        if (!shouldDetectScroll) {
            return () => undefined;
        }
        window.addEventListener('scroll', onStoreChange, { passive: true });
        return () => {
            window.removeEventListener('scroll', onStoreChange);
        };
    }, [shouldDetectScroll]);
    const getSnapshot = useCallback(() => {
        if (!shouldDetectScroll) {
            return false;
        }
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        return scrollTop > 50;
    }, [shouldDetectScroll]);

    return useSyncExternalStore(subscribe, getSnapshot, () => false);
};
