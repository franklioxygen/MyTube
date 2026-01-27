import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Video } from '../types';
import { getApiUrl } from '../utils/apiUrl';

const API_URL = getApiUrl();

interface UseVideoProgressProps {
    videoId: string | undefined;
    video: Video | undefined;
}

/**
 * Custom hook to manage video progress tracking and view counting
 */
export function useVideoProgress({ videoId, video }: UseVideoProgressProps) {
    const { userRole } = useAuth();
    const isVisitor = userRole === 'visitor';
    const queryClient = useQueryClient();
    const [hasViewed, setHasViewed] = useState<boolean>(false);
    const lastProgressSave = useRef<number>(0);
    const currentTimeRef = useRef<number>(0);
    const isDeletingRef = useRef<boolean>(false);

    // Reset hasViewed when video changes
    useEffect(() => {
        setHasViewed(false);
        currentTimeRef.current = 0;
    }, [videoId]);

    // Save progress on unmount
    useEffect(() => {
        return () => {
            if (videoId && currentTimeRef.current > 0 && !isDeletingRef.current && !isVisitor) {
                axios.put(`${API_URL}/videos/${videoId}/progress`, { 
                    progress: Math.floor(currentTimeRef.current) 
                })
                    .catch(err => console.error('Error saving progress on unmount:', err));
            }
        };
    }, [videoId, isVisitor]);

    const handleTimeUpdate = (currentTime: number) => {
        currentTimeRef.current = currentTime;

        // Increment view count after 10 seconds
        if (currentTime > 10 && !hasViewed && videoId && !isVisitor) {
            setHasViewed(true);
            axios.post(`${API_URL}/videos/${videoId}/view`)
                .then(res => {
                    if (res.data.success && video) {
                        queryClient.setQueryData(['video', videoId], (old: Video | undefined) => 
                            old ? { ...old, viewCount: res.data.viewCount } : old
                        );
                    }
                })
                .catch(err => console.error('Error incrementing view count:', err));
        }

        // Save progress every 5 seconds
        const now = Date.now();
        if (now - lastProgressSave.current > 5000 && videoId && !isVisitor) {
            lastProgressSave.current = now;
            axios.put(`${API_URL}/videos/${videoId}/progress`, { 
                progress: Math.floor(currentTime) 
            })
                .catch(err => console.error('Error saving progress:', err));
        }
    };

    const setIsDeleting = (value: boolean) => {
        isDeletingRef.current = value;
    };

    return {
        handleTimeUpdate,
        setIsDeleting
    };
}
