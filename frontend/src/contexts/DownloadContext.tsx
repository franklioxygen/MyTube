import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { Suspense, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '../hooks/useSettings';
import { SUBSCRIPTIONS_QUERY_KEY } from '../hooks/useSubscriptions';
import { DownloadInfo } from '../types';
import { api } from '../utils/apiClient';
import { getApiErrorMessage, hasAxiosStatus } from '../utils/errors';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { INFO_SOUNDS } from '../utils/sounds';
import { resolveSubscriptionErrorMessage } from '../utils/subscriptionErrors';
import { useAuth } from './AuthContext';
import { useCollection } from './CollectionContext';
import { useLanguage } from './LanguageContext';
import { useSnackbar } from './SnackbarContext';
import { useVideo } from './VideoContext';
import {
    isTwitchChannelUrl,
    normalizeTwitchChannelUrlOrNull,
} from '../utils/twitch';
import { isMissAVUrl } from '../utils/missav';
const LEGACY_DOWNLOAD_STATUS_STORAGE_ID = 'mytube_download_status';
const DOWNLOAD_STATUS_STORAGE_ID = 'mytube:download-status';
const DOWNLOAD_STATUS_STORAGE_IDS = [
    LEGACY_DOWNLOAD_STATUS_STORAGE_ID,
    DOWNLOAD_STATUS_STORAGE_ID,
];
const DOWNLOAD_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds
const ACTIVE_POLL_INTERVAL_MS = 2000;
const IDLE_POLL_INTERVAL_MS = 10000;
const AlertModal = lazyWithRetry(() => import('../components/AlertModal'), 'alert-modal');
const ChannelSubscribeChoiceModal = lazyWithRetry(
    () => import('../components/ChannelSubscribeChoiceModal'),
    'channel-subscribe-choice-modal',
);
const ConfirmationModal = lazyWithRetry(
    () => import('../components/ConfirmationModal'),
    'confirmation-modal',
);
const SubscribeModal = lazyWithRetry(
    () => import('../components/SubscribeModal'),
    'subscribe-modal',
);
// Type-only import (erased at runtime) so handleSubscribeConfirm is typed
// against the structured form values exported by SubscribeModal.
import type { SubscribeFormValues } from '../components/SubscribeModal';
// Structured modal action type shared with BilibiliPartsModal (design §10.1).
import type { PlaylistDialogAction } from '../components/BilibiliPartsModal';

// Payload from GET /check-bilibili-collection, forwarded to the download API
// when the user confirms a collection/series download.
interface BilibiliCollectionInfo {
    type: 'collection' | 'series';
    id: string | number;
    mid: string | number;
    title: string;
    count: number;
}

interface BilibiliPartsInfo {
    videosNumber: number;
    title: string;
    url: string;
    type: 'parts' | 'collection' | 'series' | 'playlist';
    collectionInfo: BilibiliCollectionInfo | null;
}

interface DownloadContextType {
    activeDownloads: DownloadInfo[];
    queuedDownloads: DownloadInfo[];
    handleVideoSubmit: (
        videoUrl: string,
        skipCollectionCheck?: boolean,
        statisticsContext?: {
            relatedEventId?: string | null;
            sourceKind?: string;
            surface?: string;
        }
    ) => Promise<any>;
    handleAudioOnlyDownload: (
        videoUrl: string,
        statisticsContext?: { relatedEventId?: string | null; sourceKind?: string; surface?: string },
    ) => Promise<any>;
    showBilibiliPartsModal: boolean;
    setShowBilibiliPartsModal: (show: boolean) => void;
    bilibiliPartsInfo: BilibiliPartsInfo;
    isCheckingParts: boolean;
    handlePlaylistDialogConfirm: (action: PlaylistDialogAction) => Promise<void>;
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
    for (const storageId of DOWNLOAD_STATUS_STORAGE_IDS) {
        try {
            const savedStatus = localStorage.getItem(storageId);
            if (!savedStatus) continue;

            const parsedStatus = JSON.parse(savedStatus);

            // Check if the saved status is too old (stale)
            if (parsedStatus.timestamp && Date.now() - parsedStatus.timestamp > DOWNLOAD_TIMEOUT) {
                localStorage.removeItem(storageId);
                continue;
            }

            return parsedStatus;
        } catch (error) {
            console.error('Error parsing download status from localStorage:', error);
            localStorage.removeItem(storageId);
        }
    }

    return null;
};

const isBilibiliUrl = (url: string): boolean => {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        return (
            hostname === 'bilibili.com' ||
            hostname.endsWith('.bilibili.com') ||
            hostname === 'b23.tv' ||
            hostname.endsWith('.b23.tv') ||
            hostname === 'bili2233.cn' ||
            hostname.endsWith('.bili2233.cn')
        );
    } catch {
        return false;
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
            const response = await api.get('/download-status');
            return response.data;
        },
        // Only query when authenticated to avoid 401 errors on login page
        enabled: isAuthenticated,
        // Poll with dynamic interval: fast when busy, low-frequency when idle.
        refetchInterval: (query) => {
            const data = query.state.data as { activeDownloads?: unknown[]; queuedDownloads?: unknown[] } | undefined;
            const hasActive = (data?.activeDownloads?.length ?? 0) > 0;
            const hasQueued = (data?.queuedDownloads?.length ?? 0) > 0;
            // Keep low-frequency polling even when idle so tasks submitted from external API clients appear in UI.
            return hasActive || hasQueued ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS;
        },
        initialData: initialStatus || { activeDownloads: [], queuedDownloads: [] },
        // Always fetch fresh data on mount to ensure we have the latest server state
        refetchOnMount: 'always',
        staleTime: 1000, // Consider data stale after 1 second
        gcTime: 5 * 60 * 1000, // Garbage collect after 5 minutes
        // Suppress errors when not authenticated (expected behavior)
        retry: (failureCount, error: unknown) => {
            // Don't retry on 401 errors (unauthorized) - user is not authenticated
            if (hasAxiosStatus(error, 401)) {
                return false;
            }
            // Retry other errors up to 3 times
            return failureCount < 3;
        },
    });

    const activeDownloads = React.useMemo(() => downloadStatus.activeDownloads || [], [downloadStatus.activeDownloads]);
    const queuedDownloads = React.useMemo(() => downloadStatus.queuedDownloads || [], [downloadStatus.queuedDownloads]);

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
    // Tracks the last persisted (active count, queued count) so we only write
    // to localStorage when membership meaningfully changes — not on every 2s
    // poll tick while a download is in progress.
    const lastPersistedCountsRef = useRef<{ active: number; queued: number } | null>(null);

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
            fetchVideos();

            // Play task complete sound if enabled
            if (settings?.playSoundOnTaskComplete && INFO_SOUNDS[settings.playSoundOnTaskComplete]) {
                const soundFile = INFO_SOUNDS[settings.playSoundOnTaskComplete];
                const audio = new Audio(soundFile);
                audio.play().catch(e => console.error('Error playing completion sound:', e));
            }
        }

        if (activeDownloads.length > 0 || queuedDownloads.length > 0) {
            // Skip the write if the active/queued counts are unchanged since the
            // last persist — this avoids re-stringifying on every poll tick.
            const prev = lastPersistedCountsRef.current;
            if (!prev || prev.active !== activeDownloads.length || prev.queued !== queuedDownloads.length) {
                const statusData = {
                    activeDownloads,
                    queuedDownloads,
                    timestamp: Date.now()
                };
                localStorage.setItem(DOWNLOAD_STATUS_STORAGE_ID, JSON.stringify(statusData));
                lastPersistedCountsRef.current = { active: activeDownloads.length, queued: queuedDownloads.length };
            }
        } else {
            // Transition to idle: clear both the storage entry and the tracker.
            if (lastPersistedCountsRef.current !== null) {
                localStorage.removeItem(DOWNLOAD_STATUS_STORAGE_ID);
                lastPersistedCountsRef.current = null;
            }
        }
    }, [activeDownloads, queuedDownloads, fetchVideos, settings]);

    const checkBackendDownloadStatus = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey: ['downloadStatus'] });
    }, [queryClient]);

    const handleVideoSubmit = useCallback(async (
        videoUrl: string,
        skipCollectionCheck = false,
        skipPartsCheck: boolean | { relatedEventId?: string | null; sourceKind?: string; surface?: string } = false,
        forceDownload = false,
        statisticsContext?: { relatedEventId?: string | null; sourceKind?: string; surface?: string }
    ): Promise<any> => {
        // Backward-compat: callers historically passed (url, skipCollectionCheck, skipPartsCheck, forceDownload).
        // New callers can pass statisticsContext as the third parameter; detect the shape.
        let statisticsCtx: { relatedEventId?: string | null; sourceKind?: string; surface?: string } | undefined =
            statisticsContext;
        let normalizedSkipPartsCheck: boolean = false;
        if (typeof skipPartsCheck === 'object' && skipPartsCheck !== null) {
            statisticsCtx = skipPartsCheck;
        } else {
            normalizedSkipPartsCheck = skipPartsCheck === true;
        }
        try {
            // Check for YouTube playlist URL (must check before channel check)
            const playlistRegex = /[?&]list=([a-zA-Z0-9_-]+)/;

            if (playlistRegex.test(videoUrl) && !skipCollectionCheck) {
                setIsCheckingParts(true);
                try {
                    const playlistResponse = await api.get('/check-playlist', {
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
                setSubscribeSource('youtube');
                setShowChannelSubscribeChoiceModal(true);
                return { success: true };
            }

            // Check for Bilibili space/author URL (e.g., https://space.bilibili.com/4652742)
            const bilibiliSpaceRegex = /space\.bilibili\.com\/\d+/;
            if (bilibiliSpaceRegex.test(videoUrl)) {
                setSubscribeUrl(videoUrl);
                setSubscribeSource('bilibili');
                setShowSubscribeModal(true);
                return { success: true };
            }

            if (isTwitchChannelUrl(videoUrl)) {
                const normalizedTwitchUrl = normalizeTwitchChannelUrlOrNull(videoUrl);
                if (normalizedTwitchUrl) {
                    setSubscribeUrl(normalizedTwitchUrl);
                    setSubscribeSource('twitch');
                    setSubscribeMode('video');
                    setShowSubscribeModal(true);
                    return { success: true };
                }
            }

            // Check if it's a Bilibili URL
            if (isBilibiliUrl(videoUrl)) {
                setIsCheckingParts(true);
                try {
                    // Only check for collection/series if not explicitly skipped
                    if (!skipCollectionCheck) {
                        // First, check if it's a collection or series
                        const collectionResponse = await api.get('/check-bilibili-collection', {
                            params: { url: videoUrl }
                        });

                        if (collectionResponse.data.success && collectionResponse.data.type !== 'none') {
                            // It's a collection or series
                            const { type, title, count, id, mid } = collectionResponse.data;

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
                    if (!normalizedSkipPartsCheck) {
                        const partsResponse = await api.get('/check-bilibili-parts', {
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
            const response = await api.post('/download', {
                youtubeUrl: videoUrl,
                forceDownload: forceDownload,
                audioOnly: false,
                statisticsContext: statisticsCtx,
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
        } catch (err: unknown) {
            console.error('Error downloading video:', err);

            // Check if the error is because the input is a search term. The
            // backend signals this with a specific response body shape; match
            // it directly rather than requiring a full AxiosError instance.
            const responseData = err && typeof err === 'object' && 'response' in err
                ? (err as { response?: { data?: { isSearchTerm?: boolean; searchTerm?: string } } }).response?.data
                : undefined;
            if (responseData?.isSearchTerm && typeof responseData.searchTerm === 'string') {
                // Handle as search term
                return await handleSearch(responseData.searchTerm);
            }

            const errorMessage = getApiErrorMessage(err) || t('failedToDownloadVideo');
            showSnackbar(errorMessage, 'error');
            return {
                success: false,
                error: errorMessage,
            };
        }
    }, [
        checkBackendDownloadStatus, setVideos, showSnackbar, t, queryClient, handleSearch,
    ]);

    const handleAudioOnlyDownload = useCallback(async (
        videoUrl: string,
        statisticsContext?: { relatedEventId?: string | null; sourceKind?: string; surface?: string },
    ) => {
        try {
            const response = await api.post('/download', {
                youtubeUrl: videoUrl,
                forceDownload: false,
                audioOnly: isMissAVUrl(videoUrl) ? false : true,
                statisticsContext,
            });

            if (response.data.skipped) {
                showSnackbar(
                    response.data.previouslyDeleted
                        ? (t('videoSkippedDeleted') || 'Video was previously deleted, skipped download')
                        : (t('videoSkippedExists') || 'Video already exists, skipped download'),
                    'warning',
                );
                queryClient.invalidateQueries({ queryKey: ['downloadHistory'] });
                return { success: true, skipped: true };
            }

            if (response.data.downloadId) {
                checkBackendDownloadStatus();
            } else if (response.data.video) {
                setVideos((prevVideos) => [response.data.video, ...prevVideos]);
            }

            showSnackbar(t('videoDownloading'));
            return { success: true };
        } catch (err: unknown) {
            console.error('Error downloading video:', err);
            showSnackbar(getApiErrorMessage(err) || t('failedToDownloadVideo'), 'error');
            return {
                success: false,
                error: getApiErrorMessage(err) || t('failedToDownloadVideo'),
            };
        }
    }, [
        checkBackendDownloadStatus,
        queryClient,
        setVideos,
        showSnackbar,
        t,
    ]);


    const handlePlaylistDialogConfirm = useCallback(async (action: PlaylistDialogAction) => {
        const collectionName = action.collectionName || bilibiliPartsInfo.title;
        const isCollection = bilibiliPartsInfo.type === 'collection' || bilibiliPartsInfo.type === 'series';
        const isPlaylist = bilibiliPartsInfo.type === 'playlist';
        const isSubscribable = isPlaylist || isCollection; // Both playlists and collections/series can be subscribed

        try {
            // Handle playlist/collection/subscription - create subscription and/or download task.
            // Subscribe-only is the default: when subscription is enabled and
            // history is not, downloadAll is false (design §4.1 / §10.3).
            if (isSubscribable && action.subscribe) {
                const response = await api.post('/subscriptions/playlist', {
                    playlistUrl: bilibiliPartsInfo.url,
                    interval: action.subscribe.interval,
                    collectionName,
                    downloadAll: action.subscribe.downloadAll,
                    // Include collectionInfo for Bilibili collections/series
                    collectionInfo: isCollection ? bilibiliPartsInfo.collectionInfo : undefined,
                    filenameTemplate: action.subscribe.filenameTemplate || undefined,
                });

                const backfillStatus = response.data.backfillStatus as
                    | 'not_requested'
                    | 'started'
                    | 'already_exists'
                    | 'not_needed_empty'
                    | 'failed'
                    | undefined;
                const taskId = response.data.taskId as string | null | undefined;

                // Subscribe-only still creates/resolves a collection, so refresh
                // collections regardless of backfill outcome (design §10.3).
                if (response.data.collectionId) {
                    await fetchCollections();
                }
                // Refresh the shared subscriptions list (design §10.5).
                queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_QUERY_KEY });

                // Only trigger active-download polling when a backfill task was
                // actually started (design §10.3 / §10.5). A null task must not
                // imply work is queued.
                if ((backfillStatus === 'started' || backfillStatus === 'already_exists') && taskId) {
                    checkBackendDownloadStatus();
                }

                // Accurate snackbar feedback per backfill outcome (design §10.3).
                if (backfillStatus === 'started' && taskId) {
                    showSnackbar(t('playlistDownloadAndSubscriptionStarted') || t('playlistSubscribedSuccessfully'));
                } else if (backfillStatus === 'already_exists' && taskId) {
                    showSnackbar(t('playlistDownloadAndSubscriptionStarted') || t('playlistSubscribedSuccessfully'));
                } else if (backfillStatus === 'failed') {
                    // Subscription was created, but history failed to queue.
                    showSnackbar(t('playlistBaselineFailed') || t('playlistSubscribedSuccessfully'), 'warning');
                } else {
                    // not_requested, not_needed_empty, already_exists without taskId, or absent => subscribe-only success.
                    showSnackbar(t('playlistSubscribedNewOnly') || t('playlistSubscribedSuccessfully'));
                }
                // Close the modal only after a successful response (design §10.7).
                setShowBilibiliPartsModal(false);
                return;
            }

            // No subscription: preserve the standalone download paths.

            // Handle playlist without subscription - create continuous download task
            if (isPlaylist) {
                const response = await api.post('/subscriptions/tasks/playlist', {
                    playlistUrl: bilibiliPartsInfo.url,
                    collectionName,
                });

                // Trigger immediate status check
                checkBackendDownloadStatus();

                // If a collection was created, refresh collections
                if (response.data.collectionId) {
                    await fetchCollections();
                }

                showSnackbar(t('playlistDownloadStarted'));
                setShowBilibiliPartsModal(false);
                return;
            }

            // Handle collection/series without subscription - regular download
            const response = await api.post('/download', {
                youtubeUrl: bilibiliPartsInfo.url,
                downloadAllParts: !isCollection, // Only set this for multi-part videos
                downloadCollection: isCollection, // Set this for collections/series
                collectionInfo: isCollection ? bilibiliPartsInfo.collectionInfo : null,
                collectionName,
                audioOnly: false,
            });

            // Trigger immediate status check
            checkBackendDownloadStatus();

            // If a collection was created, refresh collections
            if (response.data.collectionId) {
                await fetchCollections();
            }

            showSnackbar(t('downloadStartedSuccessfully'));
            setShowBilibiliPartsModal(false);
        } catch (err: unknown) {
            console.error('Error downloading Bilibili parts/collection:', err);
            // Re-throw so the modal keeps the dialog open with the user's
            // selection intact for retry (design §10.7). Surface the message.
            showSnackbar(getApiErrorMessage(err) || t('failedToDownload'), 'error');
            throw err;
        }
    }, [bilibiliPartsInfo, checkBackendDownloadStatus, fetchCollections, showSnackbar, t, queryClient]);

    const handleDownloadCurrentBilibiliPart = useCallback(async () => {
        setShowBilibiliPartsModal(false);
        // Pass true to skip collection/series check AND parts check since we already know about it
        return await handleVideoSubmit(bilibiliPartsInfo.url, true, true);
    }, [handleVideoSubmit, bilibiliPartsInfo.url]);

    // Subscription logic
    const [showSubscribeModal, setShowSubscribeModal] = useState(false);
    const [showDuplicateModal, setShowDuplicateModal] = useState(false);
    const [subscribeUrl, setSubscribeUrl] = useState('');
    const [subscribeSource, setSubscribeSource] = useState<'youtube' | 'bilibili' | 'twitch' | undefined>(undefined);
    const [subscribeMode, setSubscribeMode] = useState<'video' | 'playlist'>('video');

    // Channel subscribe choice modal
    const [showChannelSubscribeChoiceModal, setShowChannelSubscribeChoiceModal] = useState(false);

    // Channel playlists confirmation modal
    const [showChannelPlaylistsModal, setShowChannelPlaylistsModal] = useState(false);
    const [channelPlaylistsUrl, setChannelPlaylistsUrl] = useState('');

    const handleSubscribe = async (
        interval: number,
        downloadAllPrevious: boolean,
        downloadShorts: boolean,
        downloadOrder: string,
        filenameTemplate: string | null
    ) => {
        try {
            await api.post('/subscriptions', {
                url: subscribeUrl,
                interval,
                downloadAllPrevious,
                downloadShorts,
                ...(downloadAllPrevious ? { downloadOrder } : {}),
                ...(filenameTemplate ? { filenameTemplate } : {}),
            });
            showSnackbar(t('subscribedSuccessfully'));
            setShowSubscribeModal(false);
            setSubscribeUrl('');
            setSubscribeSource(undefined);
        } catch (error: unknown) {
            console.error('Error subscribing:', error);
            if (hasAxiosStatus(error, 409)) {
                setShowSubscribeModal(false);
                setSubscribeSource(undefined);
                setShowDuplicateModal(true);
            } else {
                showSnackbar(
                    resolveSubscriptionErrorMessage(error, subscribeSource, t),
                    'error'
                );
            }
        }
    };

    const handleConfirmChannelPlaylists = async () => {
        try {
            const response = await api.post('/downloads/channel-playlists', {
                url: channelPlaylistsUrl
            });
            showSnackbar(response.data.message || t('downloadStartedSuccessfully'));
            setShowChannelPlaylistsModal(false);
            setChannelPlaylistsUrl('');
        } catch (err: unknown) {
            console.error('Error downloading channel playlists:', err);
            showSnackbar(getApiErrorMessage(err) || t('failedToDownload'), 'error');
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

    const performSubscribePlaylists = async (
        interval: number,
        downloadAllPrevious: boolean = false,
        filenameTemplate: string | null = null
    ) => {
        try {
            // Construct the playlists URL
            let playlistsUrl = subscribeUrl;
            if (!playlistsUrl.includes('/playlists')) {
                playlistsUrl = playlistsUrl.endsWith('/')
                    ? `${playlistsUrl}playlists`
                    : `${playlistsUrl}/playlists`;
            }

            // Call the new endpoint to subscribe to all playlists
            const response = await api.post('/subscriptions/channel-playlists', {
                url: playlistsUrl,
                interval: interval,
                downloadAllPrevious: downloadAllPrevious,
                ...(filenameTemplate ? { filenameTemplate } : {}),
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
            queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_QUERY_KEY });
            setSubscribeUrl('');
            setShowSubscribeModal(false);
            setSubscribeSource(undefined);

        } catch (err: unknown) {
            console.error('Error subscribing to channel playlists:', err);
            if (hasAxiosStatus(err, 409)) {
                showSnackbar(t('subscriptionAlreadyExists'), 'warning');
            } else {
                showSnackbar(getApiErrorMessage(err) || t('error'), 'error');
            }
            setSubscribeUrl('');
            setShowSubscribeModal(false);
            setSubscribeSource(undefined);
        }
    };

    const handleSubscribeConfirm = async (values: SubscribeFormValues) => {
        if (subscribeMode === 'video') {
            await handleSubscribe(
                values.interval,
                values.downloadAllPrevious,
                values.downloadShorts,
                values.downloadOrder,
                values.filenameTemplate
            );
        } else {
            performSubscribePlaylists(
                values.interval,
                values.downloadAllPrevious,
                values.filenameTemplate
            );
        }
    };

    const value = useMemo<DownloadContextType>(() => ({
        activeDownloads,
        queuedDownloads,
        handleVideoSubmit,
        handleAudioOnlyDownload,
        showBilibiliPartsModal,
        setShowBilibiliPartsModal,
        bilibiliPartsInfo,
        isCheckingParts,
        handlePlaylistDialogConfirm,
        handleDownloadCurrentBilibiliPart,
    }), [
        activeDownloads, queuedDownloads, handleVideoSubmit, handleAudioOnlyDownload, showBilibiliPartsModal,
        bilibiliPartsInfo, isCheckingParts, handlePlaylistDialogConfirm,
        handleDownloadCurrentBilibiliPart,
    ]);

    return (
        <DownloadContext.Provider value={value}>
            {children}
            <Suspense fallback={null}>
                {showChannelSubscribeChoiceModal && (
                    <ChannelSubscribeChoiceModal
                        open={showChannelSubscribeChoiceModal}
                        onClose={() => {
                            setShowChannelSubscribeChoiceModal(false);
                            setSubscribeUrl('');
                            setSubscribeSource(undefined);
                        }}
                        onChooseVideos={handleChooseSubscribeVideos}
                        onChoosePlaylists={handleChooseSubscribePlaylists}
                    />
                )}
                {showSubscribeModal && (
                    <SubscribeModal
                        open={showSubscribeModal}
                        onClose={() => {
                            setShowSubscribeModal(false);
                            setSubscribeSource(undefined);
                        }}
                        onConfirm={handleSubscribeConfirm}
                        url={subscribeUrl}
                        source={subscribeSource}
                        title={subscribeMode === 'playlist' ? (t('subscribeAllPlaylists') || 'Subscribe All Playlists') : undefined}
                        description={subscribeMode === 'playlist' ? (t('subscribeAllPlaylistsDescription') || 'This will subscribe to all playlists in this channel.') : undefined}
                        enableDownloadOrder={subscribeMode !== 'playlist'}
                        playlistMode={subscribeMode === 'playlist'}
                        downloadPreviousLabel={subscribeMode === 'playlist' ? (t('downloadExistingPlaylistVideos') || 'Download existing videos in these playlists') : undefined}
                        downloadPreviousHelp={subscribeMode === 'playlist' ? (t('downloadAllPlaylistsWarning') || undefined) : undefined}
                    />
                )}
                {showDuplicateModal && (
                    <AlertModal
                        open={showDuplicateModal}
                        onClose={() => setShowDuplicateModal(false)}
                        title={t('error')}
                        message={t('subscriptionAlreadyExists')}
                    />
                )}
                {showChannelPlaylistsModal && (
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
                )}
            </Suspense>
        </DownloadContext.Provider>
    );
};
