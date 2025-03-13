import AuthorsList from '../components/AuthorsList';
import Collections from '../components/Collections';
import VideoCard from '../components/VideoCard';

const Home = ({ videos = [], loading, error, onDeleteVideo, collections = [] }) => {
  // Add default empty array to ensure videos is always an array
  const videoArray = Array.isArray(videos) ? videos : [];

  if (loading && videoArray.length === 0) {
    return <div className="loading">Loading videos...</div>;
  }

  if (error && videoArray.length === 0) {
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

export default Home; 