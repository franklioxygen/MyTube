import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AlertModal from '../components/AlertModal';
import ChannelSubscribeChoiceModal from '../components/ChannelSubscribeChoiceModal';
import ConfirmationModal from '../components/ConfirmationModal';
import SubscribeModal from '../components/SubscribeModal';
import { useSettings } from '../hooks/useSettings';
import { DownloadInfo } from '../types';
import { getApiUrl } from '../utils/apiUrl';
import { INFO_SOUNDS } from '../utils/sounds';
import { useAuth } from './AuthContext';
import { useCollection } from './CollectionContext';
import { useLanguage } from './LanguageContext';
import { useSnackbar } from './SnackbarContext';
import { useVideo } from './VideoContext';

const API_URL = getApiUrl();
const DOWNLOAD_STATUS_KEY = 'mytube_download_status';
const DOWNLOAD_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds

interface BilibiliPartsInfo {
    videosNumber: number;
    title: string;
    url: string;
    type: 'parts' | 'collection' | 'series' | 'playlist';
    collectionInfo: any;
}


interface SubscribeInfo {
    interval: number;
}

interface DownloadContextType {
    activeDownloads: DownloadInfo[];
    queuedDownloads: DownloadInfo[];
    handleVideoSubmit: (videoUrl: string, skipCollectionCheck?: boolean) => Promise<any>;
    showBilibiliPartsModal: boolean;
    setShowBilibiliPartsModal: (show: boolean) => void;
    bilibiliPartsInfo: BilibiliPartsInfo;
    isCheckingParts: boolean;
    handleDownloadAllBilibiliParts: (collectionName: string, subscribeInfo?: SubscribeInfo) => Promise<{ success: boolean; error?: string }>;
    handleDownloadCurrentBilibiliPart: () => Promise<any>;
}

const DownloadContext = createContext<DownloadContextType | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
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
    const { t } = useLanguage();
    const { fetchVideos, handleSearch, setVideos } = useVideo();
    const { fetchCollections } = useCollection();
    const { data: settings } = useSettings();
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();

    // Get initial download status from localStorage
    const initialStatus = getStoredDownloadStatus();

    const { data: downloadStatus } = useQuery({
        queryKey: ['downloadStatus'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/download-status`);
            return response.data;
        },
        // Only query when authenticated to avoid 401 errors on login page
        enabled: isAuthenticated,
        // Only poll when there are active or queued downloads
        refetchInterval: (query) => {
            const data = query.state.data as { activeDownloads?: any[]; queuedDownloads?: any[] } | undefined;
            const hasActive = (data?.activeDownloads?.length ?? 0) > 0;
            const hasQueued = (data?.queuedDownloads?.length ?? 0) > 0;
            // Poll every 2 seconds if there are downloads, otherwise stop polling
            return hasActive || hasQueued ? 2000 : false;
        },
        initialData: initialStatus || { activeDownloads: [], queuedDownloads: [] },
        // Always fetch fresh data on mount to ensure we have the latest server state
        refetchOnMount: 'always',
        staleTime: 1000, // Consider data stale after 1 second
        gcTime: 5 * 60 * 1000, // Garbage collect after 5 minutes
        // Suppress errors when not authenticated (expected behavior)
        retry: (failureCount, error: any) => {
            // Don't retry on 401 errors (unauthorized) - user is not authenticated
            if (error?.response?.status === 401) {
                return false;
            }
            // Retry other errors up to 3 times
            return failureCount < 3;
        },
    });

    const activeDownloads = React.useMemo(() => downloadStatus.activeDownloads || [], [downloadStatus.activeDownloads]);
    const queuedDownloads = React.useMemo(() => downloadStatus.queuedDownloads || [], [downloadStatus.queuedDownloads]);

    // Debug log to see what data we're receiving
    useEffect(() => {
        if (activeDownloads.length > 0) {
            activeDownloads.forEach((d: any) => {
                if (d.progress !== undefined || d.speed) {
                    console.log(`[Frontend] Download ${d.id}: progress=${d.progress}, speed=${d.speed}, totalSize=${d.totalSize}`);
                }
            });
        }
    }, [activeDownloads]);

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

    useEffect(() => {
        const newIds = new Set<string>([
            ...activeDownloads.map((d: DownloadInfo) => d.id),
            ...queuedDownloads.map((d: DownloadInfo) => d.id)
        ]);

        let hasCompleted = false;
        if (currentDownloadIdsRef.current.size > 0) {
            for (const id of currentDownloadIdsRef.current) {
                if (!newIds.has(id)) {
                    hasCompleted = true;
                    break;
                }
            }
        }

        currentDownloadIdsRef.current = newIds;

        if (hasCompleted) {
            console.log('Download completed, refreshing videos');
            fetchVideos();

            // Play task complete sound if enabled
            if (settings?.playSoundOnTaskComplete && INFO_SOUNDS[settings.playSoundOnTaskComplete]) {
                const soundFile = INFO_SOUNDS[settings.playSoundOnTaskComplete];
                const audio = new Audio(soundFile);
                audio.play().catch(e => console.error('Error playing completion sound:', e));
            }
        }

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
    }, [activeDownloads, queuedDownloads, fetchVideos, settings]);

    const checkBackendDownloadStatus = async () => {
        await queryClient.invalidateQueries({ queryKey: ['downloadStatus'] });
    };

    const handleVideoSubmit = async (videoUrl: string, skipCollectionCheck = false, skipPartsCheck = false, forceDownload = false): Promise<any> => {
        try {
            // Check for YouTube playlist URL (must check before channel check)
            const playlistRegex = /[?&]list=([a-zA-Z0-9_-]+)/;

            if (playlistRegex.test(videoUrl) && !skipCollectionCheck) {
                setIsCheckingParts(true);
                try {
                    const playlistResponse = await axios.get(`${API_URL}/check-playlist`, {
                        params: { url: videoUrl }
                    });

                    if (playlistResponse.data.success) {
                        const { title, videoCount } = playlistResponse.data;
                        setBilibiliPartsInfo({
                            videosNumber: videoCount,
                            title: title,
                            url: videoUrl,
                            type: 'playlist',
                            collectionInfo: null
                        });
                        setShowBilibiliPartsModal(true);
                        setIsCheckingParts(false);
                        return { success: true };
                    }
                } catch (err) {
                    console.error('Error checking playlist:', err);
                    // Continue with normal download if check fails
                } finally {
                    setIsCheckingParts(false);
                }
            }

            // Check for YouTube channel playlists URL
            // Matches: https://www.youtube.com/@Channel/playlists
            const channelPlaylistsRegex = /youtube\.com\/(@[^/]+|channel\/[^/]+|user\/[^/]+|c\/[^/]+)\/playlists/;
            if (channelPlaylistsRegex.test(videoUrl)) {
                setChannelPlaylistsUrl(videoUrl);
                setShowChannelPlaylistsModal(true);
                return { success: true };
            }

            // Check for YouTube channel URL (but not playlists tab, or if user declined playlists download)
            // Regex for: @username, channel/ID, user/username, c/customURL
            const channelRegex = /youtube\.com\/(?:@|channel\/|user\/|c\/)/;
            if (channelRegex.test(videoUrl)) {
                setSubscribeUrl(videoUrl);
                setShowChannelSubscribeChoiceModal(true);
                return { success: true };
            }

            // Check for Bilibili space/author URL (e.g., https://space.bilibili.com/4652742)
            const bilibiliSpaceRegex = /space\.bilibili\.com\/\d+/;
            if (bilibiliSpaceRegex.test(videoUrl)) {
                setSubscribeUrl(videoUrl);
                setShowSubscribeModal(true);
                return { success: true };
            }

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
                    // Only check if not explicitly skipped
                    if (!skipPartsCheck) {
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
                    }
                } catch (err) {
                    console.error('Error checking Bilibili parts/collection:', err);
                    // Continue with normal download if check fails
                } finally {
                    setIsCheckingParts(false);
                }
            }

            // Normal download flow
            const response = await axios.post(`${API_URL}/download`, {
                youtubeUrl: videoUrl,
                forceDownload: forceDownload
            });

            // Check if video was skipped (already exists or previously deleted)
            if (response.data.skipped) {
                if (response.data.previouslyDeleted) {
                    showSnackbar(t('videoSkippedDeleted') || 'Video was previously deleted, skipped download', 'warning');
                } else {
                    showSnackbar(t('videoSkippedExists') || 'Video already exists, skipped download', 'warning');
                }
                // Invalidate download history to show the skipped/deleted entry
                queryClient.invalidateQueries({ queryKey: ['downloadHistory'] });
                return { success: true, skipped: true };
            }

            // If the response contains a downloadId, it means it was queued/started
            if (response.data.downloadId) {
                // Trigger an immediate status check
                checkBackendDownloadStatus();
            } else if (response.data.video) {
                // If it returned a video immediately (shouldn't happen with new logic but safe to keep)
                setVideos(prevVideos => [response.data.video, ...prevVideos]);
            }

            showSnackbar(t('videoDownloading'));
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
                error: err.response?.data?.error || t('failedToDownloadVideo')
            };
        }
    };


    const handleDownloadAllBilibiliParts = async (collectionName: string, subscribeInfo?: SubscribeInfo) => {
        try {
            setShowBilibiliPartsModal(false);

            const isCollection = bilibiliPartsInfo.type === 'collection' || bilibiliPartsInfo.type === 'series';
            const isPlaylist = bilibiliPartsInfo.type === 'playlist';
            const isSubscribable = isPlaylist || isCollection; // Both playlists and collections/series can be subscribed

            // Handle playlist/collection/subscription - create subscription and/or download task
            if (isSubscribable && subscribeInfo) {
                // If subscribing, use the subscription endpoint (works for both playlists and collections)
                const response = await axios.post(`${API_URL}/subscriptions/playlist`, {
                    playlistUrl: bilibiliPartsInfo.url,
                    interval: subscribeInfo.interval,
                    collectionName: collectionName || bilibiliPartsInfo.title,
                    downloadAll: true,
                    // Include collectionInfo for Bilibili collections/series
                    collectionInfo: isCollection ? bilibiliPartsInfo.collectionInfo : undefined
                });

                // Trigger immediate status check
                checkBackendDownloadStatus();

                // If a collection was created, refresh collections
                if (response.data.collectionId) {
                    await fetchCollections();
                }

                showSnackbar(t('playlistSubscribedSuccessfully'));
                return { success: true };
            }

            // Handle playlist without subscription - create continuous download task
            if (isPlaylist) {
                const response = await axios.post(`${API_URL}/subscriptions/tasks/playlist`, {
                    playlistUrl: bilibiliPartsInfo.url,
                    collectionName: collectionName || bilibiliPartsInfo.title
                });

                // Trigger immediate status check
                checkBackendDownloadStatus();

                // If a collection was created, refresh collections
                if (response.data.collectionId) {
                    await fetchCollections();
                }

                showSnackbar(t('playlistDownloadStarted'));
                return { success: true };
            }

            // Handle collection/series without subscription - regular download
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

            showSnackbar(t('downloadStartedSuccessfully'));
            return { success: true };
        } catch (err: any) {
            console.error('Error downloading Bilibili parts/collection:', err);

            return {
                success: false,
                error: err.response?.data?.error || t('failedToDownload')
            };
        }
    };

    const handleDownloadCurrentBilibiliPart = async () => {
        setShowBilibiliPartsModal(false);
        // Pass true to skip collection/series check AND parts check since we already know about it
        return await handleVideoSubmit(bilibiliPartsInfo.url, true, true);
    };

    // Subscription logic
    const [showSubscribeModal, setShowSubscribeModal] = useState(false);
    const [showDuplicateModal, setShowDuplicateModal] = useState(false);
    const [subscribeUrl, setSubscribeUrl] = useState('');
    const [subscribeMode, setSubscribeMode] = useState<'video' | 'playlist'>('video');

    // Channel subscribe choice modal
    const [showChannelSubscribeChoiceModal, setShowChannelSubscribeChoiceModal] = useState(false);

    // Channel playlists confirmation modal
    const [showChannelPlaylistsModal, setShowChannelPlaylistsModal] = useState(false);
    const [channelPlaylistsUrl, setChannelPlaylistsUrl] = useState('');

    const handleSubscribe = async (interval: number, downloadAllPrevious: boolean) => {
        try {
            await axios.post(`${API_URL}/subscriptions`, {
                url: subscribeUrl,
                interval,
                downloadAllPrevious
            });
            showSnackbar(t('subscribedSuccessfully'));
            setShowSubscribeModal(false);
            setSubscribeUrl('');
        } catch (error: any) {
            console.error('Error subscribing:', error);
            if (error.response && error.response.status === 409) {
                setShowSubscribeModal(false);
                setShowDuplicateModal(true);
            } else {
                showSnackbar(t('error'));
            }
        }
    };

    const handleConfirmChannelPlaylists = async () => {
        try {
            const response = await axios.post(`${API_URL}/downloads/channel-playlists`, {
                url: channelPlaylistsUrl
            });
            showSnackbar(response.data.message || t('downloadStartedSuccessfully'));
            setShowChannelPlaylistsModal(false);
            setChannelPlaylistsUrl('');
        } catch (err: any) {
            console.error('Error downloading channel playlists:', err);
            showSnackbar(err.response?.data?.error || t('failedToDownload'), 'error');
            setShowChannelPlaylistsModal(false);
            setChannelPlaylistsUrl('');
        }
    };

    const handleChooseSubscribeVideos = () => {
        // Show the regular subscribe modal for videos
        setSubscribeMode('video');
        setShowChannelSubscribeChoiceModal(false);
        setShowSubscribeModal(true);
    };

    const handleChooseSubscribePlaylists = () => {
        setSubscribeMode('playlist');
        setShowChannelSubscribeChoiceModal(false);
        setShowSubscribeModal(true);
    };

    const performSubscribePlaylists = async (interval: number, downloadAllPrevious: boolean = false) => {
        try {
            // Construct the playlists URL
            let playlistsUrl = subscribeUrl;
            if (!playlistsUrl.includes('/playlists')) {
                playlistsUrl = playlistsUrl.endsWith('/')
                    ? `${playlistsUrl}playlists`
                    : `${playlistsUrl}/playlists`;
            }

            // Call the new endpoint to subscribe to all playlists
            const response = await axios.post(`${API_URL}/subscriptions/channel-playlists`, {
                url: playlistsUrl,
                interval: interval,
                downloadAllPrevious: downloadAllPrevious
            });

            // Construct message from translations
            const { subscribedCount, skippedCount, errorCount } = response.data;
            let message = '';

            if (subscribedCount > 0) {
                message = t('subscribePlaylistsSuccess', {
                    count: subscribedCount,
                    plural: subscribedCount > 1 ? 's' : ''
                });
                if (skippedCount > 0) {
                    message += ' ' + t('subscribePlaylistsSkipped', {
                        count: skippedCount,
                        plural: skippedCount > 1 ? 's' : '',
                        wasWere: skippedCount > 1 ? 'were' : 'was'
                    });
                }
                if (errorCount > 0) {
                    message += ' ' + t('subscribePlaylistsErrors', {
                        count: errorCount,
                        plural: errorCount > 1 ? 's' : ''
                    });
                }
            } else {
                message = t('subscribePlaylistsNoNew');
                if (skippedCount > 0) {
                    message += ' ' + t('subscribePlaylistsSkipped', {
                        count: skippedCount,
                        plural: skippedCount > 1 ? 's' : '',
                        wasWere: skippedCount > 1 ? 'were' : 'was'
                    });
                }
                if (errorCount > 0) {
                    message += ' ' + t('subscribePlaylistsErrors', {
                        count: errorCount,
                        plural: errorCount > 1 ? 's' : ''
                    });
                }
            }

            showSnackbar(message);
            queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
            setSubscribeUrl('');
            setShowSubscribeModal(false);

        } catch (err: any) {
            console.error('Error subscribing to channel playlists:', err);
            if (err.response && err.response.status === 409) {
                showSnackbar(t('subscriptionAlreadyExists'), 'warning');
            } else {
                showSnackbar(err.response?.data?.error || t('error'), 'error');
            }
            setSubscribeUrl('');
            setShowSubscribeModal(false);
        }
    };

    const handleSubscribeConfirm = (interval: number, downloadAllPrevious: boolean) => {
        if (subscribeMode === 'video') {
            handleSubscribe(interval, downloadAllPrevious);
        } else {
            performSubscribePlaylists(interval, downloadAllPrevious);
        }
    };

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
            <ChannelSubscribeChoiceModal
                open={showChannelSubscribeChoiceModal}
                onClose={() => {
                    setShowChannelSubscribeChoiceModal(false);
                    setSubscribeUrl('');
                }}
                onChooseVideos={handleChooseSubscribeVideos}
                onChoosePlaylists={handleChooseSubscribePlaylists}
            />
            <SubscribeModal
                open={showSubscribeModal}
                onClose={() => setShowSubscribeModal(false)}
                onConfirm={handleSubscribeConfirm}
                url={subscribeUrl}
                title={subscribeMode === 'playlist' ? (t('subscribeAllPlaylists') || 'Subscribe All Playlists') : undefined}
                description={subscribeMode === 'playlist' ? (t('subscribeAllPlaylistsDescription') || 'This will subscribe to all playlists in this channel.') : undefined}
            />
            <AlertModal
                open={showDuplicateModal}
                onClose={() => setShowDuplicateModal(false)}
                title={t('error')}
                message={t('subscriptionAlreadyExists')}
            />
            <ConfirmationModal
                isOpen={showChannelPlaylistsModal}
                onClose={() => {
                    setShowChannelPlaylistsModal(false);
                    setChannelPlaylistsUrl('');
                }}
                onConfirm={handleConfirmChannelPlaylists}
                title={t('downloadAll') || 'Download All Playlists'}
                message={t('confirmDownloadAllPlaylists') || "Download all playlists from this channel? This will create a collection for each playlist."}
                confirmText={t('downloadAll') || 'Download All'}
                cancelText={t('cancel') || 'Cancel'}
            />
        </DownloadContext.Provider>
    );
};
