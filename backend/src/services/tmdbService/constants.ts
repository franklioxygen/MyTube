export const TMDB_API_BASE = "https://api.themoviedb.org/3";
export const TMDB_API_ORIGIN = "https://api.themoviedb.org";
export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
export const TMDB_SEARCH_CACHE_MAX_ENTRIES = 500;
export const TMDB_SEARCH_CACHE_TTL_MS = 60 * 60 * 1000;
export const TMDB_NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000;
export const TMDB_REQUEST_TIMEOUT_MS = 10000;
export const ALLOWED_TMDB_API_HOSTS = ["api.themoviedb.org"];

// Whitelist of allowed hosts for image downloads to prevent SSRF
export const ALLOWED_IMAGE_HOSTS = ["image.tmdb.org"];

/**
 * Map frontend language codes to TMDB language codes
 * TMDB uses ISO 639-1 with region codes (e.g., en-US, zh-CN)
 */
export function mapLanguageToTMDB(language?: string): string {
  switch (language) {
    case "zh":
      return "zh-CN";
    case "es":
      return "es-ES";
    case "de":
      return "de-DE";
    case "ja":
      return "ja-JP";
    case "fr":
      return "fr-FR";
    case "ko":
      return "ko-KR";
    case "ar":
      return "ar-SA";
    case "pt":
      return "pt-BR";
    case "ru":
      return "ru-RU";
    case "en":
    default:
      return "en-US";
  }
}
