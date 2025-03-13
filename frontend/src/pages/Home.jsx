import AuthorsList from '../components/AuthorsList';
import Collections from '../components/Collections';
import VideoCard from '../components/VideoCard';

const Home = ({ 
  videos = [], 
  loading, 
  error, 
  onDeleteVideo, 
  collections = [],
  isSearchMode = false,
  searchTerm = '',
  localSearchResults = [],
  youtubeLoading = false,
  searchResults = [],
  onDownload
}) => {
  // Add default empty array to ensure videos is always an array
  const videoArray = Array.isArray(videos) ? videos : [];

  if (loading && videoArray.length === 0 && !isSearchMode) {
    return <div className="loading">Loading videos...</div>;
  }

  if (error && videoArray.length === 0 && !isSearchMode) {
    return <div className="error">{error}</div>;
  }

  // Filter videos to only show the first video from each collection
  const filteredVideos = videoArray.filter(video => {
    // If the video is not in any collection, show it
    const videoCollections = collections.filter(collection => 
      collection.videos.includes(video.id)
    );
    
    if (videoCollections.length === 0) {
      return true;
    }
    
    // For each collection this video is in, check if it's the first video
    return videoCollections.some(collection => {
      // Get the first video ID in this collection
      const firstVideoId = collection.videos[0];
      // Show this video if it's the first in at least one collection
      return video.id === firstVideoId;
    });
  });

  // If in search mode, show search results
  if (isSearchMode) {
    const hasLocalResults = localSearchResults && localSearchResults.length > 0;
    const hasYouTubeResults = searchResults && searchResults.length > 0;
    
    return (
      <div className="search-results">
        <div className="search-header">
          <h2>Search Results for "{searchTerm}"</h2>
        </div>
        
        {/* Local Video Results */}
        <div className="search-results-section">
          <h3 className="section-title">From Your Library</h3>
          {hasLocalResults ? (
            <div className="search-results-grid">
              {localSearchResults.map((video) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  onDeleteVideo={onDeleteVideo}
                  showDeleteButton={true}
                  collections={collections}
                />
              ))}
            </div>
          ) : (
            <p className="no-results">No matching videos in your library.</p>
          )}
        </div>
        
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
              {searchResults.map((result) => (
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
                      onClick={() => onDownload(result.sourceUrl, result.title)}
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
  }

  // Regular home view (not in search mode)
  return (
    <div className="home-container">
      {videoArray.length === 0 ? (
        <div className="no-videos">
          <p>No videos yet. Submit a YouTube URL to download your first video!</p>
        </div>
      ) : (
        <div className="home-content">
          {/* Sidebar container for Collections and Authors */}
          <div className="sidebar-container">
            {/* Collections list */}
            <Collections collections={collections} />
            
            {/* Authors list */}
            <AuthorsList videos={videoArray} />
          </div>
          
          {/* Videos grid */}
          <div className="videos-grid">
            {filteredVideos.map(video => (
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
      )}
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

export default Home; 