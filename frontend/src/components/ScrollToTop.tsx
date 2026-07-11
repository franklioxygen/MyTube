import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Resets the window scroll position to the top whenever the route changes.
 * Without this, navigating from a scrolled page (e.g. the favorites rail) to
 * an author or collection page lands the user in the middle of the new page.
 */
const ScrollToTop: React.FC = () => {
    const { pathname, search } = useLocation();

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [pathname, search]);

    return null;
};

export default ScrollToTop;
