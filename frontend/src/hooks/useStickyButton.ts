import { RefObject, useEffect, useState } from 'react';

/**
 * Custom hook to manage sticky button visibility based on scroll position
 * @param observerTarget - Ref to the element that determines when to show sticky button
 * @returns isSticky - Whether the sticky button should be visible
 */
export function useStickyButton(observerTarget: RefObject<HTMLDivElement | null>): boolean {
    const [isSticky, setIsSticky] = useState(false);

    useEffect(() => {
        const target = observerTarget.current;
        if (!target) {
            return;
        }

        const updateStickyState = () => {
            const rect = target.getBoundingClientRect();
            setIsSticky(rect.top >= window.innerHeight);
        };

        updateStickyState();

        let observer: IntersectionObserver | null = null;

        if (typeof window.IntersectionObserver === 'function') {
            observer = new window.IntersectionObserver((entries) => {
                const entry = entries[0];
                if (!entry) {
                    return;
                }

                const viewportBottom = entry.rootBounds?.bottom ?? window.innerHeight;
                setIsSticky(!entry.isIntersecting && entry.boundingClientRect.top >= viewportBottom);
            });

            observer.observe(target);
        } else {
            window.addEventListener('scroll', updateStickyState, { passive: true });
            window.addEventListener('resize', updateStickyState);
        }

        return () => {
            observer?.disconnect();
            window.removeEventListener('scroll', updateStickyState);
            window.removeEventListener('resize', updateStickyState);
        };
    }, [observerTarget]);

    return isSticky;
}
