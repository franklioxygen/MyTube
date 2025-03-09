import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const Header = ({ onSubmit, onSearch, downloadingTitle, isDownloading }) => {
  const [videoUrl, setVideoUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  
  // Log props for debugging
  useEffect(() => {
    console.log('Header props:', { downloadingTitle, isDownloading });
  }, [downloadingTitle, isDownloading]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!videoUrl.trim()) {
      setError('Please enter a video URL or search term');
      return;
    }

    // Simple validation for YouTube or Bilibili URL
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
    const bilibiliRegex = /^(https?:\/\/)?(www\.)?(bilibili\.com|b23\.tv)\/.+$/;
    
    // Check if input is a URL
    const isUrl = youtubeRegex.test(videoUrl) || bilibiliRegex.test(videoUrl);
    
    setError('');
    setIsSubmitting(true);

    try {
      if (isUrl) {
        // Handle as URL for download
        const result = await onSubmit(videoUrl);
        
        if (result.success) {
          setVideoUrl('');
        } else if (result.isSearchTerm) {
          // If backend determined it's a search term despite our check
          const searchResult = await onSearch(videoUrl);
          if (searchResult.success) {
            setVideoUrl('');
            navigate('/');  // Navigate to home which will show search results
          } else {
            setError(searchResult.error);
          }
        } else {
          setError(result.error);
        }
      } else {
        // Handle as search term
        const result = await onSearch(videoUrl);
        
        if (result.success) {
          setVideoUrl('');
          // Stay on home page which will show search results
          navigate('/');
        } else {
          setError(result.error);
        }
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Determine the input placeholder text based on download status
  const getPlaceholderText = () => {
    if (isDownloading && downloadingTitle) {
      return `Downloading: ${downloadingTitle}...`;
    }
    return "Enter YouTube/Bilibili URL or search term";
  };

  return (
    <header className="header">
      <div className="header-content">
        <Link to="/" className="logo">
          <span style={{ color: '#ff3e3e' }}>My</span>
          <span style={{ color: '#f0f0f0' }}>Tube</span>
        </Link>
        
        <form className="url-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <input
              type="text"
              className={`url-input ${isDownloading ? 'downloading' : ''}`}
              placeholder={getPlaceholderText()}
              value={isDownloading ? '' : videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              disabled={isSubmitting || isDownloading}
              aria-label="Video URL or search term"
            />
            <button 
              type="submit" 
              className="submit-btn"
              disabled={isSubmitting || isDownloading}
            >
              {isSubmitting ? 'Processing...' : isDownloading ? 'Downloading...' : 'Submit'}
            </button>
          </div>
          {error && (
            <div className="form-error">
              {error}
            </div>
          )}
          {isDownloading && (
            <div className="download-status">
              Downloading: {downloadingTitle}...
            </div>
          )}
        </form>
      </div>
    </header>
  );
};

export default Header; 