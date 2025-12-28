import React, { useEffect, useRef, useState } from 'react';

export const useVolume = (videoRef: React.RefObject<HTMLVideoElement | null>) => {
    const [volume, setVolume] = useState<number>(1);
    const [previousVolume, setPreviousVolume] = useState<number>(1);
    const [showVolumeSlider, setShowVolumeSlider] = useState<boolean>(false);
    const volumeSliderRef = useRef<HTMLDivElement>(null);
    const volumeSliderHideTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = volume;
        }
    }, [volume, videoRef]);

    // Close volume slider when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (volumeSliderRef.current && !volumeSliderRef.current.contains(event.target as Node)) {
                if (volumeSliderHideTimerRef.current) {
                    clearTimeout(volumeSliderHideTimerRef.current);
                }
                setShowVolumeSlider(false);
            }
        };

        if (showVolumeSlider) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => {
                document.removeEventListener('mousedown', handleClickOutside);
            };
        }
    }, [showVolumeSlider]);

    // Handle wheel event on volume control
    useEffect(() => {
        const handleWheel = (event: WheelEvent) => {
            if (volumeSliderRef.current && volumeSliderRef.current.contains(event.target as Node)) {
                event.preventDefault();
                event.stopPropagation();
                if (videoRef.current) {
                    const delta = event.deltaY > 0 ? 0.05 : -0.05;
                    const newVolume = Math.max(0, Math.min(1, volume + delta));
                    videoRef.current.volume = newVolume;
                    setVolume(newVolume);
                    if (newVolume > 0) {
                        setPreviousVolume(newVolume);
                    }
                }
            }
        };

        const container = volumeSliderRef.current;
        if (container) {
            container.addEventListener('wheel', handleWheel, { passive: false });
            return () => {
                container.removeEventListener('wheel', handleWheel);
            };
        }
    }, [volume, videoRef]);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (volumeSliderHideTimerRef.current) {
                clearTimeout(volumeSliderHideTimerRef.current);
            }
        };
    }, []);

    const handleVolumeChange = (newValue: number) => {
        if (videoRef.current) {
            const volumeValue = newValue / 100;
            videoRef.current.volume = volumeValue;
            setVolume(volumeValue);
        }
    };

    const handleVolumeClick = () => {
        if (videoRef.current) {
            if (volume > 0) {
                setPreviousVolume(volume);
                videoRef.current.volume = 0;
                setVolume(0);
            } else {
                const volumeToRestore = previousVolume > 0 ? previousVolume : 1;
                videoRef.current.volume = volumeToRestore;
                setVolume(volumeToRestore);
            }
        }
    };

    const handleVolumeMouseEnter = () => {
        if (volumeSliderHideTimerRef.current) {
            clearTimeout(volumeSliderHideTimerRef.current);
        }
        setShowVolumeSlider(true);
    };

    const handleVolumeMouseLeave = () => {
        volumeSliderHideTimerRef.current = setTimeout(() => {
            setShowVolumeSlider(false);
        }, 200);
    };

    const handleSliderMouseEnter = () => {
        if (volumeSliderHideTimerRef.current) {
            clearTimeout(volumeSliderHideTimerRef.current);
        }
    };

    const handleSliderMouseLeave = () => {
        volumeSliderHideTimerRef.current = setTimeout(() => {
            setShowVolumeSlider(false);
        }, 200);
    };

    return {
        volume,
        showVolumeSlider,
        volumeSliderRef,
        handleVolumeChange,
        handleVolumeClick,
        handleVolumeMouseEnter,
        handleVolumeMouseLeave,
        handleSliderMouseEnter,
        handleSliderMouseLeave
    };
};

