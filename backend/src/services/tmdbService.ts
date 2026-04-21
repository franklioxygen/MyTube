import crypto from "crypto";
import axios, { AxiosRequestConfig } from "axios";
import fs from "fs-extra";
import path from "path";
import { IMAGES_DIR } from "../config/paths";
import { regenerateSmallThumbnailForThumbnailPath } from "./thumbnailMirrorService";
import { logger } from "../utils/logger";
import {
  buildAllowlistedHttpUrl,
  resolveSafeChildPath,
  resolveSafePath,
  writeFileSafe,
} from "../utils/security";
import { getSettings } from "./storageService/settings";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_API_ORIGIN = "https://api.themoviedb.org";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const TMDB_SEARCH_CACHE_MAX_ENTRIES = 500;
const TMDB_SEARCH_CACHE_TTL_MS = 60 * 60 * 1000;
const TMDB_NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000;
const TMDB_REQUEST_TIMEOUT_MS = 10000;
const ALLOWED_TMDB_API_HOSTS = ["api.themoviedb.org"];
const tmdbHttpClient = axios.create({
  baseURL: buildAllowlistedHttpUrl(TMDB_API_ORIGIN, ALLOWED_TMDB_API_HOSTS),
  timeout: TMDB_REQUEST_TIMEOUT_MS,
});

// Whitelist of allowed hosts for image downloads to prevent SSRF
const ALLOWED_IMAGE_HOSTS = ["image.tmdb.org"];

/**
 * Map frontend language codes to TMDB language codes
 * TMDB uses ISO 639-1 with region codes (e.g., en-US, zh-CN)
 */
function mapLanguageToTMDB(language?: string): string {
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

export interface TMDBMovieResult {
  id: number;
  title: string;
  original_title?: string;
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
  original_name?: string;
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
  original_title?: string; // For movies
  name?: string; // For TV shows
  original_name?: string; // For TV shows
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

type MultiStrategySearchResult = {
  result: TMDBMovieResult | TMDBTVResult | null;
  mediaType: "movie" | "tv" | null;
  strategy: string;
  director?: string;
};

type TMDBCrewMember = {
  job?: string;
  name?: string;
};

export type TMDBCredentialAuthType = "apiKey" | "readAccessToken";

export type TMDBCredentialMessageKey =
  | "tmdbCredentialValidApiKey"
  | "tmdbCredentialValidReadAccessToken"
  | "tmdbCredentialInvalid"
  | "tmdbCredentialRequestFailed";

export type TMDBCredentialTestResult =
  | {
      success: true;
      authType: TMDBCredentialAuthType;
      messageKey:
        | "tmdbCredentialValidApiKey"
        | "tmdbCredentialValidReadAccessToken";
    }
  | {
      success: false;
      authType: TMDBCredentialAuthType;
      code: "auth-failed" | "request-failed";
      messageKey: "tmdbCredentialInvalid" | "tmdbCredentialRequestFailed";
      error: string;
    };

class TMDBAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TMDBAuthenticationError";
  }
}

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const tmdbSearchCache = new Map<string, CacheEntry<MultiStrategySearchResult>>();
const tmdbSearchInFlight = new Map<string, Promise<MultiStrategySearchResult>>();

function isAllowedTMDBTokenCharacter(character: string): boolean {
  return /^[A-Za-z0-9_-]$/.test(character);
}

function stripBearerPrefix(credential: string): string {
  const trimmedCredential = credential.trim();
  const lowercaseCredential = trimmedCredential.toLowerCase();
  return lowercaseCredential.startsWith("bearer ")
    ? trimmedCredential.slice("bearer ".length).trimStart()
    : trimmedCredential;
}

function isLikelyTMDBReadAccessToken(credential: string): boolean {
  const token = stripBearerPrefix(credential);
  const tokenParts = token.split(".");
  if (tokenParts.length !== 3) {
    return false;
  }

  return tokenParts.every(
    (part) =>
      part.length >= 10 &&
      Array.from(part).every((character) =>
        isAllowedTMDBTokenCharacter(character),
      ),
  );
}

function validateTMDBNumericId(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Invalid TMDB id: ${id}`);
  }

  return id.toString();
}

function buildTMDBEndpointPath(endpointPath: string): string {
  const validatedUrl = buildAllowlistedHttpUrl(
    `${TMDB_API_BASE}${endpointPath}`,
    ALLOWED_TMDB_API_HOSTS,
  );
  const parsedUrl = new URL(validatedUrl);
  return `${parsedUrl.pathname}${parsedUrl.search}`;
}

function normalizeTMDBCredential(credential: string): string {
  return credential.trim();
}

function getTMDBCredentialAuthType(
  credential: string
): TMDBCredentialAuthType {
  const normalizedCredential = normalizeTMDBCredential(credential);
  return normalizedCredential.toLowerCase().startsWith("bearer ") ||
    isLikelyTMDBReadAccessToken(normalizedCredential)
    ? "readAccessToken"
    : "apiKey";
}

function hashTMDBCredential(credential: string): string {
  return crypto.scryptSync(
    normalizeTMDBCredential(credential),
    "mytube:tmdb-cache-key",
    32
  ).toString("hex");
}

function requireTMDBCredential(credential: string): string {
  const normalizedCredential = normalizeTMDBCredential(credential);
  if (!normalizedCredential) {
    throw new Error("TMDB credential is required.");
  }

  return normalizedCredential;
}

function buildTMDBRequestConfig(
  credential: string,
  params: Record<string, string> = {},
  extraConfig: AxiosRequestConfig = {}
): AxiosRequestConfig {
  const normalizedCredential = requireTMDBCredential(credential);
  const requestParams = { ...params };
  const requestHeaders: Record<string, string> = {
    ...(extraConfig.headers as Record<string, string> | undefined),
  };
  const authType = getTMDBCredentialAuthType(normalizedCredential);

  if (authType === "readAccessToken") {
    requestHeaders.Authorization = `Bearer ${stripBearerPrefix(
      normalizedCredential,
    )}`;
  } else {
    requestParams.api_key = normalizedCredential;
  }

  return {
    timeout: TMDB_REQUEST_TIMEOUT_MS,
    ...extraConfig,
    params: requestParams,
    headers: Object.keys(requestHeaders).length > 0 ? requestHeaders : undefined,
  };
}

export async function testTMDBCredential(
  credential: string
): Promise<TMDBCredentialTestResult> {
  const normalizedCredential = normalizeTMDBCredential(credential);
  if (!normalizedCredential) {
    return {
      success: false,
      authType: "apiKey",
      code: "request-failed",
      messageKey: "tmdbCredentialRequestFailed",
      error: "TMDB credential is required.",
    };
  }

  const authType = getTMDBCredentialAuthType(normalizedCredential);

  try {
    await tmdbHttpClient.get(
      buildTMDBEndpointPath("/configuration"),
      buildTMDBRequestConfig(normalizedCredential)
    );

    return {
      success: true,
      authType,
      messageKey:
        authType === "readAccessToken"
          ? "tmdbCredentialValidReadAccessToken"
          : "tmdbCredentialValidApiKey",
    };
  } catch (error) {
    const authErrorMessage = getTMDBAuthErrorMessage(error);
    if (authErrorMessage) {
      return {
        success: false,
        authType,
        code: "auth-failed",
        messageKey: "tmdbCredentialInvalid",
        error: authErrorMessage,
      };
    }

    logger.error("Error testing TMDB credential:", error);
    return {
      success: false,
      authType,
      code: "request-failed",
      messageKey: "tmdbCredentialRequestFailed",
      error: "Failed to reach TMDB. Please try again.",
    };
  }
}

function getTMDBAuthErrorMessage(error: unknown): string | null {
  const maybeAxiosError = error as
    | {
        response?: { status?: number; data?: { status_message?: string } };
        message?: string;
      }
    | undefined;

  if (maybeAxiosError?.response?.status !== 401) {
    return null;
  }

  return (
    maybeAxiosError.response.data?.status_message ||
    maybeAxiosError.message ||
    "TMDB authentication failed."
  );
}

function throwIfTMDBAuthenticationError(error: unknown): void {
  if (error instanceof TMDBAuthenticationError) {
    throw error;
  }

  const message = getTMDBAuthErrorMessage(error);
  if (message) {
    throw new TMDBAuthenticationError(message);
  }
}

const getCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string
): T | undefined => {
  const cached = cache.get(key);
  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }

  return cached.value;
};

const setCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
  maxEntries: number
): void => {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });

  if (cache.size <= maxEntries) {
    return;
  }

  const oldestKey = cache.keys().next().value;
  if (oldestKey) {
    cache.delete(oldestKey);
  }
};

const buildSearchCacheKey = (
  parsed: ParsedFilename,
  credential: string,
  language?: string
): string => {
  const normalizedTitles = parsed.titles
    .map((title) => title.trim().toLowerCase())
    .sort();

  return JSON.stringify({
    titles: normalizedTitles,
    year: parsed.year ?? null,
    season: parsed.season ?? null,
    episode: parsed.episode ?? null,
    isTVShow: parsed.isTVShow,
    language: mapLanguageToTMDB(language),
    credentialHash: hashTMDBCredential(credential),
  });
};

const QUALITY_PATTERN = /\b(\d+p|\d+x\d+|\d+i|4K|8K|2160p|1440p)\b/gi;
const STANDALONE_RESOLUTION_PATTERN =
  /\b(1080|720|480|360|240|1440|2160)\b(?![pxi])/gi;
const REMAINING_QUALITY_PATTERN = /\b\d{3,4}p\b/i;
const SOURCE_PATTERNS = [
  /\bWEB-DL\b/i,
  /\bWEBRip\b/i,
  /\bWEB\b(?![^\s.])/i,
  /\bBluRay\b/i,
  /\bBDRip\b/i,
  /\bBD\b(?![^\s.])/i,
  /\bDVD\b/i,
  /\bDVDRip\b/i,
  /\bHDTV\b/i,
  /\bHDRip\b/i,
  /\bCAM\b/i,
  /\bTS\b(?![^\s.])/i,
  /\bTELESYNC\b/i,
  /\bTELECINE\b/i,
  /\bR5\b/i,
  /\bSCR\b/i,
  /\bSCREENER\b/i,
];
const CJK_PATTERN = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/g;
const CJK_TEXT_PATTERN = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/;
const COMMON_STOPWORD_PATTERN = /^(the|a|an|and|or|of|in|on|at|to|for)$/i;
const RESOLUTION_SEGMENT_PATTERN = /^\d+p$/i;
const COMMON_FORMAT_SEGMENT_PATTERN = /^(web|dl|rip|remux|mux)$/i;
const ALL_CAPS_ACRONYM_PATTERN = /^[A-Z]{2,5}$/;
const ENGLISH_TITLE_PATTERN = /^[a-zA-Z0-9\s]+$/;
const CHANNEL_LAYOUT_PATTERN = /^\d(?:\.\d)?$/;
const BRACKETED_METADATA_KEYWORD_PATTERN =
  /(简中|繁中|中字|双字|字幕|硬字|软字|内封|外挂|特效|压制|发布|转载|招募)/;
const METADATA_TERMS = new Set([
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
  "ma",
  "dd",
  "ddp",
  "hdr",
  "dv",
  "admin",
  "upload",
  "download",
]);
const COMMON_RELEASE_GROUPS = new Set([
  "adweb",
  "btschool",
  "btshd",
  "chd",
  "cinephiles",
  "ctrlhd",
  "don",
  "frds",
  "hdc",
  "hdchina",
  "hdsweb",
  "hifi",
  "mteam",
  "muhd",
  "pter",
  "playbd",
  "quickio",
  "rarbg",
  "wiki",
  "yts",
  "ytsmx",
]);
type TVMetadata = {
  name: string;
  isTVShow: boolean;
  season?: number;
  episode?: number;
};

function parseTVMetadataPattern(name: string, pattern: RegExp): TVMetadata | null {
  const match = name.match(pattern);
  if (!match) {
    return null;
  }
  return {
    name: match[1].trim(),
    isTVShow: true,
    season: parseInt(match[2], 10),
    episode: parseInt(match[3], 10),
  };
}

function extractTVMetadata(name: string): TVMetadata {
  const patterns = [
    /^(.+?)\s*[Ss](\d+)[Ee](\d+)/,
    /^(.+?)\s*[Ss]eason\s*(\d+)\s*[Ee]pisode\s*(\d+)/i,
  ];
  for (const pattern of patterns) {
    const parsed = parseTVMetadataPattern(name, pattern);
    if (parsed) {
      return parsed;
    }
  }
  return { name, isTVShow: false };
}

function extractYearMetadata(name: string): { name: string; year?: number } {
  const yearMatches = name.match(/\b(19\d{2}|20[0-1]\d|202[0-9])\b/);
  if (!yearMatches) {
    return { name };
  }

  const extractedYear = parseInt(yearMatches[1], 10);
  if (extractedYear < 1900 || extractedYear > 2100) {
    return { name };
  }

  return {
    name: name.replace(/\b\d{4}\b/, "").trim(),
    year: extractedYear,
  };
}

function extractQualityMetadata(name: string): { name: string; quality?: string } {
  const qualityMatch = name.match(QUALITY_PATTERN);
  if (!qualityMatch) {
    return { name };
  }

  return {
    name: name.replace(QUALITY_PATTERN, "").trim(),
    quality: qualityMatch[0].toUpperCase(),
  };
}

function removeStandaloneResolution(name: string): string {
  return name.replace(STANDALONE_RESOLUTION_PATTERN, "").trim();
}

function extractSourceMetadata(name: string): { name: string; source?: string } {
  let remaining = name;
  let source: string | undefined;

  for (const pattern of SOURCE_PATTERNS) {
    const sourceMatch = remaining.match(pattern);
    if (sourceMatch && !source) {
      source = sourceMatch[0];
    }
    remaining = remaining.replace(pattern, "").trim();
  }

  return { name: remaining, source };
}

function stripTechnicalMetadata(name: string): string {
  return stripTrailingReleaseGroup(
    name
    .replace(/\b(H26[45]|HEVC|x26[45]|VP9|AV1|H\.26[45])\b/gi, "")
    .replace(/\b(AAC|AC3|DTS|FLAC|MP3|Vorbis|EAC3|TrueHD|Atmos)\b/gi, "")
    .replace(/\[[A-Z][a-zA-Z0-9]+\]\s*$/, "")
    .replace(/\b(Rip|Remux|Mux|Enc|Dec)\b/gi, "")
    .replace(/\[([^\]]+)\]/g, (_match, content: string) => {
      if (
        CJK_TEXT_PATTERN.test(content) &&
        !BRACKETED_METADATA_KEYWORD_PATTERN.test(content)
      ) {
        return ` ${content} `;
      }
      return " ";
    })
    .trim()
  );
}

function looksLikeReleaseGroupPart(part: string): boolean {
  const normalized = part.trim();
  if (normalized.length < 2 || CJK_TEXT_PATTERN.test(normalized)) {
    return false;
  }

  if (/^\d+$/.test(normalized)) {
    return false;
  }

  const lowerCased = normalized.toLowerCase();
  if (COMMON_RELEASE_GROUPS.has(lowerCased)) {
    return true;
  }

  if (/^[A-Za-z]+$/.test(normalized) && normalized.length < 4) {
    return false;
  }

  if (/^[A-Z0-9]{2,10}$/.test(normalized)) {
    return true;
  }

  const uppercaseCount = (normalized.match(/[A-Z]/g) || []).length;
  return uppercaseCount >= 2 && normalized.length <= 12;
}

function isReleaseGroupSeparator(character: string): boolean {
  return character === "." || character === "_" || character === "-";
}

function isReleaseGroupChainCharacter(character: string): boolean {
  return (
    (character >= "0" && character <= "9") ||
    (character >= "A" && character <= "Z") ||
    (character >= "a" && character <= "z") ||
    isReleaseGroupSeparator(character)
  );
}

function extractTrailingReleaseGroupMatch(
  value: string,
): { matchedText: string; group: string } | null {
  const trimmedValue = value.trimEnd();
  let chainStart = trimmedValue.length;

  while (
    chainStart > 0 &&
    isReleaseGroupChainCharacter(trimmedValue[chainStart - 1])
  ) {
    chainStart -= 1;
  }

  const candidateChain = trimmedValue.slice(chainStart);
  if (!candidateChain) {
    return null;
  }

  const separatorMatches = Array.from(candidateChain.matchAll(/[._-]/g));
  separatorMatches.reverse();

  for (const separatorMatch of separatorMatches) {
    const index = separatorMatch.index;

    const group = candidateChain.slice(index + 1);
    if (group.length === 0) {
      continue;
    }

    return {
      matchedText: candidateChain.slice(index),
      group,
    };
  }

  return null;
}

function stripTrailingReleaseGroup(name: string): string {
  let remaining = name.trim();

  while (remaining.length > 0) {
    const trailingGroupMatch = extractTrailingReleaseGroupMatch(remaining);
    if (!trailingGroupMatch) {
      break;
    }

    const fullGroup = trailingGroupMatch.group;
    const parts = fullGroup.split(/[._-]/).filter(Boolean);
    if (parts.length === 0 || !parts.every(looksLikeReleaseGroupPart)) {
      break;
    }

    remaining = remaining
      .slice(0, remaining.length - trailingGroupMatch.matchedText.length)
      .trim();
  }

  return remaining;
}

function normalizeCandidateSpacing(candidate: string): string {
  return candidate
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTrailingTechnicalTokens(candidate: string): string {
  const normalized = normalizeCandidateSpacing(candidate);
  if (!normalized) {
    return "";
  }

  const tokens = normalized.split(" ");
  while (tokens.length > 0) {
    const lastToken = tokens[tokens.length - 1]
      .replace(/^[._-]+|[._-]+$/g, "")
      .trim();
    if (!lastToken) {
      tokens.pop();
      continue;
    }

    const lowerToken = lastToken.toLowerCase();
    if (
      CHANNEL_LAYOUT_PATTERN.test(lastToken) ||
      isMetadataTerm(lowerToken)
    ) {
      tokens.pop();
      continue;
    }
    break;
  }

  return tokens.join(" ").trim();
}

function buildReadableEnglishCandidate(name: string): string {
  const normalized = normalizeCandidateSpacing(name);
  if (!normalized) {
    return "";
  }

  const englishOnly = normalized.replace(CJK_PATTERN, " ").replace(/\s+/g, " ").trim();
  return stripTrailingTechnicalTokens(englishOnly);
}

function collectChineseMatches(name: string): string[] {
  const chineseMatches: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = CJK_PATTERN.exec(name)) !== null) {
    const chineseText = match[0].trim();
    if (chineseText.length >= 2 && !chineseMatches.includes(chineseText)) {
      chineseMatches.push(chineseText);
    }
  }

  CJK_PATTERN.lastIndex = 0;
  return chineseMatches;
}

function removeRemainingQualityPattern(name: string): string {
  return name.replace(REMAINING_QUALITY_PATTERN, "").trim();
}

function splitTitleSegments(name: string): string[] {
  return name.split(/[._-]+/).filter((segment) => segment.trim().length > 0);
}

function isNumericText(value: string): boolean {
  return /^\d+$/.test(value);
}

function isMetadataTerm(value: string): boolean {
  return METADATA_TERMS.has(value.toLowerCase());
}

function shouldSkipEnglishSegment(trimmed: string): boolean {
  if (trimmed.length < 2) return true;
  if (isNumericText(trimmed)) return true;
  if (COMMON_STOPWORD_PATTERN.test(trimmed)) return true;
  if (CJK_TEXT_PATTERN.test(trimmed)) return true;
  if (isMetadataTerm(trimmed)) return true;
  if (RESOLUTION_SEGMENT_PATTERN.test(trimmed)) return true;
  return COMMON_FORMAT_SEGMENT_PATTERN.test(trimmed);
}

function normalizeEnglishSegment(segment: string): string {
  return segment.replace(/^\W+|\W+$/g, "").trim();
}

function shouldKeepEnglishSegment(cleanSegment: string): boolean {
  return (
    cleanSegment.length >= 2 &&
    !/^\d+$/.test(cleanSegment) &&
    !ALL_CAPS_ACRONYM_PATTERN.test(cleanSegment)
  );
}

function extractEnglishWords(segments: string[]): string[] {
  const englishWords: string[] = [];

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (shouldSkipEnglishSegment(trimmed)) {
      continue;
    }

    const cleanTitle = normalizeEnglishSegment(trimmed);
    if (shouldKeepEnglishSegment(cleanTitle)) {
      englishWords.push(cleanTitle);
    }
  }

  return englishWords;
}

function addCandidate(
  titleCandidates: string[],
  seen: Set<string>,
  candidate: string
): void {
  const cleanedCandidate = stripTrailingTechnicalTokens(candidate);
  const normalized = cleanedCandidate.toLowerCase();
  if (cleanedCandidate.length < 2 || seen.has(normalized)) {
    return;
  }
  titleCandidates.push(cleanedCandidate);
  seen.add(normalized);
}

function buildEnglishCombinations(
  englishWords: string[],
  seen: Set<string>
): string[] {
  const combinations: string[] = [];

  if (englishWords.length <= 5 && englishWords.length > 0) {
    const fullCombined = englishWords.join(" ");
    if (fullCombined.length >= 4 && !seen.has(fullCombined.toLowerCase())) {
      combinations.push(fullCombined);
      seen.add(fullCombined.toLowerCase());
    }
  }

  if (englishWords.length < 2) {
    return combinations;
  }

  let previousWord: string | null = null;
  for (const word of englishWords) {
    if (!previousWord) {
      previousWord = word;
      continue;
    }

    const combined = `${previousWord} ${word}`;
    if (combined.length >= 4 && !seen.has(combined.toLowerCase())) {
      combinations.push(combined);
      seen.add(combined.toLowerCase());
    }
    previousWord = word;
  }

  return combinations.sort((a, b) => b.length - a.length);
}

function appendStandaloneEnglishWords(
  englishWords: string[],
  englishCombinations: string[],
  titleCandidates: string[],
  seen: Set<string>
): void {
  for (const word of englishWords) {
    const isPartOfCombo = englishCombinations.some((combo) =>
      combo.toLowerCase().includes(word.toLowerCase())
    );
    if (isPartOfCombo || seen.has(word.toLowerCase())) {
      continue;
    }

    if (word.length >= 2) {
      addCandidate(titleCandidates, seen, word);
    }
  }
}

function buildOrderedTitles(titleCandidates: string[]): string[] {
  const chineseTitles = titleCandidates.filter((title) => CJK_TEXT_PATTERN.test(title));
  const englishTitles = titleCandidates.filter((title) =>
    ENGLISH_TITLE_PATTERN.test(title)
  );

  englishTitles.sort((a, b) => {
    const aHasSpace = a.includes(" ");
    const bHasSpace = b.includes(" ");
    if (aHasSpace && !bHasSpace) return -1;
    if (!aHasSpace && bHasSpace) return 1;
    return b.length - a.length;
  });

  const orderedTitles: string[] = [];
  const multiWordEnglish = englishTitles.filter((title) => title.includes(" "));
  const singleWordEnglish = englishTitles.filter((title) => !title.includes(" "));

  orderedTitles.push(...chineseTitles);
  orderedTitles.push(...multiWordEnglish);
  orderedTitles.push(...singleWordEnglish);

  if (chineseTitles.length > 0 && englishTitles.length > 0) {
    const combined = `${chineseTitles[0]} ${englishTitles[0]}`;
    if (!orderedTitles.includes(combined)) {
      orderedTitles.splice(chineseTitles.length, 0, combined);
    }
  }

  return orderedTitles;
}

function containsLatinText(value: string): boolean {
  return /[A-Za-z]/.test(value);
}

function getSearchTitlePriority(title: string): number {
  const hasCJK = CJK_TEXT_PATTERN.test(title);
  const hasLatin = containsLatinText(title);

  if (hasCJK && !hasLatin) {
    return 0;
  }

  if (hasCJK) {
    return 1;
  }

  if (title.includes(" ")) {
    return 2;
  }

  return 3;
}

function buildFallbackTitles(cleanName: string, filename: string): string[] {
  const fallbackTitle = cleanName
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return fallbackTitle ? [fallbackTitle] : [path.parse(filename).name];
}

function isLikelyGenericCaptureFilename(filename: string): boolean {
  const baseName = path.parse(filename).name.trim();
  if (!baseName) {
    return false;
  }

  const upperBaseName = baseName.toUpperCase();

  if (
    ["IMG", "VID", "MOV"].some((prefix) => {
      if (!upperBaseName.startsWith(prefix)) {
        return false;
      }
      const suffix = baseName.slice(prefix.length).replace(/^[._-]?/, "");
      return /^\d{3,}$/i.test(suffix);
    })
  ) {
    return true;
  }

  if (upperBaseName.startsWith("DSC")) {
    const suffix = baseName.slice(3).replace(/^[A-Z]?[._-]?/i, "");
    if (/^\d{3,}$/i.test(suffix)) {
      return true;
    }
  }

  if (upperBaseName.startsWith("PXL_") || upperBaseName.startsWith("PXL-")) {
    const separator = upperBaseName[3];
    const parts = baseName.split(separator);
    if (parts.length >= 3) {
      const datePart = parts[1] ?? "";
      const timeAndSuffix = parts[2] ?? "";
      const [timePart, ...suffixParts] = timeAndSuffix.split(".");
      const suffix = suffixParts.join(".");
      if (
        /^\d{8}$/.test(datePart) &&
        /^\d{6,}$/.test(timePart) &&
        (suffix.length === 0 || /^[A-Z0-9_]+$/i.test(suffix))
      ) {
        return true;
      }
    }
  }

  if (
    upperBaseName.startsWith("SCREENSHOT") ||
    upperBaseName.startsWith("SCREENRECORDING") ||
    upperBaseName.startsWith("SCREEN")
  ) {
    const suffix = baseName
      .replace(/^SCREEN(?:SHOT|RECORDING)?/i, "")
      .replace(/^[._-]?/, "");
    if (/^\d{3,}$/i.test(suffix)) {
      return true;
    }
  }

  return false;
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
  const tvMetadata = extractTVMetadata(path.parse(filename).name);

  let nameWithoutExt = tvMetadata.name;
  const yearMetadata = extractYearMetadata(nameWithoutExt);
  nameWithoutExt = yearMetadata.name;

  const qualityMetadata = extractQualityMetadata(nameWithoutExt);
  nameWithoutExt = removeStandaloneResolution(qualityMetadata.name);

  const sourceMetadata = extractSourceMetadata(nameWithoutExt);
  nameWithoutExt = stripTechnicalMetadata(sourceMetadata.name);

  const chineseMatches = collectChineseMatches(nameWithoutExt);
  nameWithoutExt = removeRemainingQualityPattern(nameWithoutExt);

  const segments = splitTitleSegments(nameWithoutExt);
  const titleCandidates: string[] = [];
  const seen = new Set<string>();

  for (const chineseTitle of chineseMatches) {
    addCandidate(titleCandidates, seen, chineseTitle);
  }

  const readableEnglishCandidate = buildReadableEnglishCandidate(nameWithoutExt);
  if (readableEnglishCandidate) {
    addCandidate(titleCandidates, seen, readableEnglishCandidate);
  }

  const englishWords = extractEnglishWords(segments);
  const englishCombinations = buildEnglishCombinations(englishWords, seen);

  for (const combination of englishCombinations) {
    addCandidate(titleCandidates, seen, combination);
  }

  appendStandaloneEnglishWords(
    englishWords,
    englishCombinations,
    titleCandidates,
    seen
  );

  if (titleCandidates.length === 0) {
    return {
      titles: buildFallbackTitles(nameWithoutExt, filename),
      year: yearMetadata.year,
      season: tvMetadata.season,
      episode: tvMetadata.episode,
      isTVShow: tvMetadata.isTVShow,
      quality: qualityMetadata.quality,
      source: sourceMetadata.source,
    };
  }

  const orderedTitles = buildOrderedTitles(titleCandidates);
  return {
    titles: orderedTitles.length > 0 ? orderedTitles : titleCandidates,
    year: yearMetadata.year,
    season: tvMetadata.season,
    episode: tvMetadata.episode,
    isTVShow: tvMetadata.isTVShow,
    quality: qualityMetadata.quality,
    source: sourceMetadata.source,
  };
}

/**
 * Search for a movie on TMDB with language support
 */
async function searchMovie(
  title: string,
  credential: string,
  year?: number,
  language?: string
): Promise<TMDBMovieResult | null> {
  try {
    const tmdbLanguage = mapLanguageToTMDB(language);
    const params: Record<string, string> = {
      query: title,
      language: tmdbLanguage,
    };

    if (year) {
      params.year = year.toString();
    }

    const response = await tmdbHttpClient.get(buildTMDBEndpointPath("/search/movie"), {
      ...buildTMDBRequestConfig(credential, params),
    });

    const results: TMDBMovieResult[] = response.data.results || [];
    if (results.length > 0) {
      const matchedResults = results.filter((movie) =>
        isConfidentTMDBTitleMatch(title, movie)
      );
      if (matchedResults.length === 0) {
        return null;
      }

      // Prefer exact year match if year was provided
      if (year) {
        const yearMatch = matchedResults.find((movie) => {
          if (!movie.release_date) return false;
          const movieYear = parseInt(movie.release_date.substring(0, 4), 10);
          return movieYear === year;
        });
        if (yearMatch) {
          // Fetch full details with language to get localized poster_path and title
          const details = await getMovieDetails(
            yearMatch.id,
            credential,
            tmdbLanguage
          );
          return details?.movie || null;
        }
      }
      // Fetch full details for the first result with language
      const details = await getMovieDetails(
        matchedResults[0].id,
        credential,
        tmdbLanguage
      );
      return details?.movie || null;
    }

    return null;
  } catch (error) {
    throwIfTMDBAuthenticationError(error);
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
  credential: string,
  language: string
): Promise<{ movie: TMDBMovieResult; director?: string } | null> {
  try {
    const safeMovieId = validateTMDBNumericId(movieId);
    // Fetch both movie details and credits in parallel
    const [movieResponse, creditsResponse] = await Promise.all([
      tmdbHttpClient.get(buildTMDBEndpointPath(`/movie/${safeMovieId}`), {
        ...buildTMDBRequestConfig(credential, {
          language,
        }),
      }),
      tmdbHttpClient.get(buildTMDBEndpointPath(`/movie/${safeMovieId}/credits`), {
        ...buildTMDBRequestConfig(credential, {
          language,
        }),
      }),
    ]);

    const movie = movieResponse.data as TMDBMovieResult;
    
    // Extract director from crew
    let director: string | undefined;
    const crew = Array.isArray(creditsResponse.data?.crew)
      ? (creditsResponse.data.crew as TMDBCrewMember[])
      : [];
    if (crew.length > 0) {
      const directorCrew = crew.find(
        (member) => member.job === "Director"
      );
      if (directorCrew && directorCrew.name) {
        director = directorCrew.name;
      }
    }

    return { movie, director };
  } catch (error) {
    throwIfTMDBAuthenticationError(error);
    logger.error(`Error fetching TMDB movie details for ID ${movieId}:`, error);
    return null;
  }
}

/**
 * Search for a TV show on TMDB with language support
 */
async function searchTVShow(
  title: string,
  credential: string,
  language?: string
): Promise<TMDBTVResult | null> {
  try {
    const tmdbLanguage = mapLanguageToTMDB(language);
    const response = await tmdbHttpClient.get(buildTMDBEndpointPath("/search/tv"), {
      ...buildTMDBRequestConfig(credential, {
        query: title,
        language: tmdbLanguage,
      }),
    });

    const results: TMDBTVResult[] = response.data.results || [];
    if (results.length > 0) {
      const matchedResults = results.filter((tvShow) =>
        isConfidentTMDBTitleMatch(title, tvShow)
      );
      if (matchedResults.length === 0) {
        return null;
      }

      // Fetch full details with language to get localized poster_path and title
      const details = await getTVShowDetails(
        matchedResults[0].id,
        credential,
        tmdbLanguage
      );
      return details?.tv || null;
    }

    return null;
  } catch (error) {
    throwIfTMDBAuthenticationError(error);
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
  credential: string,
  language: string
): Promise<{ tv: TMDBTVResult; director?: string } | null> {
  try {
    const safeTvId = validateTMDBNumericId(tvId);
    // Fetch both TV show details and credits in parallel
    const [tvResponse, creditsResponse] = await Promise.all([
      tmdbHttpClient.get(buildTMDBEndpointPath(`/tv/${safeTvId}`), {
        ...buildTMDBRequestConfig(credential, {
          language,
        }),
      }),
      tmdbHttpClient.get(buildTMDBEndpointPath(`/tv/${safeTvId}/credits`), {
        ...buildTMDBRequestConfig(credential, {
          language,
        }),
      }),
    ]);

    const tv = tvResponse.data as TMDBTVResult;
    
    // Extract director/creator from TV show
    // Priority: 1) Creator from created_by array, 2) Director from crew
    let director: string | undefined;
    const crew = Array.isArray(creditsResponse.data?.crew)
      ? (creditsResponse.data.crew as TMDBCrewMember[])
      : [];
    
    // First, try to get creator from created_by array
    if (tv.created_by && tv.created_by.length > 0 && tv.created_by[0].name) {
      director = tv.created_by[0].name;
    } else if (crew.length > 0) {
      // Fallback to director from crew
      const directorCrew = crew.find(
        (member) => member.job === "Director" || member.job === "Executive Producer"
      );
      if (directorCrew && directorCrew.name) {
        director = directorCrew.name;
      }
    }

    return { tv, director };
  } catch (error) {
    throwIfTMDBAuthenticationError(error);
    logger.error(`Error fetching TMDB TV show details for ID ${tvId}:`, error);
    return null;
  }
}

type TMDBSingleSearchResult = {
  result: TMDBMovieResult | TMDBTVResult | null;
  mediaType: "movie" | "tv" | null;
  director?: string;
};

type TMDBMediaSearchResult = TMDBSearchResult & { media_type: "movie" | "tv" };

function buildMultiSearchParams(
  title: string,
  tmdbLanguage: string,
  year?: number
): Record<string, string> {
  const params: Record<string, string> = {
    query: title,
    language: tmdbLanguage,
  };
  if (year) {
    params.year = year.toString();
  }
  return params;
}

function normalizeComparableTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractComparableTokens(value: string): string[] {
  return normalizeComparableTitle(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token));
}

function collapseComparableTitle(value: string): string {
  return normalizeComparableTitle(value).replace(/\s+/g, "");
}

function getResultTitleCandidates(
  item: Partial<TMDBMovieResult & TMDBTVResult & TMDBSearchResult>
): string[] {
  return [
    ...new Set(
      [
        item.title,
        item.original_title,
        item.name,
        item.original_name,
      ].filter((value): value is string => Boolean(value && value.trim()))
    ),
  ];
}

function isConfidentTMDBTitleMatch(
  searchTitle: string,
  item: Partial<TMDBMovieResult & TMDBTVResult & TMDBSearchResult>
): boolean {
  const normalizedSearchTitle = normalizeComparableTitle(searchTitle);
  if (normalizedSearchTitle.length < 2) {
    return false;
  }

  const searchTokens = extractComparableTokens(searchTitle);

  for (const candidateTitle of getResultTitleCandidates(item)) {
    const normalizedCandidateTitle = normalizeComparableTitle(candidateTitle);
    if (!normalizedCandidateTitle) {
      continue;
    }

    const collapsedSearchTitle = collapseComparableTitle(searchTitle);
    const collapsedCandidateTitle = collapseComparableTitle(candidateTitle);

    if (normalizedCandidateTitle === normalizedSearchTitle) {
      return true;
    }

    if (
      collapsedSearchTitle.length >= 4 &&
      collapsedCandidateTitle === collapsedSearchTitle
    ) {
      return true;
    }

    const shorterComparableLength = Math.min(
      normalizedSearchTitle.length,
      normalizedCandidateTitle.length
    );
    if (
      shorterComparableLength >= 4 &&
      (
        normalizedCandidateTitle.includes(normalizedSearchTitle) ||
        normalizedSearchTitle.includes(normalizedCandidateTitle)
      )
    ) {
      return true;
    }

    if (searchTokens.length === 0) {
      continue;
    }

    const candidateTokens = new Set(extractComparableTokens(candidateTitle));
    const matchedTokens = searchTokens.filter((token) =>
      candidateTokens.has(token)
    );

    if (matchedTokens.length === searchTokens.length) {
      return true;
    }

    if (searchTokens.length >= 2 && matchedTokens.length >= 2) {
      return true;
    }
  }

  return false;
}

function isTMDBMediaSearchResult(
  item: TMDBSearchResult
): boolean {
  return item.media_type === "movie" || item.media_type === "tv";
}

function extractMediaResultYear(item: TMDBMediaSearchResult): number | undefined {
  const date =
    item.media_type === "movie" ? item.release_date : item.first_air_date;
  if (!date || date.length < 4) {
    return undefined;
  }

  const itemYear = parseInt(date.substring(0, 4), 10);
  return Number.isNaN(itemYear) ? undefined : itemYear;
}

function getYearMatchScore(item: TMDBMediaSearchResult, year?: number): number {
  if (!year) {
    return 0;
  }

  const itemYear = extractMediaResultYear(item);
  if (itemYear === undefined) {
    return 0;
  }
  if (itemYear === year) {
    return 100;
  }
  if (Math.abs(itemYear - year) <= 1) {
    return 50;
  }
  return 0;
}

function scoreMultiSearchResult(item: TMDBMediaSearchResult, year?: number): number {
  let score = (item.popularity || 0) * 0.5;
  score += getYearMatchScore(item, year);
  if (item.vote_average) {
    score += item.vote_average * 10;
  }
  return score;
}

function pickBestMultiSearchResult(
  results: TMDBSearchResult[],
  queryTitle: string,
  year?: number
): TMDBMediaSearchResult | null {
  let bestMatch: TMDBMediaSearchResult | null = null;
  let bestScore = -1;

  for (const item of results) {
    if (!isTMDBMediaSearchResult(item)) {
      continue;
    }

    const mediaItem = item as TMDBMediaSearchResult;
    if (!isConfidentTMDBTitleMatch(queryTitle, mediaItem)) {
      continue;
    }

    const score = scoreMultiSearchResult(mediaItem, year);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = mediaItem;
    }
  }

  return bestMatch;
}

async function fetchTMDBSearchDetails(
  bestMatch: TMDBMediaSearchResult,
  credential: string,
  tmdbLanguage: string
): Promise<TMDBSingleSearchResult | null> {
  if (bestMatch.media_type === "movie") {
    const movieDetails = await getMovieDetails(
      bestMatch.id,
      credential,
      tmdbLanguage
    );
    if (movieDetails?.movie) {
      return {
        result: movieDetails.movie,
        mediaType: "movie",
        director: movieDetails.director,
      };
    }
    return null;
  }

  const tvDetails = await getTVShowDetails(bestMatch.id, credential, tmdbLanguage);
  if (tvDetails?.tv) {
    return {
      result: tvDetails.tv,
      mediaType: "tv",
      director: tvDetails.director,
    };
  }
  return null;
}

function buildTMDBSearchFallbackResult(
  bestMatch: TMDBMediaSearchResult
): TMDBSingleSearchResult {
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
  }

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

/**
 * Search TMDB using multi-search API (searches both movies and TV simultaneously)
 * Returns localized results based on language parameter
 */
async function searchTMDBSingle(
  title: string,
  credential: string,
  year?: number,
  language?: string
): Promise<TMDBSingleSearchResult> {
  try {
    const tmdbLanguage = mapLanguageToTMDB(language);
    const params = buildMultiSearchParams(title, tmdbLanguage, year);
    const response = await tmdbHttpClient.get(buildTMDBEndpointPath("/search/multi"), {
      ...buildTMDBRequestConfig(credential, params),
    });

    const results: TMDBSearchResult[] = response.data.results || [];
    const bestMatch = pickBestMultiSearchResult(results, title, year);
    if (!bestMatch) {
      return { result: null, mediaType: null };
    }

    const detailsResult = await fetchTMDBSearchDetails(
      bestMatch,
      credential,
      tmdbLanguage
    );
    if (detailsResult) {
      return detailsResult;
    }

    return buildTMDBSearchFallbackResult(bestMatch);
  } catch (error) {
    throwIfTMDBAuthenticationError(error);
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

  // Verify path matches expected TMDB image path pattern
  if (!parsedUrl.pathname.startsWith("/t/p/")) {
    logger.error(`Invalid path (not TMDB image path): ${parsedUrl.pathname}`);
    return null;
  }

  let validatedUrl: string;
  try {
    validatedUrl = buildAllowlistedHttpUrl(imageUrl, ALLOWED_IMAGE_HOSTS);
  } catch (error) {
    logger.error(`Invalid image URL: ${imageUrl}`, error);
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

    // Final whitelist check: verify hostname is in whitelist (double-check SSRF protection)
    const urlObj = new URL(validatedUrl);
    if (!ALLOWED_IMAGE_HOSTS.includes(urlObj.hostname)) {
      logger.error(`Hostname not in whitelist: ${urlObj.hostname}`);
      return false;
    }

    const response = await axios.get(validatedUrl, {
      responseType: "arraybuffer",
      timeout: 10000,
    });

    let normalizedSavePath: string;
    try {
      normalizedSavePath = resolveSafePath(savePath, IMAGES_DIR);
    } catch (error) {
      logger.error(
        `Invalid save path (outside IMAGES_DIR): ${savePath}`,
        error
      );
      return false;
    }

    // Ensure directory exists
    await fs.ensureDir(path.dirname(normalizedSavePath));

    // Save image
    // nosemgrep: javascript.pathtraversal.rule-non-literal-fs-filename
    await writeFileSafe(normalizedSavePath, IMAGES_DIR, response.data);
    const relativePath = path.relative(IMAGES_DIR, normalizedSavePath);
    await regenerateSmallThumbnailForThumbnailPath(
      `/images/${relativePath.replace(/\\/g, "/")}`,
    );

    logger.info(`Downloaded poster to ${normalizedSavePath}`);
    return true;
  } catch (error) {
    logger.error(`Error downloading poster from ${posterPath}:`, error);
    return false;
  }
}

function sanitizeThumbnailDirectory(relativeDirectory: string): string | null {
  const normalizedDirectory = relativeDirectory.replace(/\\/g, "/").trim();
  if (
    !normalizedDirectory ||
    normalizedDirectory === "." ||
    normalizedDirectory === "/"
  ) {
    return "";
  }

  const rawSegments = normalizedDirectory
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (
    rawSegments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        segment.includes("\0")
    )
  ) {
    return null;
  }

  const sanitizedSegments = rawSegments
    .map((segment) =>
      segment.replace(/[^a-zA-Z0-9.\u4e00-\u9fff_-]/g, "_")
    )
    .filter((segment) => segment.length > 0);

  if (sanitizedSegments.length === 0) {
    return "";
  }

  return path.join(...sanitizedSegments);
}

function resolvePosterSaveLocation(
  safeFilenameBase: string,
  thumbnailFilename?: string
): { absolutePath: string; relativePath: string } | null {
  const fallbackRelativePath = `${safeFilenameBase}.jpg`;

  let preferredRelativePath = fallbackRelativePath;
  if (thumbnailFilename) {
    const providedDir = path.dirname(thumbnailFilename);
    const safeDir = sanitizeThumbnailDirectory(providedDir);

    if (safeDir === null) {
      logger.warn(
        `Ignoring unsafe thumbnail directory from "${thumbnailFilename}", using root images directory`
      );
    } else if (safeDir) {
      preferredRelativePath = `${safeDir.replace(/\\/g, "/")}/${fallbackRelativePath}`;
    }
  }

  for (const candidateRelativePath of [
    preferredRelativePath,
    fallbackRelativePath,
  ]) {
    try {
      const absolutePath = resolveSafeChildPath(
        IMAGES_DIR,
        candidateRelativePath
      );

      return {
        absolutePath,
        relativePath: path
          .relative(path.resolve(IMAGES_DIR), absolutePath)
          .replace(/\\/g, "/"),
      };
    } catch (error) {
      logger.error(
        `Invalid thumbnail path candidate: ${candidateRelativePath}`,
        error
      );
    }
  }

  return null;
}

/**
 * Multi-strategy search for TMDB metadata using fallback mechanisms
 * Tries multiple titles and search strategies to find best match
 * Supports language parameter for localized results
 */
async function searchTMDBMultiStrategyUncached(
  parsed: ParsedFilename,
  credential: string,
  language?: string
): Promise<MultiStrategySearchResult> {
  const titles = parsed.titles.length > 0 ? parsed.titles : ["Unknown"];

  logger.info(
    `[TMDB Multi-Strategy] Searching with ${
      titles.length
    } title(s): ${titles.join(", ")}, Year: ${
      parsed.year || "N/A"
    }, Language: ${language || "en"}`
  );

  try {
    // Strategy 1: Try TMDB multi-search API with each title + year (most efficient)
    // Prefer pure CJK titles first, then bilingual titles, then longer English titles.
    const sortedTitles = [...titles].sort((a, b) => {
      const priorityDiff = getSearchTitlePriority(a) - getSearchTitlePriority(b);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
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
          credential,
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
          const tvResult = await searchTVShow(title, credential, language);
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
              const details = await getTVShowDetails(
                tvResult.id,
                credential,
                mapLanguageToTMDB(language)
              );
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
            credential,
            parsed.year,
            language
          );
          if (movieResult) {
            logger.info(
              `[TMDB Multi-Strategy] Strategy 2b succeeded: Found movie match`
            );
            // Get director from full details
            const details = await getMovieDetails(
              movieResult.id,
              credential,
              mapLanguageToTMDB(language)
            );
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
        credential,
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
        const tvResult = await searchTVShow(title, credential, language);
        if (tvResult) {
          logger.info(
            `[TMDB Multi-Strategy] Strategy 4a succeeded: Found TV match`
          );
          // Get director from full details
          const details = await getTVShowDetails(
            tvResult.id,
            credential,
            mapLanguageToTMDB(language)
          );
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
        const movieResult = await searchMovie(
          title,
          credential,
          undefined,
          language
        );
        if (movieResult) {
          logger.info(
            `[TMDB Multi-Strategy] Strategy 4b succeeded: Found movie match`
          );
          // Get director from full details
          const details = await getMovieDetails(
            movieResult.id,
            credential,
            mapLanguageToTMDB(language)
          );
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
          credential,
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
  } catch (error) {
    if (error instanceof TMDBAuthenticationError) {
      logger.error(
        `[TMDB Multi-Strategy] Authentication failed: ${error.message}`
      );
      return { result: null, mediaType: null, strategy: "auth-failed" };
    }
    throw error;
  }

  logger.info(`[TMDB Multi-Strategy] All strategies failed for filename`);
  return { result: null, mediaType: null, strategy: "all-failed" };
}

function createTMDBMultiStrategySearchPromise(
  cacheKey: string,
  parsed: ParsedFilename,
  apiKey: string,
  language?: string
): Promise<MultiStrategySearchResult> {
  return searchTMDBMultiStrategyUncached(parsed, apiKey, language)
    .then((searchResult) => {
      const ttl = searchResult.result
        ? TMDB_SEARCH_CACHE_TTL_MS
        : TMDB_NEGATIVE_CACHE_TTL_MS;

      setCachedValue(
        tmdbSearchCache,
        cacheKey,
        searchResult,
        ttl,
        TMDB_SEARCH_CACHE_MAX_ENTRIES
      );
      return searchResult;
    })
    .finally(() => {
      tmdbSearchInFlight.delete(cacheKey);
    });
}

function searchTMDBMultiStrategy(
  parsed: ParsedFilename,
  apiKey: string,
  language?: string
): Promise<MultiStrategySearchResult> {
  const cacheKey = buildSearchCacheKey(parsed, apiKey, language);
  const cached = getCachedValue(tmdbSearchCache, cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }

  const inFlight = tmdbSearchInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const searchPromise = createTMDBMultiStrategySearchPromise(
    cacheKey,
    parsed,
    apiKey,
    language
  );

  tmdbSearchInFlight.set(cacheKey, searchPromise);
  return searchPromise;
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
    const tmdbApiKey = normalizeTMDBCredential(
      settings.tmdbApiKey || process.env.TMDB_API_KEY || ""
    );

    if (!tmdbApiKey) {
      logger.warn("TMDB API key not configured. Skipping metadata scraping.");
      return null;
    }

    if (isLikelyGenericCaptureFilename(filename)) {
      logger.info(
        `[TMDB Scrape] Skipping TMDB lookup for generic capture filename "${filename}"`
      );
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
      if (searchResult.strategy === "auth-failed") {
        logger.warn(
          "TMDB authentication failed. Check whether the configured TMDB credential is a valid API key or Read Access Token."
        );
        return null;
      }
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
      thumbnailFilename?: string;
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

      const posterSaveLocation = resolvePosterSaveLocation(
        safeFilenameBase,
        thumbnailFilename
      );
      if (!posterSaveLocation) {
        logger.error("Unable to resolve a safe poster save location.");
        return metadata;
      }

      const downloaded = await downloadPoster(
        result.poster_path,
        posterSaveLocation.absolutePath
      );

      if (downloaded) {
        const webPath = `/images/${posterSaveLocation.relativePath}`;
        metadata.thumbnailPath = webPath;
        metadata.thumbnailUrl = webPath;
        // Store the actual filename (relative path) used for the scanController
        // This includes subdirectory if the file was saved in one
        metadata.thumbnailFilename = posterSaveLocation.relativePath;
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
