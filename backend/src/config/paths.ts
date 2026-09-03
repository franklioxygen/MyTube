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
// to <cwd>/data; MYTUBE_BACKEND_DATA_DIR relocates it, which lets a deployment
// keep state on a different volume from the code and lets the test suite run
// against a scratch directory instead of the developer's real database.
//
// Deliberately NOT MYTUBE_DATA_DIR: the shipped Compose stack and the Docker
// guide document that name as the HOST side of the `<host>:/app/data` bind
// mount, so its value is a host path such as "../data". Reading it here as a
// container path pointed the backend at a directory that does not hold the
// mounted database, and entrypoint.sh (which has read it the same way since
// v1.9) had already created it, so the backend opened a brand new database
// instead of failing. A fresh database defaults to loginEnabled: false, and
// isLoginRequired() then reports that no login is needed - an upgrade turned a
// password-protected instance into a public one.
export const DATA_DIR: string = process.env.MYTUBE_BACKEND_DATA_DIR
  ? path.resolve(process.env.MYTUBE_BACKEND_DATA_DIR)
  : path.join(ROOT_DIR, "data");
export const COOKIES_FILENAME = "cookies.txt";

export const VIDEOS_DATA_PATH: string = path.join(DATA_DIR, "videos.json");
export const STATUS_DATA_PATH: string = path.join(DATA_DIR, "status.json");
export const COLLECTIONS_DATA_PATH: string = path.join(
  DATA_DIR,
  "collections.json"
);
export const HOOKS_DIR: string = path.join(DATA_DIR, "hooks");
