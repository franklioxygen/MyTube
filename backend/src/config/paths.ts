import path from "path";

// Assuming the application is started from the 'backend' directory
export const ROOT_DIR: string = process.cwd();

export const UPLOADS_DIR: string = path.join(ROOT_DIR, "uploads");
export const VIDEOS_DIR: string = path.join(UPLOADS_DIR, "videos");
export const IMAGES_DIR: string = path.join(UPLOADS_DIR, "images");
export const SUBTITLES_DIR: string = path.join(UPLOADS_DIR, "subtitles");
export const DATA_DIR: string = path.join(ROOT_DIR, "data");

export const VIDEOS_DATA_PATH: string = path.join(DATA_DIR, "videos.json");
export const STATUS_DATA_PATH: string = path.join(DATA_DIR, "status.json");
export const COLLECTIONS_DATA_PATH: string = path.join(DATA_DIR, "collections.json");
