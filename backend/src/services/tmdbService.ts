import axios from "axios";
import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR } from "../config/paths";
import { logger } from "../utils/logger";
import { getSettings } from "./storageService/settings";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

// Whitelist of allowed hosts for image downloads to prevent SSRF
const ALLOWED_IMAGE_HOSTS = ["image.tmdb.org"];

// Whitelist of allowed base URLs to prevent SSRF (following OWASP pattern)
const ALLOWED_IMAGE_URLS = ["https://image.tmdb.org/t/p/w500"];

/**
 * Map frontend language codes to TMDB language codes
 * TMDB uses ISO 639-1 with region codes (e.g., en-US, zh-CN)
 */
function mapLanguageToTMDB(language?: string): string {
  if (!language) return "en-US";

  const languageMap: Record<string, string> = {
    en: "en-US",
    zh: "zh-CN",
    es: "es-ES",
    de: "de-DE",
    ja: "ja-JP",
    fr: "fr-FR",
    ko: "ko-KR",
    ar: "ar-SA",
    pt: "pt-BR",
    ru: "ru-RU",
  };

  return languageMap[language] || "en-US";
}

export interface TMDBMovieResult {
  id: number;
  title: string;
  release_date?: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  vote_average?: number;
  genres?: Array<{ id: number; name: string }>;
}

export interface TMDBTVResult {
  id: number;
  name: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  vote_average?: number;
  genres?: Array<{ id: number; name: string }>;
  created_by?: Array<{ id: number; name: string }>;
}

export interface TMDBSearchResult {
  media_type: "movie" | "tv" | "person";
  id: number;
  title?: string; // For movies
  name?: string; // For TV shows
  release_date?: string; // For movies
  first_air_date?: string; // For TV shows
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  vote_average?: number;
  popularity?: number;
}

export interface ParsedFilename {
  titles: string[]; // Multiple title candidates (Chinese, English, alternative)
  year?: number;
  season?: number;
  episode?: number;
  isTVShow: boolean;
  quality?: string; // 1080p, 720p, etc.
  source?: string; // WEB-DL, BluRay, etc.
}

/**
 * Enhanced filename parser that extracts multiple titles, year from anywhere,
 * removes quality/format metadata, and handles multi-language filenames
 *
 * Examples:
 * - "有话好好说[简中硬字].Keep.Cool.1997.1080p.WEB-DL.H265.AAC-LeagueWEB.webm"
 * - "The.Matrix.1999.1080p.BluRay.x264-DTS.mkv"
 * - "Game.of.Thrones.S01E01.720p.HDTV.mkv"
 */
export function parseFilename(filename: string): ParsedFilename {
  // Remove file extension
  let nameWithoutExt = path.parse(filename).name;
  let isTVShow = false;
  let season: number | undefined;
  let episode: number | undefined;
  let year: number | undefined;
  let quality: string | undefined;
  let source: string | undefined;

  // Check for TV show format: S01E01 or S1E1 (before other processing)
  const tvShowMatch = nameWithoutExt.match(/^(.+?)\s*[Ss](\d+)[Ee](\d+)/);
  if (tvShowMatch) {
    isTVShow = true;
    season = parseInt(tvShowMatch[2], 10);
    episode = parseInt(tvShowMatch[3], 10);
    nameWithoutExt = tvShowMatch[1].trim();
  } else {
    // Check for "Season X Episode Y" format
    const seasonEpisodeMatch = nameWithoutExt.match(
      /^(.+?)\s*[Ss]eason\s*(\d+)\s*[Ee]pisode\s*(\d+)/i
    );
    if (seasonEpisodeMatch) {
      isTVShow = true;
      season = parseInt(seasonEpisodeMatch[2], 10);
      episode = parseInt(seasonEpisodeMatch[3], 10);
      nameWithoutExt = seasonEpisodeMatch[1].trim();
    }
  }

  // Extract year from anywhere in filename (1900-2100)
  const yearMatches = nameWithoutExt.match(/\b(19\d{2}|20[0-1]\d|202[0-9])\b/);
  if (yearMatches) {
    const extractedYear = parseInt(yearMatches[1], 10);
    if (extractedYear >= 1900 && extractedYear <= 2100) {
      year = extractedYear;
      // Remove year from name for title extraction
      nameWithoutExt = nameWithoutExt.replace(/\b\d{4}\b/, "").trim();
    }
  }

  // Extract and remove quality info (1080p, 720p, 4K, 2160p, etc.)
  const qualityPattern = /\b(\d+p|\d+x\d+|\d+i|4K|8K|2160p|1440p)\b/gi;
  const qualityMatch = nameWithoutExt.match(qualityPattern);
  if (qualityMatch) {
    quality = qualityMatch[0].toUpperCase();
    nameWithoutExt = nameWithoutExt.replace(qualityPattern, "").trim();
  }

  // Also remove standalone resolution numbers (e.g., "1080", "720" when not followed by p)
  nameWithoutExt = nameWithoutExt
    .replace(/\b(1080|720|480|360|240|1440|2160)\b(?![pxi])/gi, "")
    .trim();

  // Extract and remove source/format info (WEB-DL, BluRay, DVD, HDTV, etc.)
  // Remove these patterns completely - they're not part of the title
  const sourcePatterns = [
    /\bWEB-DL\b/i,
    /\bWEBRip\b/i,
    /\bWEB\b(?![^\s.])/i, // WEB but not as part of other words
    /\bBluRay\b/i,
    /\bBDRip\b/i,
    /\bBD\b(?![^\s.])/i,
    /\bDVD\b/i,
    /\bDVDRip\b/i,
    /\bHDTV\b/i,
    /\bHDRip\b/i,
    /\bCAM\b/i,
    /\bTS\b(?![^\s.])/i, // TS but not part of other words
    /\bTELESYNC\b/i,
    /\bTELECINE\b/i,
    /\bR5\b/i,
    /\bSCR\b/i,
    /\bSCREENER\b/i,
  ];

  for (const pattern of sourcePatterns) {
    const sourceMatch = nameWithoutExt.match(pattern);
    if (sourceMatch && !source) {
      source = sourceMatch[0];
    }
    nameWithoutExt = nameWithoutExt.replace(pattern, "").trim();
  }

  // Remove codec info (H265, H264, HEVC, x264, x265, AV1, VP9)
  nameWithoutExt = nameWithoutExt
    .replace(/\b(H26[45]|HEVC|x26[45]|VP9|AV1|H\.26[45])\b/gi, "")
    .trim();

  // Remove audio codec info (AAC, AC3, DTS, FLAC, MP3, Vorbis)
  nameWithoutExt = nameWithoutExt
    .replace(/\b(AAC|AC3|DTS|FLAC|MP3|Vorbis|EAC3|TrueHD|Atmos)\b/gi, "")
    .trim();

  // Remove release group names (usually at end after dash: -GroupName or standalone)
  // Match patterns like: -GroupName, [GroupName], or standalone capitalized words at end
  nameWithoutExt = nameWithoutExt
    .replace(/[-_]?[A-Z][a-zA-Z0-9]{2,}(?:\.[a-zA-Z0-9]+)*\s*$/, "")
    .trim();
  nameWithoutExt = nameWithoutExt
    .replace(/\[[A-Z][a-zA-Z0-9]+\]\s*$/, "")
    .trim();

  // Remove common video format acronyms that might remain
  nameWithoutExt = nameWithoutExt
    .replace(/\b(Rip|Remux|Mux|Enc|Dec)\b/gi, "")
    .trim();

  // Remove bracketed metadata FIRST (like [简中硬字], but preserve year in parentheses)
  // This ensures we can extract Chinese titles cleanly
  nameWithoutExt = nameWithoutExt.replace(/\[[^\]]+\]/g, "").trim();

  // Extract Chinese/Unicode titles AFTER removing brackets
  // Chinese text often appears before English title
  const chineseMatches: string[] = [];
  const chinesePattern = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/g;
  const nameForChineseExtraction = nameWithoutExt;
  let chineseMatch;
  while (
    (chineseMatch = chinesePattern.exec(nameForChineseExtraction)) !== null
  ) {
    const chineseText = chineseMatch[0].trim();
    // Only add substantial Chinese text (not single characters that might be metadata)
    if (chineseText.length >= 2 && !chineseMatches.includes(chineseText)) {
      chineseMatches.push(chineseText);
    }
  }

  // Remove quality/resolution patterns that might remain
  nameWithoutExt = nameWithoutExt.replace(/\b\d{3,4}p\b/i, "").trim();

  // Extract multiple title candidates
  // Split on common separators: dots, dashes, underscores
  const segments = nameWithoutExt
    .split(/[._-]+/)
    .filter((s) => s.trim().length > 0);

  // Identify potential titles (longer segments, non-purely-numeric)
  const titleCandidates: string[] = [];
  const seen: Set<string> = new Set();

  // Add Chinese titles first (extracted before processing)
  for (const chineseTitle of chineseMatches) {
    if (chineseTitle.length >= 2 && !seen.has(chineseTitle.toLowerCase())) {
      titleCandidates.push(chineseTitle);
      seen.add(chineseTitle.toLowerCase());
    }
  }

  // Process English segments, filtering out metadata and combining title words
  const englishWords: string[] = [];
  // Common metadata terms to exclude (not part of titles)
  const metadataTerms = new Set([
    "web",
    "dl",
    "rip",
    "remux",
    "mux",
    "enc",
    "dec",
    "hd",
    "sd",
    "uhd",
    "bluray",
    "bd",
    "dvd",
    "hdtv",
    "cam",
    "ts",
    "tc",
    "r5",
    "scr",
    "screener",
    "h264",
    "h265",
    "hevc",
    "x264",
    "x265",
    "av1",
    "vp9",
    "aac",
    "ac3",
    "dts",
    "flac",
    "mp3",
    "eac3",
    "truehd",
    "atmos",
    "admin",
    "upload",
    "download",
  ]);

  for (const segment of segments) {
    const trimmed = segment.trim();
    const lowerTrimmed = trimmed.toLowerCase();

    // Skip purely numeric segments, very short segments, or common non-title words
    if (
      trimmed.length < 2 ||
      /^\d+$/.test(trimmed) ||
      /^(the|a|an|and|or|of|in|on|at|to|for)$/i.test(trimmed) ||
      /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(trimmed) || // Skip if contains Chinese (already handled)
      metadataTerms.has(lowerTrimmed) || // Skip metadata terms
      /^\d+p$/i.test(trimmed) || // Skip quality like "1080p" that might have slipped through
      /^(web|dl|rip|remux|mux)$/i.test(trimmed) // Skip common format terms
    ) {
      continue;
    }

    // Clean up the segment
    let cleanTitle = trimmed
      .replace(/^\W+|\W+$/g, "") // Remove leading/trailing non-word chars
      .trim();

    // Additional check: skip if it's clearly metadata (all caps short word, numbers, etc.)
    if (
      cleanTitle.length >= 2 &&
      !/^\d+$/.test(cleanTitle) &&
      !/^[A-Z]{2,5}$/.test(cleanTitle) // Skip all-caps acronyms (likely metadata)
    ) {
      englishWords.push(cleanTitle);
    }
  }

  // Combine consecutive short English words (like "Keep" + "Cool" = "Keep Cool")
  // First, try all combinations (prioritize longer, more complete titles)
  const englishCombinations: string[] = [];
  const maxSingleWordLength = 8; // Words longer than this are likely complete standalone titles

  if (englishWords.length > 0) {
    // Try full combination first (most complete)
    if (englishWords.length <= 5) {
      const fullCombined = englishWords.join(" ");
      if (!seen.has(fullCombined.toLowerCase()) && fullCombined.length >= 4) {
        englishCombinations.push(fullCombined);
        seen.add(fullCombined.toLowerCase());
      }
    }

    // Try consecutive pairs (like "Keep.Cool" = "Keep Cool")
    if (englishWords.length >= 2) {
      for (let i = 0; i < englishWords.length - 1; i++) {
        const combined = `${englishWords[i]} ${englishWords[i + 1]}`;
        if (!seen.has(combined.toLowerCase()) && combined.length >= 4) {
          englishCombinations.push(combined);
          seen.add(combined.toLowerCase());
        }
      }
    }

    // Sort combinations by length (longer = better, likely more complete)
    englishCombinations.sort((a, b) => b.length - a.length);

    // Add combinations to title candidates (before individual words)
    // These are higher priority because they're more complete titles
    for (const combo of englishCombinations) {
      if (!titleCandidates.includes(combo)) {
        titleCandidates.push(combo);
      }
    }

    // Then add individual words as fallback (only shorter words that aren't already in combinations)
    // Skip words that are part of combinations (already included)
    for (const word of englishWords) {
      // Check if word is already part of a combination
      const isPartOfCombo = englishCombinations.some((combo) =>
        combo.toLowerCase().includes(word.toLowerCase())
      );

      // Only add standalone if it's a longer word OR it's not part of any combination
      if (!isPartOfCombo && !seen.has(word.toLowerCase())) {
        // Add shorter words too (they might be searched individually if combo fails)
        if (word.length <= maxSingleWordLength && word.length >= 2) {
          titleCandidates.push(word);
          seen.add(word.toLowerCase());
        } else if (word.length > maxSingleWordLength) {
          // Longer words are definitely standalone titles
          titleCandidates.push(word);
          seen.add(word.toLowerCase());
        }
      }
    }
  }

  // Reorder titles by priority: longer/combined titles first, Chinese titles prioritized
  if (titleCandidates.length > 0) {
    const chineseTitles = titleCandidates.filter((t) =>
      /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(t)
    );
    const englishTitles = titleCandidates.filter((t) =>
      /^[a-zA-Z0-9\s]+$/.test(t)
    );

    // Sort English titles by length (longer = more likely to be complete)
    // Prioritize multi-word titles (containing spaces) over single words
    englishTitles.sort((a, b) => {
      const aHasSpace = a.includes(" ");
      const bHasSpace = b.includes(" ");
      if (aHasSpace && !bHasSpace) return -1; // Multi-word first
      if (!aHasSpace && bHasSpace) return 1;
      return b.length - a.length; // Then by length
    });

    // Build ordered list: Chinese first, then longer/multi-word English titles, then shorter
    const orderedTitles: string[] = [];

    // Add Chinese titles first (highest priority)
    if (chineseTitles.length > 0) {
      orderedTitles.push(...chineseTitles);
    }

    // Add multi-word English combinations first (before single words)
    const multiWordEnglish = englishTitles.filter((t) => t.includes(" "));
    const singleWordEnglish = englishTitles.filter((t) => !t.includes(" "));

    if (multiWordEnglish.length > 0) {
      orderedTitles.push(...multiWordEnglish);
    }

    // Then add single-word English titles (as fallback)
    if (singleWordEnglish.length > 0) {
      orderedTitles.push(...singleWordEnglish);
    }

    // Also try combined title (common pattern: Chinese + English)
    if (chineseTitles.length > 0 && englishTitles.length > 0) {
      // Use the first (best) English title - which should be the longest/multi-word
      const bestEnglishTitle = englishTitles[0];
      const combined = `${chineseTitles[0]} ${bestEnglishTitle}`;
      if (!orderedTitles.includes(combined)) {
        // Insert combined title right after Chinese titles
        orderedTitles.splice(chineseTitles.length, 0, combined);
      }
    }

    return {
      titles: orderedTitles.length > 0 ? orderedTitles : titleCandidates,
      year,
      season,
      episode,
      isTVShow,
      quality,
      source,
    };
  }

  // Fallback: combine remaining segments or use as-is
  if (titleCandidates.length === 0) {
    // Last resort: use cleaned filename
    const fallbackTitle = nameWithoutExt
      .replace(/[._-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return {
      titles: fallbackTitle ? [fallbackTitle] : [path.parse(filename).name],
      year,
      season,
      episode,
      isTVShow,
      quality,
      source,
    };
  }

  // For single or multiple candidates, return them
  return {
    titles: titleCandidates,
    year,
    season,
    episode,
    isTVShow,
    quality,
    source,
  };
}

/**
 * Search for a movie on TMDB with language support
 */
async function searchMovie(
  title: string,
  apiKey: string,
  year?: number,
  language?: string
): Promise<TMDBMovieResult | null> {
  try {
    const tmdbLanguage = mapLanguageToTMDB(language);
    const params: Record<string, string> = {
      api_key: apiKey,
      query: title,
      language: tmdbLanguage,
    };

    if (year) {
      params.year = year.toString();
    }

    const response = await axios.get(`${TMDB_API_BASE}/search/movie`, {
      params,
      timeout: 10000,
    });

    const results: TMDBMovieResult[] = response.data.results || [];
    if (results.length > 0) {
      // Prefer exact year match if year was provided
      if (year) {
        const yearMatch = results.find((movie) => {
          if (!movie.release_date) return false;
          const movieYear = parseInt(movie.release_date.substring(0, 4), 10);
          return movieYear === year;
        });
        if (yearMatch) {
          // Fetch full details with language to get localized poster_path and title
          const details = await getMovieDetails(yearMatch.id, apiKey, tmdbLanguage);
          return details?.movie || null;
        }
      }
      // Fetch full details for the first result with language
      const details = await getMovieDetails(results[0].id, apiKey, tmdbLanguage);
      return details?.movie || null;
    }

    return null;
  } catch (error) {
    logger.error(`Error searching TMDB for movie "${title}":`, error);
    return null;
  }
}

/**
 * Get full movie details from TMDB with language support
 * Also fetches credits to get director information
 */
async function getMovieDetails(
  movieId: number,
  apiKey: string,
  language: string
): Promise<{ movie: TMDBMovieResult; director?: string } | null> {
  try {
    // Fetch both movie details and credits in parallel
    const [movieResponse, creditsResponse] = await Promise.all([
      axios.get(`${TMDB_API_BASE}/movie/${movieId}`, {
        params: {
          api_key: apiKey,
          language: language,
        },
        timeout: 10000,
      }),
      axios.get(`${TMDB_API_BASE}/movie/${movieId}/credits`, {
        params: {
          api_key: apiKey,
          language: language,
        },
        timeout: 10000,
      }),
    ]);

    const movie = movieResponse.data as TMDBMovieResult;
    
    // Extract director from crew
    let director: string | undefined;
    if (creditsResponse.data?.crew) {
      const directorCrew = creditsResponse.data.crew.find(
        (member: any) => member.job === "Director"
      );
      if (directorCrew && directorCrew.name) {
        director = directorCrew.name;
      }
    }

    return { movie, director };
  } catch (error) {
    logger.error(`Error fetching TMDB movie details for ID ${movieId}:`, error);
    return null;
  }
}

/**
 * Search for a TV show on TMDB with language support
 */
async function searchTVShow(
  title: string,
  apiKey: string,
  language?: string
): Promise<TMDBTVResult | null> {
  try {
    const tmdbLanguage = mapLanguageToTMDB(language);
    const response = await axios.get(`${TMDB_API_BASE}/search/tv`, {
      params: {
        api_key: apiKey,
        query: title,
        language: tmdbLanguage,
      },
      timeout: 10000,
    });

    const results: TMDBTVResult[] = response.data.results || [];
    if (results.length > 0) {
      // Fetch full details with language to get localized poster_path and title
      const details = await getTVShowDetails(results[0].id, apiKey, tmdbLanguage);
      return details?.tv || null;
    }

    return null;
  } catch (error) {
    logger.error(`Error searching TMDB for TV show "${title}":`, error);
    return null;
  }
}

/**
 * Get full TV show details from TMDB with language support
 * Also fetches credits to get creator/director information
 */
async function getTVShowDetails(
  tvId: number,
  apiKey: string,
  language: string
): Promise<{ tv: TMDBTVResult; director?: string } | null> {
  try {
    // Fetch both TV show details and credits in parallel
    const [tvResponse, creditsResponse] = await Promise.all([
      axios.get(`${TMDB_API_BASE}/tv/${tvId}`, {
        params: {
          api_key: apiKey,
          language: language,
        },
        timeout: 10000,
      }),
      axios.get(`${TMDB_API_BASE}/tv/${tvId}/credits`, {
        params: {
          api_key: apiKey,
          language: language,
        },
        timeout: 10000,
      }),
    ]);

    const tv = tvResponse.data as TMDBTVResult;
    
    // Extract director/creator from TV show
    // Priority: 1) Creator from created_by array, 2) Director from crew
    let director: string | undefined;
    
    // First, try to get creator from created_by array
    if (tv.created_by && tv.created_by.length > 0 && tv.created_by[0].name) {
      director = tv.created_by[0].name;
    } else if (creditsResponse.data?.crew) {
      // Fallback to director from crew
      const directorCrew = creditsResponse.data.crew.find(
        (member: any) => member.job === "Director" || member.job === "Executive Producer"
      );
      if (directorCrew && directorCrew.name) {
        director = directorCrew.name;
      }
    }

    return { tv, director };
  } catch (error) {
    logger.error(`Error fetching TMDB TV show details for ID ${tvId}:`, error);
    return null;
  }
}

/**
 * Search TMDB using multi-search API (searches both movies and TV simultaneously)
 * Returns localized results based on language parameter
 */
async function searchTMDBSingle(
  title: string,
  apiKey: string,
  year?: number,
  language?: string
): Promise<{
  result: TMDBMovieResult | TMDBTVResult | null;
  mediaType: "movie" | "tv" | null;
  director?: string;
}> {
  try {
    const tmdbLanguage = mapLanguageToTMDB(language);
    const params: Record<string, string> = {
      api_key: apiKey,
      query: title,
      language: tmdbLanguage,
    };

    if (year) {
      params.year = year.toString();
    }

    const response = await axios.get(`${TMDB_API_BASE}/search/multi`, {
      params,
      timeout: 10000,
    });

    const results: TMDBSearchResult[] = response.data.results || [];

    if (results.length === 0) {
      return { result: null, mediaType: null };
    }

    // Filter by media type and find best match
    let bestMatch: TMDBSearchResult | null = null;
    let bestScore = -1;

    for (const item of results) {
      if (item.media_type !== "movie" && item.media_type !== "tv") {
        continue;
      }

      let score = (item.popularity || 0) * 0.5;

      // Year matching bonus
      if (year && item.media_type === "movie" && item.release_date) {
        const itemYear = parseInt(item.release_date.substring(0, 4), 10);
        if (itemYear === year) {
          score += 100; // Big bonus for exact year match
        } else if (Math.abs(itemYear - year) <= 1) {
          score += 50; // Smaller bonus for close year
        }
      } else if (year && item.media_type === "tv" && item.first_air_date) {
        const itemYear = parseInt(item.first_air_date.substring(0, 4), 10);
        if (itemYear === year) {
          score += 100;
        } else if (Math.abs(itemYear - year) <= 1) {
          score += 50;
        }
      }

      // Vote average bonus
      if (item.vote_average) {
        score += item.vote_average * 10;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = item;
      }
    }

    if (!bestMatch) {
      return { result: null, mediaType: null };
    }

    // Fetch full details with language to get localized poster_path, title, and overview
    if (bestMatch.media_type === "movie") {
      const movieDetails = await getMovieDetails(
        bestMatch.id,
        apiKey,
        tmdbLanguage
      );
      if (movieDetails?.movie) {
        return {
          result: movieDetails.movie,
          mediaType: "movie",
          director: movieDetails.director,
        };
      }
    } else if (bestMatch.media_type === "tv") {
      const tvDetails = await getTVShowDetails(
        bestMatch.id,
        apiKey,
        tmdbLanguage
      );
      if (tvDetails?.tv) {
        return {
          result: tvDetails.tv,
          mediaType: "tv",
          director: tvDetails.director,
        };
      }
    }

    // Fallback to search result if details fetch fails
    if (bestMatch.media_type === "movie") {
      return {
        result: {
          id: bestMatch.id,
          title: bestMatch.title || "",
          release_date: bestMatch.release_date,
          overview: bestMatch.overview,
          poster_path: bestMatch.poster_path,
          backdrop_path: bestMatch.backdrop_path,
          vote_average: bestMatch.vote_average,
        },
        mediaType: "movie",
      };
    } else if (bestMatch.media_type === "tv") {
      return {
        result: {
          id: bestMatch.id,
          name: bestMatch.name || "",
          first_air_date: bestMatch.first_air_date,
          overview: bestMatch.overview,
          poster_path: bestMatch.poster_path,
          backdrop_path: bestMatch.backdrop_path,
          vote_average: bestMatch.vote_average,
        },
        mediaType: "tv",
      };
    }

    return { result: null, mediaType: null };
  } catch (error) {
    logger.error(`Error searching TMDB multi for "${title}":`, error);
    return { result: null, mediaType: null };
  }
}

/**
 * Validate URL against whitelist to prevent SSRF (following OWASP pattern)
 * Returns validated URL if it passes all checks, null otherwise
 */
function validateUrlAgainstWhitelist(posterPath: string): string | null {
  // Validate poster path to prevent path traversal
  if (!posterPath || posterPath.includes("..") || !posterPath.startsWith("/")) {
    logger.error(`Invalid poster path: ${posterPath}`);
    return null;
  }

  // Sanitize posterPath to remove dangerous characters
  const safePosterPath = posterPath.replace(/[^a-zA-Z0-9/._-]/g, "");

  // Construct URL from validated components
  const imageUrl = `${TMDB_IMAGE_BASE}${safePosterPath}`;

  // Parse and validate URL structure
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(imageUrl);
  } catch (error) {
    logger.error(`Invalid image URL format: ${imageUrl}`, error);
    return null;
  }

  // Verify protocol is HTTPS
  if (parsedUrl.protocol !== "https:") {
    logger.error(`Invalid protocol (must be HTTPS): ${imageUrl}`);
    return null;
  }

  // Verify hostname is in whitelist (SSRF prevention)
  if (!ALLOWED_IMAGE_HOSTS.includes(parsedUrl.hostname)) {
    logger.error(
      `Invalid hostname (not in whitelist): ${
        parsedUrl.hostname
      }. Allowed: ${ALLOWED_IMAGE_HOSTS.join(", ")}`
    );
    return null;
  }

  // Verify path matches expected TMDB image path pattern
  if (!parsedUrl.pathname.startsWith("/t/p/")) {
    logger.error(`Invalid path (not TMDB image path): ${parsedUrl.pathname}`);
    return null;
  }

  // Verify URL matches allowed pattern using regex
  const allowedUrlPattern = /^https:\/\/image\.tmdb\.org\/t\/p\/[^?#]+$/;
  if (!allowedUrlPattern.test(imageUrl)) {
    logger.error(`Invalid image URL pattern: ${imageUrl}`);
    return null;
  }

  // Rebuild URL from validated components only
  const validatedUrl = `https://${parsedUrl.hostname}${parsedUrl.pathname}`;

  // Final whitelist check: verify URL starts with allowed base (SSRF prevention)
  // Following OWASP SSRF prevention pattern: whitelist check before using URL
  const urlMatchesWhitelist = ALLOWED_IMAGE_URLS.some((allowedBase) =>
    validatedUrl.startsWith(allowedBase)
  );

  if (!urlMatchesWhitelist) {
    logger.error(`URL does not match whitelist: ${validatedUrl}`);
    return null;
  }

  return validatedUrl;
}

/**
 * Download poster image from TMDB
 * Note: TMDB images are public and don't require authentication
 */
async function downloadPoster(
  posterPath: string,
  savePath: string
): Promise<boolean> {
  try {
    // Validate URL against whitelist to prevent SSRF
    // Following OWASP SSRF prevention pattern: check whitelist before request
    const validatedUrl = validateUrlAgainstWhitelist(posterPath);

    if (!validatedUrl) {
      logger.error(`URL validation failed for poster path: ${posterPath}`);
      return false;
    }

    // Whitelist check: only proceed if URL matches whitelist pattern (SSRF prevention)
    // Following OWASP example: check whitelist.includes(url) before request
    // Since we can't have all URLs in whitelist, we check if URL matches allowed pattern
    const urlMatchesWhitelistPattern = ALLOWED_IMAGE_URLS.some((allowedBase) =>
      validatedUrl.startsWith(allowedBase)
    );

    if (!urlMatchesWhitelistPattern) {
      logger.error(`URL does not match whitelist pattern: ${validatedUrl}`);
      return false;
    }

    // Final whitelist check: verify hostname is in whitelist (double-check SSRF protection)
    const urlObj = new URL(validatedUrl);
    if (!ALLOWED_IMAGE_HOSTS.includes(urlObj.hostname)) {
      logger.error(`Hostname not in whitelist: ${urlObj.hostname}`);
      return false;
    }

    // Whitelist validation complete - safe to make request
    // Following SSRF prevention pattern: only make request if URL passes all whitelist checks
    // Using the validated URL that has passed all whitelist validation
    const response = await axios.get(validatedUrl, {
      responseType: "arraybuffer",
      timeout: 10000,
    });

    // Normalize and validate save path to prevent path traversal
    const normalizedSavePath = path.normalize(savePath);
    const imagesDirNormalized = path.normalize(IMAGES_DIR);

    if (!normalizedSavePath.startsWith(imagesDirNormalized)) {
      logger.error(
        `Invalid save path (outside IMAGES_DIR): ${normalizedSavePath}`
      );
      return false;
    }

    // Ensure directory exists
    await fs.ensureDir(path.dirname(normalizedSavePath));

    // Save image
    await fs.writeFile(normalizedSavePath, response.data);

    logger.info(`Downloaded poster to ${normalizedSavePath}`);
    return true;
  } catch (error) {
    logger.error(`Error downloading poster from ${posterPath}:`, error);
    return false;
  }
}

/**
 * Multi-strategy search for TMDB metadata using fallback mechanisms
 * Tries multiple titles and search strategies to find best match
 * Supports language parameter for localized results
 */
async function searchTMDBMultiStrategy(
  parsed: ParsedFilename,
  apiKey: string,
  language?: string
): Promise<{
  result: TMDBMovieResult | TMDBTVResult | null;
  mediaType: "movie" | "tv" | null;
  strategy: string;
  director?: string;
}> {
  const titles = parsed.titles.length > 0 ? parsed.titles : ["Unknown"];

  logger.info(
    `[TMDB Multi-Strategy] Searching with ${
      titles.length
    } title(s): ${titles.join(", ")}, Year: ${
      parsed.year || "N/A"
    }, Language: ${language || "en"}`
  );

  // Strategy 1: Try TMDB multi-search API with each title + year (most efficient)
  // Try longer/multi-word titles first, then shorter ones
  const sortedTitles = [...titles].sort((a, b) => {
    // Prioritize multi-word titles (containing spaces)
    const aHasSpace = a.includes(" ");
    const bHasSpace = b.includes(" ");
    if (aHasSpace && !bHasSpace) return -1;
    if (!aHasSpace && bHasSpace) return 1;
    // Then by length (longer first)
    return b.length - a.length;
  });

  if (parsed.year && sortedTitles.length > 0) {
    // Try each title with year (prioritize longer/multi-word)
    for (const title of sortedTitles) {
      logger.info(
        `[TMDB Multi-Strategy] Strategy 1: Multi-search with "${title}" + year ${parsed.year}`
      );
      const multiResult = await searchTMDBSingle(
        title,
        apiKey,
        parsed.year,
        language
      );
      if (multiResult.result) {
        // Verify the match makes sense (year should be close)
        let yearMatch = true;
        if (
          multiResult.mediaType === "movie" &&
          "release_date" in multiResult.result &&
          multiResult.result.release_date
        ) {
          const resultYear = parseInt(
            multiResult.result.release_date.substring(0, 4),
            10
          );
          yearMatch =
            resultYear === parsed.year ||
            Math.abs(resultYear - parsed.year) <= 1;
        } else if (
          multiResult.mediaType === "tv" &&
          "first_air_date" in multiResult.result &&
          multiResult.result.first_air_date
        ) {
          const resultYear = parseInt(
            multiResult.result.first_air_date.substring(0, 4),
            10
          );
          yearMatch =
            resultYear === parsed.year ||
            Math.abs(resultYear - parsed.year) <= 1;
        }

        if (yearMatch) {
          logger.info(
            `[TMDB Multi-Strategy] Strategy 1 succeeded: Found ${multiResult.mediaType} match for "${title}"`
          );
          return { ...multiResult, strategy: "multi-search-with-year" };
        } else {
          logger.info(
            `[TMDB Multi-Strategy] Strategy 1: Year mismatch for "${title}", trying next title...`
          );
        }
      }
    }
  }

  // Strategy 2: Try each title with year on dedicated endpoints
  for (const title of titles) {
    if (parsed.year) {
      if (parsed.isTVShow) {
        logger.info(
          `[TMDB Multi-Strategy] Strategy 2a: TV search "${title}" + year ${parsed.year}`
        );
        const tvResult = await searchTVShow(title, apiKey, language);
        if (tvResult && tvResult.first_air_date) {
          const resultYear = parseInt(
            tvResult.first_air_date.substring(0, 4),
            10
          );
          if (
            resultYear === parsed.year ||
            Math.abs(resultYear - parsed.year) <= 1
          ) {
            logger.info(
              `[TMDB Multi-Strategy] Strategy 2a succeeded: Found TV match`
            );
            // Get director from full details
            const details = await getTVShowDetails(tvResult.id, apiKey, mapLanguageToTMDB(language));
            return {
              result: tvResult,
              mediaType: "tv",
              strategy: "tv-search-with-year",
              director: details?.director,
            };
          }
        }
      } else {
        logger.info(
          `[TMDB Multi-Strategy] Strategy 2b: Movie search "${title}" + year ${parsed.year}`
        );
        const movieResult = await searchMovie(
          title,
          apiKey,
          parsed.year,
          language
        );
        if (movieResult) {
          logger.info(
            `[TMDB Multi-Strategy] Strategy 2b succeeded: Found movie match`
          );
          // Get director from full details
          const details = await getMovieDetails(movieResult.id, apiKey, mapLanguageToTMDB(language));
          return {
            result: movieResult,
            mediaType: "movie",
            strategy: "movie-search-with-year",
            director: details?.director,
          };
        }
      }
    }
  }

  // Strategy 3: Try TMDB multi-search without year constraint
  for (const title of titles) {
    logger.info(
      `[TMDB Multi-Strategy] Strategy 3: Multi-search "${title}" (no year)`
    );
    const multiResult = await searchTMDBSingle(
      title,
      apiKey,
      undefined,
      language
    );
    if (multiResult.result) {
      logger.info(
        `[TMDB Multi-Strategy] Strategy 3 succeeded: Found ${multiResult.mediaType} match`
      );
      return { ...multiResult, strategy: "multi-search-no-year" };
    }
  }

  // Strategy 4: Try each title without year on dedicated endpoints
  for (const title of titles) {
    if (parsed.isTVShow) {
      logger.info(
        `[TMDB Multi-Strategy] Strategy 4a: TV search "${title}" (no year)`
      );
      const tvResult = await searchTVShow(title, apiKey, language);
      if (tvResult) {
        logger.info(
          `[TMDB Multi-Strategy] Strategy 4a succeeded: Found TV match`
        );
        // Get director from full details
        const details = await getTVShowDetails(tvResult.id, apiKey, mapLanguageToTMDB(language));
        return {
          result: tvResult,
          mediaType: "tv",
          strategy: "tv-search-no-year",
          director: details?.director,
        };
      }
    } else {
      logger.info(
        `[TMDB Multi-Strategy] Strategy 4b: Movie search "${title}" (no year)`
      );
      const movieResult = await searchMovie(title, apiKey, undefined, language);
      if (movieResult) {
        logger.info(
          `[TMDB Multi-Strategy] Strategy 4b succeeded: Found movie match`
        );
        // Get director from full details
        const details = await getMovieDetails(movieResult.id, apiKey, mapLanguageToTMDB(language));
        return {
          result: movieResult,
          mediaType: "movie",
          strategy: "movie-search-no-year",
          director: details?.director,
        };
      }
    }
  }

  // Strategy 5: Fuzzy matching - try simplified titles (remove special characters)
  for (const title of titles) {
    const simplifiedTitle = title.replace(/[^\w\s\u4e00-\u9fff]/g, "").trim();
    if (simplifiedTitle !== title && simplifiedTitle.length >= 3) {
      logger.info(
        `[TMDB Multi-Strategy] Strategy 5: Fuzzy search "${simplifiedTitle}"`
      );
      const fuzzyResult = await searchTMDBSingle(
        simplifiedTitle,
        apiKey,
        parsed.year,
        language
      );
      if (fuzzyResult.result) {
        logger.info(
          `[TMDB Multi-Strategy] Strategy 5 succeeded: Found ${fuzzyResult.mediaType} match`
        );
        return { ...fuzzyResult, strategy: "fuzzy-search" };
      }
    }
  }

  logger.info(`[TMDB Multi-Strategy] All strategies failed for filename`);
  return { result: null, mediaType: null, strategy: "all-failed" };
}

/**
 * Scrape metadata from TMDB based on filename using intelligent multi-strategy search
 * Returns metadata if found, null otherwise
 */
export async function scrapeMetadataFromTMDB(
  filename: string,
  thumbnailFilename?: string
): Promise<{
  title: string;
  description?: string;
  thumbnailPath?: string;
  thumbnailUrl?: string;
  year?: string;
  rating?: number;
  director?: string;
} | null> {
  try {
    const settings = getSettings();
    const tmdbApiKey = settings.tmdbApiKey || process.env.TMDB_API_KEY;

    if (!tmdbApiKey) {
      logger.warn("TMDB API key not configured. Skipping metadata scraping.");
      return null;
    }

    // Get language from settings for localized results
    const language = settings.language || "en";

    // Parse filename with enhanced parser
    const parsed = parseFilename(filename);

    logger.info(
      `[TMDB Scrape] Parsed filename: titles=${parsed.titles.join(
        ", "
      )}, year=${parsed.year || "N/A"}, isTVShow=${
        parsed.isTVShow
      }, language=${language}`
    );

    // Use multi-strategy search with language parameter
    const searchResult = await searchTMDBMultiStrategy(
      parsed,
      tmdbApiKey,
      language
    );

    if (!searchResult.result) {
      logger.info(
        `[TMDB Scrape] No TMDB match found for "${filename}" (strategy: ${searchResult.strategy})`
      );
      return null;
    }

    const result = searchResult.result;
    const mediaType = searchResult.mediaType;

    // Build metadata from result
    let metadata: {
      title: string;
      description?: string;
      thumbnailPath?: string;
      thumbnailUrl?: string;
      year?: string;
      rating?: number;
      director?: string;
    };

    if (mediaType === "movie" && "title" in result) {
      metadata = {
        title: result.title,
        description: result.overview,
        year: result.release_date
          ? result.release_date.substring(0, 4)
          : undefined,
        rating: result.vote_average,
        director: searchResult.director,
      };
    } else if (mediaType === "tv" && "name" in result) {
      metadata = {
        title: result.name,
        description: result.overview,
        year: result.first_air_date
          ? result.first_air_date.substring(0, 4)
          : undefined,
        rating: result.vote_average,
        director: searchResult.director,
      };
    } else {
      logger.error(`[TMDB Scrape] Unexpected result type: ${mediaType}`);
      return null;
    }

    // Download poster if available
    if (result.poster_path) {
      // Generate filename based on TMDB title instead of sanitized filename
      // This ensures the filename matches the actual movie/TV show title
      // Sanitize TMDB title to create safe filename (prevent path traversal)
      const tmdbTitleSafe = metadata.title
        .replace(/[^\w\s\u4e00-\u9fff.-]/g, "") // Keep Unicode and basic punctuation
        .replace(/\s+/g, ".")
        .replace(/\.+/g, ".") // Replace multiple dots with single dot
        .replace(/^\.|\.$/g, "") // Remove leading/trailing dots
        .substring(0, 100); // Limit length

      const yearPart = metadata.year ? `.${metadata.year}` : "";
      // Generate safe filename base - ensure no path traversal
      const safeFilenameBase = `${tmdbTitleSafe}${yearPart}`
        .replace(/[^a-zA-Z0-9.\u4e00-\u9fff-_]/g, "_") // Replace unsafe chars
        .replace(/[\/\\]/g, "_") // Remove path separators
        .substring(0, 200); // Limit total length

      // Use provided thumbnailFilename directory structure if available, but use TMDB title for filename
      let finalThumbnailFilename: string;
      if (thumbnailFilename) {
        const providedDir = path.dirname(thumbnailFilename);
        if (providedDir !== "." && providedDir !== "/") {
          // Preserve directory structure from provided filename
          // But validate it's safe
          const safeDir = providedDir.replace(
            /[^a-zA-Z0-9.\u4e00-\u9fff-_\/]/g,
            "_"
          );
          finalThumbnailFilename = path.join(
            safeDir,
            `${safeFilenameBase}.jpg`
          );
        } else {
          // No subdirectory, use root images directory
          finalThumbnailFilename = `${safeFilenameBase}.jpg`;
        }
      } else {
        // No provided filename, generate from TMDB title
        finalThumbnailFilename = `${safeFilenameBase}.jpg`;
      }

      // Normalize and validate path to prevent path traversal
      const posterSavePath = path.join(IMAGES_DIR, finalThumbnailFilename);
      const normalizedSavePath = path.normalize(posterSavePath);
      const imagesDirNormalized = path.normalize(IMAGES_DIR);

      // Ensure the path is within IMAGES_DIR (critical path traversal protection)
      if (!normalizedSavePath.startsWith(imagesDirNormalized)) {
        logger.error(
          `Invalid thumbnail path (outside IMAGES_DIR): ${normalizedSavePath}. Using safe filename only.`
        );
        // Fallback to filename only (no subdirectory) - most safe option
        const fallbackBase = safeFilenameBase.replace(/[\/\\]/g, "_");
        finalThumbnailFilename = `${fallbackBase}.jpg`;
        // Rebuild path with fallback filename
        const fallbackPath = path.join(IMAGES_DIR, finalThumbnailFilename);
        const normalizedFallbackPath = path.normalize(fallbackPath);
        if (!normalizedFallbackPath.startsWith(imagesDirNormalized)) {
          logger.error(
            `Fallback path still invalid: ${normalizedFallbackPath}`
          );
          return metadata; // Return metadata without thumbnail if path is unsafe
        }

        const downloaded = await downloadPoster(
          result.poster_path,
          normalizedFallbackPath
        );

        if (downloaded) {
          const savedFilename = path.basename(normalizedFallbackPath);
          metadata.thumbnailPath = `/images/${savedFilename}`;
          metadata.thumbnailUrl = `/images/${savedFilename}`;
          // Store the actual filename used for the scanController
          (metadata as any).thumbnailFilename = savedFilename;
        }
      } else {
        // Path is safe, use it
        const downloaded = await downloadPoster(
          result.poster_path,
          normalizedSavePath
        );

        if (downloaded) {
          // Calculate relative path from IMAGES_DIR for web path
          const relativePath = path.relative(
            imagesDirNormalized,
            normalizedSavePath
          );
          const webPath = `/images/${relativePath.replace(/\\/g, "/")}`;
          metadata.thumbnailPath = webPath;
          metadata.thumbnailUrl = webPath;
          // Store the actual filename (relative path) used for the scanController
          // This includes subdirectory if the file was saved in one
          (metadata as any).thumbnailFilename = relativePath.replace(
            /\\/g,
            "/"
          );
        }
      }
    }

    logger.info(
      `[TMDB Scrape] Successfully scraped metadata for "${filename}" -> "${metadata.title}" (strategy: ${searchResult.strategy})`
    );
    return metadata;
  } catch (error) {
    logger.error(`Error scraping metadata for "${filename}":`, error);
    return null;
  }
}
