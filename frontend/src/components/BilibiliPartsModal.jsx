import { useState } from 'react';

const BilibiliPartsModal = ({
  isOpen,
  onClose,
  videosNumber,
  videoTitle,
  onDownloadAll,
  onDownloadCurrent,
  isLoading,
  type = 'parts' // 'parts', 'collection', or 'series'
}) => {
  const [collectionName, setCollectionName] = useState('');

  if (!isOpen) return null;

  const handleDownloadAll = () => {
    onDownloadAll(collectionName || videoTitle);
  };

  // Dynamic text based on type
  const getHeaderText = () => {
    switch (type) {
      case 'collection':
        return 'Bilibili Collection Detected';
      case 'series':
        return 'Bilibili Series Detected';
      default:
        return 'Multi-part Video Detected';
    }
  };

  const getDescriptionText = () => {
    switch (type) {
      case 'collection':
        return `This Bilibili collection has ${videosNumber} videos.`;
      case 'series':
        return `This Bilibili series has ${videosNumber} videos.`;
      default:
        return `This Bilibili video has ${videosNumber} parts.`;
    }
  };

  const getDownloadAllButtonText = () => {
    if (isLoading) return 'Processing...';

    switch (type) {
      case 'collection':
        return `Download All ${videosNumber} Videos`;
      case 'series':
        return `Download All ${videosNumber} Videos`;
      default:
        return `Download All ${videosNumber} Parts`;
    }
  };

  const getCurrentButtonText = () => {
    if (isLoading) return 'Processing...';

    switch (type) {
      case 'collection':
        return 'Download This Video Only';
      case 'series':
        return 'Download This Video Only';
      default:
        return 'Download Current Part Only';
    }
  };

  const showCurrentButton = true; // Always show the current/single download option

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>{getHeaderText()}</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p>
            {getDescriptionText()}
          </p>
          <p>
            <strong>Title:</strong> {videoTitle}
          </p>
          <p>Would you like to download all {type === 'parts' ? 'parts' : 'videos'}?</p>

          <div className="form-group">
            <label htmlFor="collection-name">Collection Name:</label>
            <input
              type="text"
              id="collection-name"
              className="collection-input"
              value={collectionName}
              onChange={(e) => setCollectionName(e.target.value)}
              placeholder={videoTitle}
              disabled={isLoading}
            />
            <small>All {type === 'parts' ? 'parts' : 'videos'} will be added to this collection</small>
          </div>
        </div>
        <div className="modal-footer">
          <button
            className="btn secondary-btn"
            onClick={onDownloadCurrent}
            disabled={isLoading}
          >
            {getCurrentButtonText()}
          </button>
          <button
            className="btn primary-btn"
            onClick={handleDownloadAll}
            disabled={isLoading}
          >
            {getDownloadAllButtonText()}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BilibiliPartsModal; 