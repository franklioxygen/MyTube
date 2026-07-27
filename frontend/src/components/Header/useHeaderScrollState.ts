import { useCallback, useSyncExternalStore } from 'react';

export const useHeaderScrollState = (
    isMobile: boolean,
    infiniteScroll: boolean,
    isHomePage: boolean
): boolean => {
    const shouldDetectScroll = isMobile || (infiniteScroll && isHomePage);

    const getSnapshot = useCallback(() => {
        if (!shouldDetectScroll || typeof window === 'undefined') {
            return false;
        }

        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        return scrollTop > 50;
    }, [shouldDetectScroll]);

    const subscribe = useCallback((onStoreChange: () => void) => {
        if (!shouldDetectScroll || typeof window === 'undefined') {
            return () => {};
        }

        window.addEventListener('scroll', onStoreChange, { passive: true });
        window.addEventListener('resize', onStoreChange);
        return () => {
            window.removeEventListener('scroll', onStoreChange);
            window.removeEventListener('resize', onStoreChange);
        };
    }, [shouldDetectScroll]);

    return useSyncExternalStore(subscribe, getSnapshot, () => false);
};
