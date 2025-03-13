import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import VideoCard from '../components/VideoCard';

// Define the API base URL
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const SearchResults = ({ 
  results, 
  localResults, 
  searchTerm, 
  loading, 
  youtubeLoading, 
  onDownload, 
  onDeleteVideo,
  onResetSearch,
  collections = []
}) => {
  const navigate = useNavigate();

  // If search term is empty, reset search and go back to home
  useEffect(() => {
    if (!searchTerm || searchTerm.trim() === '') {
      if (onResetSearch) {
        onResetSearch();
      }
    }
  }, [searchTerm, onResetSearch]);

  const handleDownload = async (videoUrl, title) => {
    try {
      await onDownload(videoUrl, title);
    } catch (error) {
      console.error('Error downloading from search results:', error);
    }
  };

  const handleBackClick = () => {
    // Call the onResetSearch function to reset search mode
    if (onResetSearch) {
      onResetSearch();
    } else {
      // Fallback to navigate if onResetSearch is not provided
      navigate('/');
    }
  };

  // If search term is empty, don't render search results
  if (!searchTerm || searchTerm.trim() === '') {
    return null;
  }

  // If the entire page is loading
  if (loading) {
    return (
      <div className="search-results">
        <h2>Searching for "{searchTerm}"...</h2>
        <div className="loading-spinner"></div>
      </div>
    );
  }

  const hasLocalResults = localResults && localResults.length > 0;
  const hasYouTubeResults = results && results.length > 0;
  const noResults = !hasLocalResults && !hasYouTubeResults && !youtubeLoading;

  if (noResults) {
    return (
      <div className="search-results">
        <div className="search-header">
          <button className="back-button" onClick={handleBackClick}>
            <span>←</span> Back to Home
          </button>
          <h2>Search Results for "{searchTerm}"</h2>
        </div>
        <p className="no-results">No results found. Try a different search term.</p>
      </div>
    );
  }

  return (
    <div className="search-results">
      <div className="search-header">
        <button className="back-button" onClick={handleBackClick}>
          <span>←</span> Back to Home
        </button>
        <h2>Search Results for "{searchTerm}"</h2>
      </div>
      
      {/* Local Video Results */}
      {hasLocalResults ? (
        <div className="search-results-section">
          <h3 className="section-title">From Your Library</h3>
          <div className="search-results-grid">
            {localResults.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                onDeleteVideo={onDeleteVideo}
                showDeleteButton={true}
                collections={collections}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="search-results-section">
          <h3 className="section-title">From Your Library</h3>
          <p className="no-results">No matching videos in your library.</p>
        </div>
      )}
      
      {/* YouTube Search Results */}
      <div className="search-results-section">
        <h3 className="section-title">From YouTube</h3>
        
        {youtubeLoading ? (
          <div className="youtube-loading">
            <div className="loading-spinner"></div>
            <p>Loading YouTube results...</p>
          </div>
        ) : hasYouTubeResults ? (
          <div className="search-results-grid">
            {results.map((result) => (
              <div key={result.id} className="search-result-card">
                <div className="search-result-thumbnail">
                  {result.thumbnailUrl ? (
                    <img 
                      src={result.thumbnailUrl} 
                      alt={result.title}
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = 'https://via.placeholder.com/480x360?text=No+Thumbnail';
                      }}
                    />
                  ) : (
                    <div className="thumbnail-placeholder">No Thumbnail</div>
                  )}
                </div>
                <div className="search-result-info">
                  <h3 className="search-result-title">{result.title}</h3>
                  <p className="search-result-author">{result.author}</p>
                  <div className="search-result-meta">
                    {result.duration && (
                      <span className="search-result-duration">
                        {formatDuration(result.duration)}
                      </span>
                    )}
                    {result.viewCount && (
                      <span className="search-result-views">
                        {formatViewCount(result.viewCount)} views
                      </span>
                    )}
                    <span className={`source-badge ${result.source}`}>
                      {result.source}
                    </span>
                  </div>
                  <button 
                    className="download-btn"
                    onClick={() => handleDownload(result.sourceUrl, result.title)}
                  >
                    Download
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="no-results">No YouTube results found.</p>
        )}
      </div>
    </div>
  );
};

// Helper function to format duration in seconds to MM:SS
const formatDuration = (seconds) => {
  if (!seconds) return '';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

// Helper function to format view count
const formatViewCount = (count) => {
  if (!count) return '0';
  if (count < 1000) return count.toString();
  if (count < 1000000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1000000).toFixed(1)}M`;
};

export default SearchResults; 