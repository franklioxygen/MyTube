import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import { Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import './App.css';
import BilibiliPartsModal from './components/BilibiliPartsModal';
import Header from './components/Header';
import AuthorVideos from './pages/AuthorVideos';
import CollectionPage from './pages/CollectionPage';
import Home from './pages/Home';
import ManagePage from './pages/ManagePage';
import SearchResults from './pages/SearchResults';
import VideoPlayer from './pages/VideoPlayer';
import { Collection, DownloadInfo, Video } from './types';

const API_URL = import.meta.env.VITE_API_URL;
const DOWNLOAD_STATUS_KEY = 'mytube_download_status';
const DOWNLOAD_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds

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

interface BilibiliPartsInfo {
    videosNumber: number;
    title: string;
    url: string;
    type: 'parts' | 'collection' | 'series';
    collectionInfo: any;
}

function App() {
    const [videos, setVideos] = useState<Video[]>([]);
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [localSearchResults, setLocalSearchResults] = useState<Video[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [youtubeLoading, setYoutubeLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [isSearchMode, setIsSearchMode] = useState<boolean>(false);
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [collections, setCollections] = useState<Collection[]>([]);

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

    // Theme state
    const [theme, setTheme] = useState<string>(() => {
        return localStorage.getItem('theme') || 'dark';
    });

    // Apply theme to body
    useEffect(() => {
        document.body.className = theme === 'light' ? 'light-mode' : '';
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
    };

    // Reference to the current search request's abort controller
    const searchAbortController = useRef<AbortController | null>(null);

    // Get initial download status from localStorage
    const initialStatus = getStoredDownloadStatus();
    const [activeDownloads, setActiveDownloads] = useState<DownloadInfo[]>(
        initialStatus ? initialStatus.activeDownloads || [] : []
    );

    // Fetch collections from the server
    const fetchCollections = async () => {
        try {
            const response = await axios.get(`${API_URL}/collections`);
            setCollections(response.data);
        } catch (error) {
            console.error('Error fetching collections:', error);
        }
    };

    // Add a function to check download status from the backend
    const checkBackendDownloadStatus = async () => {
        try {
            const response = await axios.get(`${API_URL}/download-status`);

            if (response.data.activeDownloads && response.data.activeDownloads.length > 0) {
                // If backend has active downloads, update the local status
                setActiveDownloads(response.data.activeDownloads);

                // Save to localStorage for persistence
                const statusData = {
                    activeDownloads: response.data.activeDownloads,
                    timestamp: Date.now()
                };
                localStorage.setItem(DOWNLOAD_STATUS_KEY, JSON.stringify(statusData));
            } else {
                // If backend says no downloads are in progress, clear the status
                if (activeDownloads.length > 0) {
                    console.log('Backend says downloads are complete, clearing status');
                    localStorage.removeItem(DOWNLOAD_STATUS_KEY);
                    setActiveDownloads([]);
                    // Refresh videos list when downloads complete
                    fetchVideos();
                }
            }
        } catch (error) {
            console.error('Error checking backend download status:', error);
        }
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
    }, [activeDownloads.length]); // Depend on length to trigger refresh when downloads finish

    // Fetch collections on component mount
    useEffect(() => {
        fetchCollections();
    }, []);

    // Fetch videos on component mount
    useEffect(() => {
        fetchVideos();
    }, []);

    // Set up localStorage and event listeners
    useEffect(() => {
        console.log('Setting up localStorage and event listeners');

        // Set up event listener for storage changes (for multi-tab support)
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === DOWNLOAD_STATUS_KEY) {
                try {
                    const newStatus = e.newValue ? JSON.parse(e.newValue) : { activeDownloads: [] };
                    console.log('Storage changed, new status:', newStatus);
                    setActiveDownloads(newStatus.activeDownloads || []);
                } catch (error) {
                    console.error('Error handling storage change:', error);
                }
            }
        };

        window.addEventListener('storage', handleStorageChange);

        // Set up periodic check for stale download status
        const checkDownloadStatus = () => {
            const status = getStoredDownloadStatus();
            if (!status && activeDownloads.length > 0) {
                console.log('Clearing stale download status');
                setActiveDownloads([]);
            }
        };

        // Check every minute
        const statusCheckInterval = setInterval(checkDownloadStatus, 60000);

        return () => {
            window.removeEventListener('storage', handleStorageChange);
            clearInterval(statusCheckInterval);
        };
    }, [activeDownloads]);

    // Update localStorage whenever activeDownloads changes
    useEffect(() => {
        console.log('Active downloads changed:', activeDownloads);

        if (activeDownloads.length > 0) {
            const statusData = {
                activeDownloads,
                timestamp: Date.now()
            };
            console.log('Saving to localStorage:', statusData);
            localStorage.setItem(DOWNLOAD_STATUS_KEY, JSON.stringify(statusData));
        } else {
            console.log('Removing from localStorage');
            localStorage.removeItem(DOWNLOAD_STATUS_KEY);
        }
    }, [activeDownloads]);

    const fetchVideos = async () => {
        try {
            setLoading(true);
            const response = await axios.get(`${API_URL}/videos`);
            setVideos(response.data);
            setError(null);

            // Check if we need to clear a stale download status
            if (activeDownloads.length > 0) {
                const status = getStoredDownloadStatus();
                if (!status) {
                    console.log('Clearing download status after fetching videos');
                    setActiveDownloads([]);
                }
            }
        } catch (err) {
            console.error('Error fetching videos:', err);
            setError('Failed to load videos. Please try again later.');
        } finally {
            setLoading(false);
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
            setLoading(true);

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

            setIsSearchMode(false);

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
        } finally {
            setLoading(false);
        }
    };

    const searchLocalVideos = (query: string) => {
        if (!query || !videos.length) return [];

        const searchTermLower = query.toLowerCase();

        return videos.filter(video =>
            video.title.toLowerCase().includes(searchTermLower) ||
            video.author.toLowerCase().includes(searchTermLower)
        );
    };

    const handleSearch = async (query: string): Promise<any> => {
        // Don't enter search mode if the query is empty
        if (!query || query.trim() === '') {
            resetSearch();
            return { success: false, error: 'Please enter a search term' };
        }

        try {
            // Cancel any previous search request
            if (searchAbortController.current) {
                searchAbortController.current.abort();
            }

            // Create a new abort controller for this request
            searchAbortController.current = new AbortController();
            const signal = searchAbortController.current.signal;

            // Set search mode and term immediately
            setIsSearchMode(true);
            setSearchTerm(query);

            // Search local videos first (synchronously)
            const localResults = searchLocalVideos(query);
            setLocalSearchResults(localResults);

            // Set loading state only for YouTube results
            setYoutubeLoading(true);

            // Then search YouTube asynchronously
            try {
                const response = await axios.get(`${API_URL}/search`, {
                    params: { query },
                    signal: signal // Pass the abort signal to axios
                });

                // Only update results if the request wasn't aborted
                if (!signal.aborted) {
                    setSearchResults(response.data.results);
                }
            } catch (youtubeErr: any) {
                // Don't handle if it's an abort error
                if (youtubeErr.name !== 'CanceledError' && youtubeErr.name !== 'AbortError') {
                    console.error('Error searching YouTube:', youtubeErr);
                }
                // Don't set overall error if only YouTube search fails
            } finally {
                // Only update loading state if the request wasn't aborted
                if (!signal.aborted) {
                    setYoutubeLoading(false);
                }
            }

            return { success: true };
        } catch (err: any) {
            // Don't handle if it's an abort error
            if (err.name !== 'CanceledError' && err.name !== 'AbortError') {
                console.error('Error in search process:', err);

                // Even if there's an error in the overall process,
                // we still want to show local results if available
                const localResults = searchLocalVideos(query);
                if (localResults.length > 0) {
                    setLocalSearchResults(localResults);
                    setIsSearchMode(true);
                    setSearchTerm(query);
                    return { success: true };
                }

                return {
                    success: false,
                    error: 'Failed to search. Please try again.'
                };
            }
            return { success: false, error: 'Search was cancelled' };
        } finally {
            // Only update loading state if the request wasn't aborted
            if (searchAbortController.current && !searchAbortController.current.signal.aborted) {
                setLoading(false);
            }
        }
    };

    // Delete a video
    const handleDeleteVideo = async (id: string) => {
        try {
            setLoading(true);

            // First, remove the video from any collections
            await handleRemoveFromCollection(id);

            // Then delete the video
            await axios.delete(`${API_URL}/videos/${id}`);

            // Update the videos state
            setVideos(prevVideos => prevVideos.filter(video => video.id !== id));

            setLoading(false);
            return { success: true };
        } catch (error) {
            console.error('Error deleting video:', error);
            setError('Failed to delete video');
            setLoading(false);
            return { success: false, error: 'Failed to delete video' };
        }
    };

    const handleDownloadFromSearch = async (videoUrl: string) => {
        try {
            // Abort any ongoing search request
            if (searchAbortController.current) {
                searchAbortController.current.abort();
                searchAbortController.current = null;
            }

            setIsSearchMode(false);

            const result = await handleVideoSubmit(videoUrl);
            return result;
        } catch (error) {
            console.error('Error in handleDownloadFromSearch:', error);
            return { success: false, error: 'Failed to download video' };
        }
    };

    // For debugging
    useEffect(() => {
        console.log('Current download status:', {
            activeDownloads,
            count: activeDownloads.length,
            localStorage: localStorage.getItem(DOWNLOAD_STATUS_KEY)
        });
    }, [activeDownloads]);

    // Cleanup effect to abort any pending search requests when unmounting
    useEffect(() => {
        return () => {
            // Abort any ongoing search request when component unmounts
            if (searchAbortController.current) {
                searchAbortController.current.abort();
                searchAbortController.current = null;
            }
        };
    }, []);

    // Update the resetSearch function to abort any ongoing search
    const resetSearch = () => {
        // Abort any ongoing search request
        if (searchAbortController.current) {
            searchAbortController.current.abort();
            searchAbortController.current = null;
        }

        // Reset search-related state
        setIsSearchMode(false);
        setSearchTerm('');
        setSearchResults([]);
        setLocalSearchResults([]);
        setYoutubeLoading(false);
    };

    // Create a new collection
    const handleCreateCollection = async (name: string, videoId: string) => {
        try {
            const response = await axios.post(`${API_URL}/collections`, {
                name,
                videoId
            });

            // Update the collections state with the new collection from the server
            setCollections(prevCollections => [...prevCollections, response.data]);

            return response.data;
        } catch (error) {
            console.error('Error creating collection:', error);
            return null;
        }
    };

    // Add a video to a collection
    const handleAddToCollection = async (collectionId: string, videoId: string) => {
        try {
            // If videoId is provided, remove it from any other collections first
            // This is handled on the server side now

            // Add the video to the selected collection
            const response = await axios.put(`${API_URL}/collections/${collectionId}`, {
                videoId,
                action: "add"
            });

            // Update the collections state with the updated collection from the server
            setCollections(prevCollections => prevCollections.map(collection =>
                collection.id === collectionId ? response.data : collection
            ));

            return response.data;
        } catch (error) {
            console.error('Error adding video to collection:', error);
            return null;
        }
    };

    // Remove a video from a collection
    const handleRemoveFromCollection = async (videoId: string) => {
        try {
            // Get all collections
            const collectionsWithVideo = collections.filter(collection =>
                collection.videos.includes(videoId)
            );

            // For each collection that contains the video, remove it
            for (const collection of collectionsWithVideo) {
                await axios.put(`${API_URL}/collections/${collection.id}`, {
                    videoId,
                    action: "remove"
                });
            }

            // Update the collections state
            setCollections(prevCollections => prevCollections.map(collection => ({
                ...collection,
                videos: collection.videos.filter(v => v !== videoId)
            })));

            return true;
        } catch (error) {
            console.error('Error removing video from collection:', error);
            return false;
        }
    };

    // Delete a collection
    const handleDeleteCollection = async (collectionId: string, deleteVideos = false) => {
        try {
            // Delete the collection with optional video deletion
            await axios.delete(`${API_URL}/collections/${collectionId}`, {
                params: { deleteVideos: deleteVideos ? 'true' : 'false' }
            });

            // Update the collections state
            setCollections(prevCollections =>
                prevCollections.filter(collection => collection.id !== collectionId)
            );

            // If videos were deleted, refresh the videos list
            if (deleteVideos) {
                await fetchVideos();
            }

            return { success: true };
        } catch (error) {
            console.error('Error deleting collection:', error);
            return { success: false, error: 'Failed to delete collection' };
        }
    };

    // Handle downloading all parts of a Bilibili video OR all videos from a collection/series
    const handleDownloadAllBilibiliParts = async (collectionName: string) => {
        try {
            setLoading(true);
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

            setIsSearchMode(false);

            return { success: true };
        } catch (err: any) {
            console.error('Error downloading Bilibili parts/collection:', err);

            return {
                success: false,
                error: err.response?.data?.error || 'Failed to download. Please try again.'
            };
        } finally {
            setLoading(false);
        }
    };

    // Handle downloading only the current part of a Bilibili video
    const handleDownloadCurrentBilibiliPart = async () => {
        setShowBilibiliPartsModal(false);
        // Pass true to skip collection/series check since we already know about it
        return await handleVideoSubmit(bilibiliPartsInfo.url, true);
    };

    return (
        <Router>
            <div className="app">
                <Header
                    onSearch={handleSearch}
                    onSubmit={handleVideoSubmit}
                    activeDownloads={activeDownloads}
                    isSearchMode={isSearchMode}
                    searchTerm={searchTerm}
                    onResetSearch={resetSearch}
                    theme={theme}
                    toggleTheme={toggleTheme}
                />

                {/* Bilibili Parts Modal */}
                <BilibiliPartsModal
                    isOpen={showBilibiliPartsModal}
                    onClose={() => setShowBilibiliPartsModal(false)}
                    videosNumber={bilibiliPartsInfo.videosNumber}
                    videoTitle={bilibiliPartsInfo.title}
                    onDownloadAll={handleDownloadAllBilibiliParts}
                    onDownloadCurrent={handleDownloadCurrentBilibiliPart}
                    isLoading={loading || isCheckingParts}
                    type={bilibiliPartsInfo.type}
                />

                <main className="main-content">
                    <Routes>
                        <Route
                            path="/"
                            element={
                                <Home
                                    videos={videos}
                                    loading={loading}
                                    error={error}
                                    onDeleteVideo={handleDeleteVideo}
                                    collections={collections}
                                    isSearchMode={isSearchMode}
                                    searchTerm={searchTerm}
                                    localSearchResults={localSearchResults}
                                    youtubeLoading={youtubeLoading}
                                    searchResults={searchResults}
                                    onDownload={handleDownloadFromSearch}
                                    onResetSearch={resetSearch}
                                />
                            }
                        />
                        <Route
                            path="/video/:id"
                            element={
                                <VideoPlayer
                                    videos={videos}
                                    onDeleteVideo={handleDeleteVideo}
                                    collections={collections}
                                    onAddToCollection={handleAddToCollection}
                                    onCreateCollection={handleCreateCollection}
                                    onRemoveFromCollection={handleRemoveFromCollection}
                                />
                            }
                        />
                        <Route
                            path="/author/:author"
                            element={
                                <AuthorVideos
                                    videos={videos}
                                    onDeleteVideo={handleDeleteVideo}
                                    collections={collections}
                                />
                            }
                        />
                        <Route
                            path="/collection/:id"
                            element={
                                <CollectionPage
                                    collections={collections}
                                    videos={videos}
                                    onDeleteVideo={handleDeleteVideo}
                                    onDeleteCollection={handleDeleteCollection}
                                />
                            }
                        />
                        <Route
                            path="/search"
                            element={
                                <SearchResults
                                    results={searchResults}
                                    localResults={localSearchResults}
                                    loading={loading}
                                    youtubeLoading={youtubeLoading}
                                    searchTerm={searchTerm}
                                    onDownload={handleDownloadFromSearch}
                                    onDeleteVideo={handleDeleteVideo}
                                    onResetSearch={resetSearch}
                                    collections={collections}
                                />
                            }
                        />
                        <Route
                            path="/manage"
                            element={
                                <ManagePage
                                    videos={videos}
                                    onDeleteVideo={handleDeleteVideo}
                                    collections={collections}
                                    onDeleteCollection={handleDeleteCollection}
                                />
                            }
                        />
                    </Routes>
                </main>
            </div>
        </Router>
    );
}

export default App;
