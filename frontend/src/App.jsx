import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import { Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import './App.css';
import Header from './components/Header';
import AuthorVideos from './pages/AuthorVideos';
import CollectionPage from './pages/CollectionPage';
import Home from './pages/Home';
import SearchResults from './pages/SearchResults';
import VideoPlayer from './pages/VideoPlayer';

const API_URL = import.meta.env.VITE_API_URL;
const DOWNLOAD_STATUS_KEY = 'mytube_download_status';
const DOWNLOAD_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds
const COLLECTIONS_KEY = 'mytube_collections';

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

function App() {
  const [videos, setVideos] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [localSearchResults, setLocalSearchResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [collections, setCollections] = useState([]);
  
  // Reference to the current search request's abort controller
  const searchAbortController = useRef(null);
  
  // Get initial download status from localStorage
  const initialStatus = getStoredDownloadStatus();
  const [downloadingTitle, setDownloadingTitle] = useState(
    initialStatus ? initialStatus.title || '' : ''
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

  // Fetch collections on component mount
  useEffect(() => {
    fetchCollections();
  }, []);

  // Fetch videos on component mount
  useEffect(() => {
    fetchVideos();
    
    // Also check for stale download status
    if (downloadingTitle) {
      const checkDownloadStatus = async () => {
        try {
          // Make a simple API call to check if the server is still processing the download
          await axios.get(`${API_URL}/videos`);
          
          // If we've been downloading for more than 3 minutes, assume it's done or failed
          const status = getStoredDownloadStatus();
          if (status && status.timestamp && Date.now() - status.timestamp > 3 * 60 * 1000) {
            console.log('Download has been running too long, clearing status');
            localStorage.removeItem(DOWNLOAD_STATUS_KEY);
            setDownloadingTitle('');
          }
        } catch (error) {
          console.error('Error checking download status:', error);
        }
      };
      
      checkDownloadStatus();
    }
  }, [downloadingTitle]);
  
  // Set up localStorage and event listeners
  useEffect(() => {
    console.log('Setting up localStorage and event listeners');
    
    // Set up event listener for storage changes (for multi-tab support)
    const handleStorageChange = (e) => {
      if (e.key === DOWNLOAD_STATUS_KEY) {
        try {
          const newStatus = e.newValue ? JSON.parse(e.newValue) : { title: '' };
          console.log('Storage changed, new status:', newStatus);
          setDownloadingTitle(newStatus.title || '');
        } catch (error) {
          console.error('Error handling storage change:', error);
        }
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    // Set up periodic check for stale download status
    const checkDownloadStatus = () => {
      const status = getStoredDownloadStatus();
      if (!status && downloadingTitle) {
        console.log('Clearing stale download status');
        setDownloadingTitle('');
      }
    };
    
    // Check every minute
    const statusCheckInterval = setInterval(checkDownloadStatus, 60000);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(statusCheckInterval);
    };
  }, [downloadingTitle]);
  
  // Update localStorage whenever downloadingTitle changes
  useEffect(() => {
    console.log('Download title changed:', downloadingTitle);
    
    if (downloadingTitle) {
      const statusData = { 
        title: downloadingTitle,
        timestamp: Date.now()
      };
      console.log('Saving to localStorage:', statusData);
      localStorage.setItem(DOWNLOAD_STATUS_KEY, JSON.stringify(statusData));
    } else {
      console.log('Removing from localStorage');
      localStorage.removeItem(DOWNLOAD_STATUS_KEY);
    }
  }, [downloadingTitle]);

  const fetchVideos = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/videos`);
      setVideos(response.data);
      setError(null);
      
      // Check if we need to clear a stale download status
      if (downloadingTitle) {
        const status = getStoredDownloadStatus();
        if (!status) {
          console.log('Clearing download status after fetching videos');
          setDownloadingTitle('');
        }
      }
    } catch (err) {
      console.error('Error fetching videos:', err);
      setError('Failed to load videos. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleVideoSubmit = async (videoUrl) => {
    try {
      setLoading(true);
      // Extract title from URL for display during download
      let displayTitle = videoUrl;
      if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
        displayTitle = 'YouTube video';
      } else if (videoUrl.includes('bilibili.com') || videoUrl.includes('b23.tv')) {
        displayTitle = 'Bilibili video';
      }
      
      // Set download status before making the API call
      setDownloadingTitle(displayTitle);
      
      const response = await axios.post(`${API_URL}/download`, { youtubeUrl: videoUrl });
      setVideos(prevVideos => [response.data.video, ...prevVideos]);
      setIsSearchMode(false);
      return { success: true };
    } catch (err) {
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
      setDownloadingTitle('');
    }
  };

  const searchLocalVideos = (query) => {
    if (!query || !videos.length) return [];
    
    const searchTermLower = query.toLowerCase();
    
    return videos.filter(video => 
      video.title.toLowerCase().includes(searchTermLower) || 
      video.author.toLowerCase().includes(searchTermLower)
    );
  };

  const handleSearch = async (query) => {
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
      } catch (youtubeErr) {
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
    } catch (err) {
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
    } finally {
      // Only update loading state if the request wasn't aborted
      if (searchAbortController.current && !searchAbortController.current.signal.aborted) {
        setLoading(false);
      }
    }
  };

  // Delete a video
  const handleDeleteVideo = async (id) => {
    try {
      setLoading(true);
      
      // First, remove the video from any collections
      await handleRemoveFromCollection(id);
      
      // Then delete the video
      await axios.delete(`${API_URL}/videos/${id}`);
      
      // Update the videos state
      setVideos(prevVideos => prevVideos.filter(video => video.id !== id));
      
      setLoading(false);
    } catch (error) {
      console.error('Error deleting video:', error);
      setError('Failed to delete video');
      setLoading(false);
    }
  };

  const handleDownloadFromSearch = async (videoUrl, title) => {
    // Abort any ongoing search request
    if (searchAbortController.current) {
      searchAbortController.current.abort();
      searchAbortController.current = null;
    }
    
    setIsSearchMode(false);
    // If title is provided, use it for the downloading message
    if (title) {
      setDownloadingTitle(title);
    }
    return await handleVideoSubmit(videoUrl);
  };

  // For debugging
  useEffect(() => {
    console.log('Current download status:', { 
      downloadingTitle, 
      isDownloading: !!downloadingTitle,
      localStorage: localStorage.getItem(DOWNLOAD_STATUS_KEY)
    });
  }, [downloadingTitle]);

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
  const handleCreateCollection = async (name, videoId = null) => {
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
  const handleAddToCollection = async (collectionId, videoId) => {
    try {
      // If videoId is provided, remove it from any other collections first
      // This is handled on the server side now
      
      // Add the video to the selected collection
      const response = await axios.put(`${API_URL}/collections/${collectionId}`, {
        videoId,
        action: 'add'
      });
      
      // Update the collections state with the updated collection
      setCollections(prevCollections =>
        prevCollections.map(collection =>
          collection.id === collectionId ? response.data : collection
        )
      );
      
      return true;
    } catch (error) {
      console.error('Error adding video to collection:', error);
      return false;
    }
  };

  // Remove a video from its collection
  const handleRemoveFromCollection = async (videoId) => {
    try {
      // Find all collections that contain this video
      const collectionsWithVideo = collections.filter(collection =>
        collection.videos.includes(videoId)
      );
      
      // Remove the video from each collection
      for (const collection of collectionsWithVideo) {
        await axios.put(`${API_URL}/collections/${collection.id}`, {
          videoId,
          action: 'remove'
        });
      }
      
      // Refresh collections from the server
      fetchCollections();
      
      return true;
    } catch (error) {
      console.error('Error removing video from collection:', error);
      return false;
    }
  };

  // Delete a collection
  const handleDeleteCollection = async (collectionId) => {
    try {
      // Confirm deletion
      if (!window.confirm('Are you sure you want to delete this collection?')) {
        return false;
      }
      
      // Delete the collection
      await axios.delete(`${API_URL}/collections/${collectionId}`);
      
      // Refresh collections from the server
      fetchCollections();
      
      return true;
    } catch (error) {
      console.error('Error deleting collection:', error);
      return false;
    }
  };

  return (
    <Router>
      <div className="app">
        <Header 
          onSearch={handleSearch} 
          onSubmit={handleVideoSubmit}
          isDownloading={!!downloadingTitle}
          downloadingTitle={downloadingTitle}
          isSearchMode={isSearchMode}
          searchTerm={searchTerm}
          onResetSearch={resetSearch}
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
                  loading={youtubeLoading}
                  searchTerm={searchTerm}
                  onDownload={handleDownloadFromSearch}
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
