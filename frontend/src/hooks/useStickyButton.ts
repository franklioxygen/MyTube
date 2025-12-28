import { RefObject, useEffect, useState } from 'react';

/**
 * Custom hook to manage sticky button visibility based on scroll position
 * @param observerTarget - Ref to the element that determines when to show sticky button
 * @returns isSticky - Whether the sticky button should be visible
 */
export function useStickyButton(observerTarget: RefObject<HTMLDivElement | null>): boolean {
    const [isSticky, setIsSticky] = useState(true);

    useEffect(() => {
        const handleScroll = () => {
            if (!observerTarget.current) return;
            const rect = observerTarget.current.getBoundingClientRect();
            // If reference element is below the viewport, show sticky button
            // rect.top is the distance from top of viewport to top of element
            // window.innerHeight is viewport height
            // If rect.top > window.innerHeight, it's below the fold.
            // We adding a small buffer (e.g. 10px) to ensure smooth transition
            setIsSticky(rect.top > window.innerHeight);
        };

        window.addEventListener('scroll', handleScroll);
        window.addEventListener('resize', handleScroll);
        // Initial check
        handleScroll();

        return () => {
            window.removeEventListener('scroll', handleScroll);
            window.removeEventListener('resize', handleScroll);
        };
    }, [observerTarget]);

    return isSticky;
}
