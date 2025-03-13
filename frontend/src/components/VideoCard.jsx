import { useNavigate } from 'react-router-dom';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

const VideoCard = ({ video, collections = [] }) => {
  const navigate = useNavigate();

  // Format the date (assuming format YYYYMMDD from youtube-dl)
  const formatDate = (dateString) => {
    if (!dateString || dateString.length !== 8) {
      return 'Unknown date';
    }
    
    const year = dateString.substring(0, 4);
    const month = dateString.substring(4, 6);
    const day = dateString.substring(6, 8);
    
    return `${year}-${month}-${day}`;
  };

  // Use local thumbnail if available, otherwise fall back to the original URL
  const thumbnailSrc = video.thumbnailPath 
    ? `${BACKEND_URL}${video.thumbnailPath}` 
    : video.thumbnailUrl;

  // Handle author click
  const handleAuthorClick = (e) => {
    e.stopPropagation();
    navigate(`/author/${encodeURIComponent(video.author)}`);
  };

  // Find collections this video belongs to
  const videoCollections = collections.filter(collection => 
    collection.videos.includes(video.id)
  );

  // Check if this video is the first in any collection
  const isFirstInAnyCollection = videoCollections.some(collection => 
    collection.videos[0] === video.id
  );

  // Get collection names where this video is the first
  const firstInCollectionNames = videoCollections
    .filter(collection => collection.videos[0] === video.id)
    .map(collection => collection.name);

  // Get the first collection ID where this video is the first video
  const firstCollectionId = isFirstInAnyCollection 
    ? videoCollections.find(collection => collection.videos[0] === video.id)?.id 
    : null;

  // Handle video navigation
  const handleVideoNavigation = () => {
    // If this is the first video in a collection, navigate to the collection page
    if (isFirstInAnyCollection && firstCollectionId) {
      navigate(`/collection/${firstCollectionId}`);
    } else {
      // Otherwise navigate to the video player page
      navigate(`/video/${video.id}`);
    }
  };

  // Get source icon
  const getSourceIcon = () => {
    if (video.source === 'bilibili') {
      return (
        <div className="source-icon bilibili-icon" title="Bilibili">
          B
        </div>
      );
    }
    return (
      <div className="source-icon youtube-icon" title="YouTube">
        YT
      </div>
    );
  };

  return (
    <div className={`video-card ${isFirstInAnyCollection ? 'collection-first' : ''}`}>
      <div 
        className="thumbnail-container clickable" 
        onClick={handleVideoNavigation}
        aria-label={isFirstInAnyCollection 
          ? `View collection: ${firstInCollectionNames[0]}${firstInCollectionNames.length > 1 ? ' and others' : ''}` 
          : `Play ${video.title}`}
      >
        <img 
          src={thumbnailSrc} 
          alt={`${video.title} thumbnail`} 
          className="thumbnail"
          loading="lazy"
          onError={(e) => {
            e.target.onerror = null;
            e.target.src = 'https://via.placeholder.com/480x360?text=No+Thumbnail';
          }}
        />
        {getSourceIcon()}
        
        {/* Show part number for multi-part videos */}
        {video.partNumber && video.totalParts > 1 && (
          <div className="part-badge">
            Part {video.partNumber}/{video.totalParts}
          </div>
        )}
        
        {/* Show collection badge if this is the first video in a collection */}
        {isFirstInAnyCollection && (
          <div className="collection-badge" title={`Collection${firstInCollectionNames.length > 1 ? 's' : ''}: ${firstInCollectionNames.join(', ')}`}>
            <span className="collection-icon">📁</span>
          </div>
        )}
      </div>
      <div className="video-info">
        <h3 
          className="video-title clickable" 
          onClick={handleVideoNavigation}
        >
          {isFirstInAnyCollection ? (
            <>
              {firstInCollectionNames[0]}
              {firstInCollectionNames.length > 1 && <span className="more-collections"> +{firstInCollectionNames.length - 1}</span>}
            </>
          ) : (
            video.title
          )}
        </h3>
        <div className="video-meta">
          <span 
            className="author-link"
            onClick={handleAuthorClick}
            role="button"
            tabIndex="0"
            aria-label={`View all videos by ${video.author}`}
          >
            {video.author}
          </span>
          <span className="video-date">{formatDate(video.date)}</span>
        </div>
      
      </div>
    </div>
  );
};

export default VideoCard; 