import multer from "multer";
import { VIDEOS_DIR } from "../../config/paths";
import { createVideoUploadStorage } from "../../utils/videoUpload";

const MAX_VIDEO_UPLOAD_FILE_SIZE = 100 * 1024 * 1024 * 1024;
const MAX_BATCH_UPLOAD_FILES = 100;
const MAX_BATCH_UPLOAD_TOTAL_SIZE = MAX_VIDEO_UPLOAD_FILE_SIZE;
const MAX_SINGLE_UPLOAD_FIELDS = 4;
const MAX_BATCH_UPLOAD_FIELDS = MAX_BATCH_UPLOAD_FILES + 4;

export const videoUploadStorage = createVideoUploadStorage(VIDEOS_DIR);
export const videoBatchUploadStorage = createVideoUploadStorage(VIDEOS_DIR, {
  maxTotalBytes: MAX_BATCH_UPLOAD_TOTAL_SIZE,
});

// Browsers send the multipart filename as raw UTF-8, but busboy decodes it as
// latin1 unless told otherwise, which garbles every non-ASCII name.
const UPLOAD_FILENAME_CHARSET = "utf8";

const videoUploadOptions: multer.Options = {
  storage: videoUploadStorage,
  defParamCharset: UPLOAD_FILENAME_CHARSET,
  limits: {
    fileSize: MAX_VIDEO_UPLOAD_FILE_SIZE,
    files: 1,
    fields: MAX_SINGLE_UPLOAD_FIELDS,
    parts: 1 + MAX_SINGLE_UPLOAD_FIELDS,
  },
};

const videoBatchUploadOptions: multer.Options = {
  storage: videoBatchUploadStorage,
  defParamCharset: UPLOAD_FILENAME_CHARSET,
  limits: {
    fileSize: MAX_VIDEO_UPLOAD_FILE_SIZE,
    files: MAX_BATCH_UPLOAD_FILES,
    fields: MAX_BATCH_UPLOAD_FIELDS,
    parts: MAX_BATCH_UPLOAD_FILES + MAX_BATCH_UPLOAD_FIELDS,
  },
};

export const upload = multer(videoUploadOptions);
export const uploadBatch = multer(videoBatchUploadOptions);

export const uploadSubtitleMiddleware = multer({
  storage: multer.memoryStorage(),
  defParamCharset: UPLOAD_FILENAME_CHARSET,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.match(/\.(vtt|srt|ass|ssa)$/i)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only .vtt, .srt, .ass and .ssa are allowed."
        )
      );
    }
  },
});
