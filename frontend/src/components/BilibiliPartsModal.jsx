import { useState } from 'react';

const BilibiliPartsModal = ({ 
  isOpen, 
  onClose, 
  videosNumber, 
  videoTitle, 
  onDownloadAll, 
  onDownloadCurrent,
  isLoading
}) => {
  const [collectionName, setCollectionName] = useState('');
  
  if (!isOpen) return null;
  
  const handleDownloadAll = () => {
    onDownloadAll(collectionName || videoTitle);
  };
  
  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Multi-part Video Detected</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p>
            This Bilibili video has <strong>{videosNumber}</strong> parts.
          </p>
          <p>
            <strong>Title:</strong> {videoTitle}
          </p>
          <p>Would you like to download all parts?</p>
          
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
            <small>All parts will be added to this collection</small>
          </div>
        </div>
        <div className="modal-footer">
          <button 
            className="btn secondary-btn" 
            onClick={onDownloadCurrent}
            disabled={isLoading}
          >
            {isLoading ? 'Processing...' : 'Download Current Part Only'}
          </button>
          <button 
            className="btn primary-btn" 
            onClick={handleDownloadAll}
            disabled={isLoading}
          >
            {isLoading ? 'Processing...' : `Download All ${videosNumber} Parts`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BilibiliPartsModal; 