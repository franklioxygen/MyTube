import path from "path";

export interface ParsedFilename {
  titles: string[]; // Multiple title candidates (Chinese, English, alternative)
  year?: number;
  season?: number;
  episode?: number;
  isTVShow: boolean;
  quality?: string; // 1080p, 720p, etc.
  source?: string; // WEB-DL, BluRay, etc.
}

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

export function getSearchTitlePriority(title: string): number {
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
