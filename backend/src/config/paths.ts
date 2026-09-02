import path from "path";

// Assuming the application is started from the 'backend' directory
export const ROOT_DIR: string = process.cwd();

export const UPLOADS_DIR: string = path.join(ROOT_DIR, "uploads");
export const VIDEOS_DIR: string = path.join(UPLOADS_DIR, "videos");
export const IMAGES_DIR: string = path.join(UPLOADS_DIR, "images");
export const IMAGES_SMALL_DIR: string = path.join(UPLOADS_DIR, "images-small");
export const AVATARS_DIR: string = path.join(UPLOADS_DIR, "avatars");
export const SUBTITLES_DIR: string = path.join(UPLOADS_DIR, "subtitles");
export const CLOUD_THUMBNAIL_CACHE_DIR: string = path.join(
  UPLOADS_DIR,
  "cloud-thumbnail-cache"
);
// Where the database, generated secrets, hooks, and legacy JSON live. Defaults
// to <cwd>/data; MYTUBE_DATA_DIR relocates it, which lets a deployment keep
// state on a different volume from the code and lets the test suite run
// against a scratch directory instead of the developer's real database.
export const DATA_DIR: string = process.env.MYTUBE_DATA_DIR
  ? path.resolve(process.env.MYTUBE_DATA_DIR)
  : path.join(ROOT_DIR, "data");
export const COOKIES_FILENAME = "cookies.txt";

export const VIDEOS_DATA_PATH: string = path.join(DATA_DIR, "videos.json");
export const STATUS_DATA_PATH: string = path.join(DATA_DIR, "status.json");
export const COLLECTIONS_DATA_PATH: string = path.join(
  DATA_DIR,
  "collections.json"
);
export const HOOKS_DIR: string = path.join(DATA_DIR, "hooks");
