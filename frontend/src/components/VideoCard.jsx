import { useNavigate } from 'react-router-dom';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

const VideoCard = ({ video }) => {
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

  // Handle video navigation
  const handleVideoNavigation = () => {
    navigate(`/video/${video.id}`);
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
    <div className="video-card">
      <div 
        className="thumbnail-container clickable" 
        onClick={handleVideoNavigation}
        aria-label={`Play ${video.title}`}
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
      </div>
      <div className="video-info">
        <h3 
          className="video-title clickable" 
          onClick={handleVideoNavigation}
        >
          {video.title}
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