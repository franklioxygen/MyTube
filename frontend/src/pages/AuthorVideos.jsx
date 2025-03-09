import axios from 'axios';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import VideoCard from '../components/VideoCard';

const API_URL = import.meta.env.VITE_API_URL;

const AuthorVideos = ({ videos: allVideos, onDeleteVideo }) => {
  const { author } = useParams();
  const navigate = useNavigate();
  const [authorVideos, setAuthorVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // If videos are passed as props, filter them
    if (allVideos && allVideos.length > 0) {
      const filteredVideos = allVideos.filter(
        video => video.author === author
      );
      setAuthorVideos(filteredVideos);
      setLoading(false);
      return;
    }

    // Otherwise fetch from API
    const fetchVideos = async () => {
      try {
        const response = await axios.get(`${API_URL}/videos`);
        // Filter videos by author
        const filteredVideos = response.data.filter(
          video => video.author === author
        );
        setAuthorVideos(filteredVideos);
        setError(null);
      } catch (err) {
        console.error('Error fetching videos:', err);
        setError('Failed to load videos. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchVideos();
  }, [author, allVideos]);

  const handleBack = () => {
    navigate(-1);
  };

  if (loading) {
    return <div className="loading">Loading videos...</div>;
  }

  if (error) {
    return <div className="error">{error}</div>;
  }

  return (
    <div className="author-videos-container">
      <div className="author-header">
        <button className="back-button" onClick={handleBack}>
          &larr; Back
        </button>
        <div className="author-info">
          <h2>Author: {decodeURIComponent(author)}</h2>
          <span className="video-count">{authorVideos.length} video{authorVideos.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
      
      {authorVideos.length === 0 ? (
        <div className="no-videos">No videos found for this author.</div>
      ) : (
        <div className="videos-grid">
          {authorVideos.map(video => (
            <VideoCard 
              key={video.id} 
              video={video} 
              onDeleteVideo={onDeleteVideo}
              showDeleteButton={true}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default AuthorVideos; 