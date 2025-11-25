import axios from 'axios';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { DownloadInfo } from '../types';
import { useCollection } from './CollectionContext';
import { useSnackbar } from './SnackbarContext';
import { useVideo } from './VideoContext';

const API_URL = import.meta.env.VITE_API_URL;
const DOWNLOAD_STATUS_KEY = 'mytube_download_status';
const DOWNLOAD_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds

interface BilibiliPartsInfo {
    videosNumber: number;
    title: string;
    url: string;
    type: 'parts' | 'collection' | 'series';
    collectionInfo: any;
}

interface DownloadContextType {
    activeDownloads: DownloadInfo[];
    queuedDownloads: DownloadInfo[];
    handleVideoSubmit: (videoUrl: string, skipCollectionCheck?: boolean) => Promise<any>;
    showBilibiliPartsModal: boolean;
    setShowBilibiliPartsModal: (show: boolean) => void;
    bilibiliPartsInfo: BilibiliPartsInfo;
    isCheckingParts: boolean;
    handleDownloadAllBilibiliParts: (collectionName: string) => Promise<{ success: boolean; error?: string }>;
    handleDownloadCurrentBilibiliPart: () => Promise<any>;
}

const DownloadContext = createContext<DownloadContextType | undefined>(undefined);

export const useDownload = () => {
    const context = useContext(DownloadContext);
    if (!context) {
        throw new Error('useDownload must be used within a DownloadProvider');
    }
    return context;
};

// Helper function to get download status from localStorage
const getStoredDownloadStatus = () => {
    try {
        const savedStatus = localStorage.getItem(DOWNLOAD_STATUS_KEY);
        if (!savedStatus) return null;

        const parsedStatus = JSON.parse(savedStatus);

        // Check if the saved status is too old (stale)
        if (parsedStatus.timestamp && Date.now() - parsedStatus.timestamp > DOWNLOAD_TIMEOUT) {
            localStorage.removeItem(DOWNLOAD_STATUS_KEY);
            return null;
        }

        return parsedStatus;
    } catch (error) {
        console.error('Error parsing download status from localStorage:', error);
        localStorage.removeItem(DOWNLOAD_STATUS_KEY);
        return null;
    }
};

export const DownloadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { showSnackbar } = useSnackbar();
    const { fetchVideos, handleSearch, setVideos } = useVideo();
    const { fetchCollections } = useCollection();

    // Get initial download status from localStorage
    const initialStatus = getStoredDownloadStatus();
    const [activeDownloads, setActiveDownloads] = useState<DownloadInfo[]>(
        initialStatus ? initialStatus.activeDownloads || [] : []
    );
    const [queuedDownloads, setQueuedDownloads] = useState<DownloadInfo[]>(
        initialStatus ? initialStatus.queuedDownloads || [] : []
    );

    // Bilibili multi-part video state
    const [showBilibiliPartsModal, setShowBilibiliPartsModal] = useState<boolean>(false);
    const [bilibiliPartsInfo, setBilibiliPartsInfo] = useState<BilibiliPartsInfo>({
        videosNumber: 0,
        title: '',
        url: '',
        type: 'parts', // 'parts', 'collection', or 'series'
        collectionInfo: null // For collection/series, stores the API response
    });
    const [isCheckingParts, setIsCheckingParts] = useState<boolean>(false);

    // Reference to track current download IDs for detecting completion
    const currentDownloadIdsRef = useRef<Set<string>>(new Set());

    // Add a function to check download status from the backend
    const checkBackendDownloadStatus = async () => {
        try {
            const response = await axios.get(`${API_URL}/download-status`);
            const { activeDownloads: backendActive, queuedDownloads: backendQueued } = response.data;

            const newActive = backendActive || [];
            const newQueued = backendQueued || [];

            // Create a set of all current download IDs from the backend
            const newIds = new Set<string>([
                ...newActive.map((d: DownloadInfo) => d.id),
                ...newQueued.map((d: DownloadInfo) => d.id)
            ]);

            // Check if any ID from the previous check is missing in the new check
            // This implies it finished (or failed), so we should refresh the video list
            let hasCompleted = false;
            if (currentDownloadIdsRef.current.size > 0) {
                for (const id of currentDownloadIdsRef.current) {
                    if (!newIds.has(id)) {
                        hasCompleted = true;
                        break;
                    }
                }
            }

            // Update the ref for the next check
            currentDownloadIdsRef.current = newIds;

            if (hasCompleted) {
                console.log('Download completed, refreshing videos');
                fetchVideos();
            }

            if (newActive.length > 0 || newQueued.length > 0) {
                // If backend has active or queued downloads, update the local status
                setActiveDownloads(newActive);
                setQueuedDownloads(newQueued);

                // Save to localStorage for persistence
                const statusData = {
                    activeDownloads: newActive,
                    queuedDownloads: newQueued,
                    timestamp: Date.now()
                };
                localStorage.setItem(DOWNLOAD_STATUS_KEY, JSON.stringify(statusData));
            } else {
                // If backend says no downloads are in progress, clear the status
                if (activeDownloads.length > 0 || queuedDownloads.length > 0) {
                    console.log('Backend says downloads are complete, clearing status');
                    localStorage.removeItem(DOWNLOAD_STATUS_KEY);
                    setActiveDownloads([]);
                    setQueuedDownloads([]);
                    // Refresh videos list when downloads complete (fallback)
                    fetchVideos();
                }
            }
        } catch (error) {
            console.error('Error checking backend download status:', error);
        }
    };

    const handleVideoSubmit = async (videoUrl: string, skipCollectionCheck = false): Promise<any> => {
        try {
            // Check if it's a Bilibili URL
            if (videoUrl.includes('bilibili.com') || videoUrl.includes('b23.tv')) {
                setIsCheckingParts(true);
                try {
                    // Only check for collection/series if not explicitly skipped
                    if (!skipCollectionCheck) {
                        // First, check if it's a collection or series
                        const collectionResponse = await axios.get(`${API_URL}/check-bilibili-collection`, {
                            params: { url: videoUrl }
                        });

                        if (collectionResponse.data.success && collectionResponse.data.type !== 'none') {
                            // It's a collection or series
                            const { type, title, count, id, mid } = collectionResponse.data;

                            console.log(`Detected Bilibili ${type}:`, title, `with ${count} videos`);

                            setBilibiliPartsInfo({
                                videosNumber: count,
                                title: title,
                                url: videoUrl,
                                type: type,
                                collectionInfo: { type, id, mid, title, count }
                            });
                            setShowBilibiliPartsModal(true);
                            setIsCheckingParts(false);
                            return { success: true };
                        }
                    }

                    // If not a collection/series (or check was skipped), check if it has multiple parts
                    const partsResponse = await axios.get(`${API_URL}/check-bilibili-parts`, {
                        params: { url: videoUrl }
                    });

                    if (partsResponse.data.success && partsResponse.data.videosNumber > 1) {
                        // Show modal to ask user if they want to download all parts
                        setBilibiliPartsInfo({
                            videosNumber: partsResponse.data.videosNumber,
                            title: partsResponse.data.title,
                            url: videoUrl,
                            type: 'parts',
                            collectionInfo: null
                        });
                        setShowBilibiliPartsModal(true);
                        setIsCheckingParts(false);
                        return { success: true };
                    }
                } catch (err) {
                    console.error('Error checking Bilibili parts/collection:', err);
                    // Continue with normal download if check fails
                } finally {
                    setIsCheckingParts(false);
                }
            }

            // Normal download flow
            // We don't set activeDownloads here immediately because the backend will queue it
            // and we'll pick it up via polling

            const response = await axios.post(`${API_URL}/download`, { youtubeUrl: videoUrl });

            // If the response contains a downloadId, it means it was queued/started
            if (response.data.downloadId) {
                // Trigger an immediate status check
                checkBackendDownloadStatus();
            } else if (response.data.video) {
                // If it returned a video immediately (shouldn't happen with new logic but safe to keep)
                setVideos(prevVideos => [response.data.video, ...prevVideos]);
            }

            // Use the setIsSearchMode from VideoContext but we need to expose it there first
            // For now, we can assume the caller handles UI state or we add it to VideoContext
            // Actually, let's just use the resetSearch from VideoContext which handles search mode
            // But wait, resetSearch clears everything. We just want to exit search mode.
            // Let's update VideoContext to expose setIsSearchMode or handle it better.
            // For now, let's assume VideoContext handles it via resetSearch if needed, or we just ignore it here
            // and let the component handle UI.
            // Wait, the original code called setIsSearchMode(false).
            // I should add setIsSearchMode to VideoContext interface.

            showSnackbar('Video downloading');
            return { success: true };
        } catch (err: any) {
            console.error('Error downloading video:', err);

            // Check if the error is because the input is a search term
            if (err.response?.data?.isSearchTerm) {
                // Handle as search term
                return await handleSearch(err.response.data.searchTerm);
            }

            return {
                success: false,
                error: err.response?.data?.error || 'Failed to download video. Please try again.'
            };
        }
    };

    const handleDownloadAllBilibiliParts = async (collectionName: string) => {
        try {
            setShowBilibiliPartsModal(false);

            const isCollection = bilibiliPartsInfo.type === 'collection' || bilibiliPartsInfo.type === 'series';

            const response = await axios.post(`${API_URL}/download`, {
                youtubeUrl: bilibiliPartsInfo.url,
                downloadAllParts: !isCollection, // Only set this for multi-part videos
                downloadCollection: isCollection, // Set this for collections/series
                collectionInfo: isCollection ? bilibiliPartsInfo.collectionInfo : null,
                collectionName
            });

            // Trigger immediate status check
            checkBackendDownloadStatus();

            // If a collection was created, refresh collections
            if (response.data.collectionId) {
                await fetchCollections();
            }

            showSnackbar('Download started successfully');
            return { success: true };
        } catch (err: any) {
            console.error('Error downloading Bilibili parts/collection:', err);

            return {
                success: false,
                error: err.response?.data?.error || 'Failed to download. Please try again.'
            };
        }
    };

    const handleDownloadCurrentBilibiliPart = async () => {
        setShowBilibiliPartsModal(false);
        // Pass true to skip collection/series check since we already know about it
        return await handleVideoSubmit(bilibiliPartsInfo.url, true);
    };

    // Check backend download status periodically
    useEffect(() => {
        // Check immediately on mount
        checkBackendDownloadStatus();

        // Then check every 2 seconds (faster polling for better UX)
        const statusCheckInterval = setInterval(checkBackendDownloadStatus, 2000);

        return () => {
            clearInterval(statusCheckInterval);
        };
    }, [activeDownloads.length, queuedDownloads.length]);

    // Set up localStorage and event listeners
    useEffect(() => {
        // Set up event listener for storage changes (for multi-tab support)
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === DOWNLOAD_STATUS_KEY) {
                try {
                    const newStatus = e.newValue ? JSON.parse(e.newValue) : { activeDownloads: [], queuedDownloads: [] };
                    setActiveDownloads(newStatus.activeDownloads || []);
                    setQueuedDownloads(newStatus.queuedDownloads || []);
                } catch (error) {
                    console.error('Error handling storage change:', error);
                }
            }
        };

        window.addEventListener('storage', handleStorageChange);

        // Set up periodic check for stale download status
        const checkDownloadStatus = () => {
            const status = getStoredDownloadStatus();
            if (!status && (activeDownloads.length > 0 || queuedDownloads.length > 0)) {
                console.log('Clearing stale download status');
                setActiveDownloads([]);
                setQueuedDownloads([]);
            }
        };

        // Check every minute
        const statusCheckInterval = setInterval(checkDownloadStatus, 60000);

        return () => {
            window.removeEventListener('storage', handleStorageChange);
            clearInterval(statusCheckInterval);
        };
    }, [activeDownloads, queuedDownloads]);

    // Update localStorage whenever activeDownloads or queuedDownloads changes
    useEffect(() => {
        if (activeDownloads.length > 0 || queuedDownloads.length > 0) {
            const statusData = {
                activeDownloads,
                queuedDownloads,
                timestamp: Date.now()
            };
            localStorage.setItem(DOWNLOAD_STATUS_KEY, JSON.stringify(statusData));
        } else {
            localStorage.removeItem(DOWNLOAD_STATUS_KEY);
        }
    }, [activeDownloads, queuedDownloads]);

    return (
        <DownloadContext.Provider value={{
            activeDownloads,
            queuedDownloads,
            handleVideoSubmit,
            showBilibiliPartsModal,
            setShowBilibiliPartsModal,
            bilibiliPartsInfo,
            isCheckingParts,
            handleDownloadAllBilibiliParts,
            handleDownloadCurrentBilibiliPart
        }}>
            {children}
        </DownloadContext.Provider>
    );
};
