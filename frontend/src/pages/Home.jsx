import AuthorsList from '../components/AuthorsList';
import Collections from '../components/Collections';
import VideoCard from '../components/VideoCard';

const Home = ({ videos = [], loading, error, onDeleteVideo, collections }) => {
  // Add default empty array to ensure videos is always an array
  const videoArray = Array.isArray(videos) ? videos : [];

  if (loading && videoArray.length === 0) {
    return <div className="loading">Loading videos...</div>;
  }

  if (error && videoArray.length === 0) {
    return <div className="error">{error}</div>;
  }

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
            {videoArray.map(video => (
              <VideoCard 
                key={video.id} 
                video={video} 
                onDeleteVideo={onDeleteVideo}
                showDeleteButton={true}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Home; 