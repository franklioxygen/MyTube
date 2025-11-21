const path = require("path");

// Assuming the application is started from the 'backend' directory
const ROOT_DIR = process.cwd();

const UPLOADS_DIR = path.join(ROOT_DIR, "uploads");
const VIDEOS_DIR = path.join(UPLOADS_DIR, "videos");
const IMAGES_DIR = path.join(UPLOADS_DIR, "images");
const DATA_DIR = path.join(ROOT_DIR, "data");

const VIDEOS_DATA_PATH = path.join(DATA_DIR, "videos.json");
const STATUS_DATA_PATH = path.join(DATA_DIR, "status.json");
const COLLECTIONS_DATA_PATH = path.join(DATA_DIR, "collections.json");

module.exports = {
  ROOT_DIR,
  UPLOADS_DIR,
  VIDEOS_DIR,
  IMAGES_DIR,
  DATA_DIR,
  VIDEOS_DATA_PATH,
  STATUS_DATA_PATH,
  COLLECTIONS_DATA_PATH,
};
