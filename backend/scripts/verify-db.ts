
import {
    addActiveDownload,
    Collection,
    deleteCollection,
    deleteVideo,
    getCollections,
    getDownloadStatus,
    getSettings,
    getVideoById,
    getVideos,
    removeActiveDownload,
    saveCollection,
    saveSettings,
    saveVideo,
    Video
} from '../src/services/storageService';

async function verify() {
  console.log('Starting verification...');

  // 1. Get Videos (should be empty initially)
  const videos = getVideos();
  console.log(`Initial videos count: ${videos.length}`);

  // 2. Save a Video
  const newVideo: Video = {
    id: 'test-video-1',
    title: 'Test Video',
    sourceUrl: 'http://example.com',
    createdAt: new Date().toISOString(),
    author: 'Test Author',
    source: 'local'
  };
  saveVideo(newVideo);
  console.log('Saved test video.');

  // 3. Get Video by ID
  const retrievedVideo = getVideoById('test-video-1');
  if (retrievedVideo && retrievedVideo.title === 'Test Video') {
    console.log('Retrieved video successfully.');
  } else {
    console.error('Failed to retrieve video.');
  }

  // 4. Save a Collection
  const newCollection: Collection = {
    id: 'test-collection-1',
    title: 'Test Collection',
    videos: ['test-video-1'],
    createdAt: new Date().toISOString()
  };
  saveCollection(newCollection);
  console.log('Saved test collection.');

  // 5. Get Collections
  const collections = getCollections();
  console.log(`Collections count: ${collections.length}`);
  const retrievedCollection = collections.find(c => c.id === 'test-collection-1');
  if (retrievedCollection && retrievedCollection.videos.includes('test-video-1')) {
    console.log('Retrieved collection with video link successfully.');
  } else {
    console.error('Failed to retrieve collection or video link.');
  }

  // 6. Delete Collection
  deleteCollection('test-collection-1');
  const collectionsAfterDelete = getCollections();
  if (collectionsAfterDelete.find(c => c.id === 'test-collection-1')) {
    console.error('Failed to delete collection.');
  } else {
    console.log('Deleted collection successfully.');
  }

  // 7. Delete Video
  deleteVideo('test-video-1');
  const videoAfterDelete = getVideoById('test-video-1');
  if (videoAfterDelete) {
    console.error('Failed to delete video.');
  } else {
    console.log('Deleted video successfully.');
  }

  // 8. Settings
  const initialSettings = getSettings();
  console.log('Initial settings:', initialSettings);
  saveSettings({ ...initialSettings, testKey: 'testValue' });
  const updatedSettings = getSettings();
  if (updatedSettings.testKey === 'testValue') {
    console.log('Settings saved and retrieved successfully.');
  } else {
    console.error('Failed to save/retrieve settings.');
  }

  // 9. Status (Active Downloads)
  addActiveDownload('test-download-1', 'Test Download');
  let status = getDownloadStatus();
  if (status.activeDownloads.find(d => d.id === 'test-download-1')) {
    console.log('Active download added successfully.');
  } else {
    console.error('Failed to add active download.');
  }

  removeActiveDownload('test-download-1');
  status = getDownloadStatus();
  if (status.activeDownloads.find(d => d.id === 'test-download-1')) {
    console.error('Failed to remove active download.');
  } else {
    console.log('Active download removed successfully.');
  }

  console.log('Verification finished.');
}

verify().catch(console.error);
