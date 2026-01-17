import React, { useEffect, useRef, useState } from 'react';

const VOLUME_STORAGE_KEY = 'videoPlayerVolume';
const PREVIOUS_VOLUME_STORAGE_KEY = 'videoPlayerPreviousVolume';

const getStoredVolume = (): number => {
    try {
        const stored = localStorage.getItem(VOLUME_STORAGE_KEY);
        if (stored !== null) {
            const parsed = parseFloat(stored);
            if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
                return parsed;
            }
        }
    } catch (error) {
        console.error('Error reading volume from localStorage:', error);
    }
    return 1;
};

const getStoredPreviousVolume = (): number => {
    try {
        const stored = localStorage.getItem(PREVIOUS_VOLUME_STORAGE_KEY);
        if (stored !== null) {
            const parsed = parseFloat(stored);
            if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
                return parsed;
            }
        }
    } catch (error) {
        console.error('Error reading previous volume from localStorage:', error);
    }
    return 1;
};

export const useVolume = (videoRef: React.RefObject<HTMLVideoElement | null>) => {
    const [volume, setVolume] = useState<number>(getStoredVolume);
    const [previousVolume, setPreviousVolume] = useState<number>(getStoredPreviousVolume);
    const [showVolumeSlider, setShowVolumeSlider] = useState<boolean>(false);
    const volumeSliderRef = useRef<HTMLDivElement>(null);
    const volumeSliderHideTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = volume;
        }
    }, [volume, videoRef]);

    // Save volume to localStorage when it changes
    useEffect(() => {
        try {
            localStorage.setItem(VOLUME_STORAGE_KEY, volume.toString());
        } catch (error) {
            console.error('Error saving volume to localStorage:', error);
        }
    }, [volume]);

    // Save previous volume to localStorage when it changes
    useEffect(() => {
        try {
            localStorage.setItem(PREVIOUS_VOLUME_STORAGE_KEY, previousVolume.toString());
        } catch (error) {
            console.error('Error saving previous volume to localStorage:', error);
        }
    }, [previousVolume]);

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

