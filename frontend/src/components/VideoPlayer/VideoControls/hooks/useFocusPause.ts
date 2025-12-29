import { useEffect, useRef } from 'react';

export const useFocusPause = (
    videoRef: React.RefObject<HTMLVideoElement | null>,
    enabled: boolean
) => {
    // Track if the video was playing when we lost focus
    const wasPlayingRef = useRef<boolean>(false);

    useEffect(() => {
        if (!enabled) return;

        const handleBlur = () => {
            const videoElement = videoRef.current;
            if (videoElement && !videoElement.paused) {
                wasPlayingRef.current = true;
                videoElement.pause();
            }
        };

        const handleFocus = () => {
            const videoElement = videoRef.current;
            if (videoElement && wasPlayingRef.current) {
                videoElement.play().catch(e => console.error("Error resuming playback:", e));
            }
            wasPlayingRef.current = false;
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                handleBlur();
            } else if (document.visibilityState === 'visible') {
                handleFocus();
            }
        };

        window.addEventListener('blur', handleBlur);
        window.addEventListener('focus', handleFocus);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.removeEventListener('blur', handleBlur);
            window.removeEventListener('focus', handleFocus);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [enabled, videoRef]);
};
