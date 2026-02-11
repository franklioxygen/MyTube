import { useEffect, useState } from 'react';

export const useHeaderScrollState = (
    isMobile: boolean,
    infiniteScroll: boolean,
    isHomePage: boolean
): boolean => {
    const [isScrolled, setIsScrolled] = useState(false);

    useEffect(() => {
        const shouldDetectScroll = isMobile || (infiniteScroll && isHomePage);
        if (!shouldDetectScroll) {
            setIsScrolled(false);
            return;
        }

        const handleScroll = () => {
            const scrollTop = window.scrollY || document.documentElement.scrollTop;
            setIsScrolled(scrollTop > 50);
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll();

        return () => {
            window.removeEventListener('scroll', handleScroll);
        };
    }, [isMobile, infiniteScroll, isHomePage]);

    return isScrolled;
};
