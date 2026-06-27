import { motion, useReducedMotion } from 'framer-motion';
import { ReactNode } from 'react';

interface PageTransitionProps {
    children: ReactNode;
}

const pageVariants = {
    initial: {
        opacity: 0,
        y: 20,
    },
    in: {
        opacity: 1,
        y: 0,
    },
    out: {
        opacity: 0,
        y: -20,
    },
};

// Variants used when the user prefers reduced motion: fade only, no vertical
// movement, so motion-sensitive users don't experience the slide animation.
const reducedMotionVariants = {
    initial: { opacity: 0 },
    in: { opacity: 1 },
    out: { opacity: 0 },
};

const pageTransition = {
    type: 'tween',
    ease: 'anticipate',
    duration: 0.3,
} as const;

const PageTransition = ({ children }: PageTransitionProps) => {
    const shouldReduceMotion = useReducedMotion();

    return (
        <motion.div
            initial="initial"
            animate="in"
            exit="out"
            variants={shouldReduceMotion ? reducedMotionVariants : pageVariants}
            transition={pageTransition}
            style={{ width: '100%', height: '100%' }}
        >
            {children}
        </motion.div>
    );
};

export default PageTransition;
