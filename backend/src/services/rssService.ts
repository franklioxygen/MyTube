import crypto from "crypto";
import { and, desc, eq, gte, inArray, sql, SQL } from "drizzle-orm";
import { db } from "../db";
import { rssTokens, videos } from "../db/schema";
import { ValidationError } from "../errors/DownloadErrors";
import { logger } from "../utils/logger";
import { getRssTextLabels } from "./rssLocales";

export interface RssFilters {
  authors?: string[];
  channelUrls?: string[];
  tags?: string[];
  sources?: string[];
  dayRange?: number;
  maxItems?: number;
}

export interface RssToken {
  id: string;
  label: string;
  role: "admin" | "visitor";
  filters: RssFilters;
  isActive: boolean;
  accessCount: number;
  lastAccessedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateTokenInput {
  label?: string;
  role?: "admin" | "visitor";
  filters?: RssFilters;
}

export interface UpdateTokenInput {
  label?: string;
  filters?: RssFilters;
  isActive?: boolean;
}

const VALID_ROLES = ["admin", "visitor"] as const;
const VALID_SOURCES = ["youtube", "bilibili", "twitch", "local", "missav", "cloud"] as const;
export const RSS_FEED_PATH_PREFIX = "/api/rss/feed";
const MAX_FILTER_ARRAY_ITEMS = 100;
const MAX_DAY_RANGE = 3650;
const RSS_TTL_MINUTES = 15;
const SOURCE_DISPLAY_NAMES = new Map<string, string>([
  ["bilibili", "Bilibili"],
  ["cloud", "Cloud"],
  ["local", "Local"],
  ["missav", "MissAV"],
  ["twitch", "Twitch"],
  ["youtube", "YouTube"],
]);
const IMAGE_MIME_TYPES = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
]);

export function redactRssToken(token: string): string {
  return token.length <= 12 ? "[redacted]" : `${token.slice(0, 8)}...${token.slice(-4)}`;
}

export function rssTokenLogId(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function clampMaxItems(n?: number): number {
  if (n == null || !Number.isInteger(n)) return 50;
  return Math.min(Math.max(n, 1), 200);
}

function validateFilterRoot(raw: unknown): Record<string, unknown> | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("filters must be an object", "filters");
  }
  return raw as Record<string, unknown>;
}

function normalizeStringList(
  input: unknown,
  field: keyof RssFilters,
  options: { unique?: boolean; validate?: (value: string) => boolean; validationMessage?: string } = {}
): string[] | undefined {
  if (input == null) {
    return undefined;
  }
  if (!Array.isArray(input)) {
    throw new ValidationError(`${String(field)} must be a string array`, `filters.${String(field)}`);
  }

  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const value of input) {
    if (typeof value !== "string") {
      throw new ValidationError(`${String(field)} must be a string array`, `filters.${String(field)}`);
    }

    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    if (options.validate && !options.validate(trimmed)) {
      throw new ValidationError(
        options.validationMessage ?? `${String(field)} contains an invalid value`,
        `filters.${String(field)}`
      );
    }
    if (options.unique) {
      if (seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
    }
    cleaned.push(trimmed);
  }

  if (cleaned.length > MAX_FILTER_ARRAY_ITEMS) {
    throw new ValidationError(
      `${String(field)} cannot contain more than ${MAX_FILTER_ARRAY_ITEMS} items`,
      `filters.${String(field)}`
    );
  }

  return cleaned.length > 0 ? cleaned : undefined;
}

function isHttpAbsoluteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function validateAndNormalizeFilters(raw: unknown): RssFilters {
  const input = validateFilterRoot(raw);
  if (!input) {
    return {};
  }
  const result: RssFilters = {};

  const authors = normalizeStringList(input.authors, "authors", { unique: true });
  if (authors) result.authors = authors;

  const channelUrls = normalizeStringList(input.channelUrls, "channelUrls", {
    unique: true,
    validate: isHttpAbsoluteUrl,
    validationMessage: "channelUrls must contain only absolute http(s) URLs",
  });
  if (channelUrls) result.channelUrls = channelUrls;

  const tags = normalizeStringList(input.tags, "tags", { unique: true });
  if (tags) result.tags = tags;

  const sources = normalizeStringList(input.sources, "sources", {
    unique: true,
    validate: (value) => (VALID_SOURCES as readonly string[]).includes(value),
    validationMessage: `sources must be one of: ${VALID_SOURCES.join(", ")}`,
  });
  if (sources) result.sources = sources;

  if (input.dayRange != null) {
    if (
      typeof input.dayRange !== "number" ||
      !Number.isInteger(input.dayRange) ||
      input.dayRange < 1 ||
      input.dayRange > MAX_DAY_RANGE
    ) {
      throw new ValidationError(
        `dayRange must be an integer between 1 and ${MAX_DAY_RANGE}`,
        "filters.dayRange"
      );
    }
    result.dayRange = input.dayRange;
  }

  if (input.maxItems != null) {
    if (
      typeof input.maxItems !== "number" ||
      !Number.isInteger(input.maxItems) ||
      input.maxItems < 1 ||
      input.maxItems > 200
    ) {
      throw new ValidationError("maxItems must be an integer between 1 and 200", "filters.maxItems");
    }
    result.maxItems = input.maxItems;
  }

  return result;
}

function normalizeStoredFilters(raw: unknown, tokenId: string): RssFilters {
  try {
    return validateAndNormalizeFilters(raw);
  } catch (error) {
    logger.warn("Stored RSS token filters are invalid; using empty filters", {
      tokenId: rssTokenLogId(tokenId),
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

function rowToToken(row: typeof rssTokens.$inferSelect): RssToken {
  let filters: RssFilters = {};
  try {
    filters = normalizeStoredFilters(JSON.parse(row.filters), row.id);
  } catch (error) {
    logger.warn("Stored RSS token filters are not valid JSON; using empty filters", {
      tokenId: rssTokenLogId(row.id),
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const role = row.role === "admin" || row.role === "visitor" ? row.role : "visitor";
  if (role !== row.role) {
    logger.warn("RSS token has invalid role; treating it as visitor", {
      tokenId: rssTokenLogId(row.id),
    });
  }

  return {
    id: row.id,
    label: row.label,
    role,
    filters,
    isActive: row.isActive === 1,
    accessCount: row.accessCount,
    lastAccessedAt: row.lastAccessedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listRssTokens(): Promise<RssToken[]> {
  const rows = db.select().from(rssTokens).orderBy(desc(rssTokens.createdAt)).all();
  return rows.map(rowToToken);
}

export async function createRssToken(input: CreateTokenInput): Promise<RssToken> {
  const role = input.role ?? "visitor";
  if (!validateRole(role)) {
    throw new ValidationError('Role must be "admin" or "visitor"', "role");
  }
  const filters = validateAndNormalizeFilters(input.filters ?? {});
  const now = Date.now();
  const id = crypto.randomUUID();

  db.insert(rssTokens).values({
    id,
    label: input.label ?? "",
    role,
    filters: JSON.stringify(filters),
    isActive: 1,
    accessCount: 0,
    lastAccessedAt: null,
    createdAt: now,
    updatedAt: now,
  }).run();

  const row = db.select().from(rssTokens).where(eq(rssTokens.id, id)).get();
  if (!row) throw new Error("Failed to create RSS token");
  return rowToToken(row);
}

export async function updateRssToken(
  id: string,
  patch: UpdateTokenInput
): Promise<RssToken | null> {
  const existing = db.select().from(rssTokens).where(eq(rssTokens.id, id)).get();
  if (!existing) return null;

  const updates: Partial<typeof rssTokens.$inferInsert> = {
    updatedAt: Date.now(),
  };

  if (patch.label !== undefined) {
    updates.label = patch.label;
  }
  if (patch.isActive !== undefined) {
    updates.isActive = patch.isActive ? 1 : 0;
  }
  if (patch.filters !== undefined) {
    const normalized = validateAndNormalizeFilters(patch.filters);
    updates.filters = JSON.stringify(normalized);
  }

  db.update(rssTokens).set(updates).where(eq(rssTokens.id, id)).run();

  const updated = db.select().from(rssTokens).where(eq(rssTokens.id, id)).get();
  return updated ? rowToToken(updated) : null;
}

export async function deleteRssToken(id: string): Promise<boolean> {
  const existing = db.select().from(rssTokens).where(eq(rssTokens.id, id)).get();
  if (!existing) return false;
  db.delete(rssTokens).where(eq(rssTokens.id, id)).run();
  return true;
}

export async function resetRssToken(
  id: string
): Promise<{ oldId: string; token: RssToken } | null> {
  // Use SQLite transaction for atomic reset
  const result = db.transaction(() => {
    const old = db.select().from(rssTokens).where(eq(rssTokens.id, id)).get();
    if (!old) return null;

    const newId = crypto.randomUUID();
    const now = Date.now();

    db.insert(rssTokens).values({
      id: newId,
      label: old.label,
      role: old.role,
      filters: old.filters,
      isActive: old.isActive,
      accessCount: 0,
      lastAccessedAt: null,
      createdAt: now,
      updatedAt: now,
    }).run();

    db.delete(rssTokens).where(eq(rssTokens.id, id)).run();

    const newRow = db.select().from(rssTokens).where(eq(rssTokens.id, newId)).get();
    if (!newRow) return null;

    return { oldId: id, token: rowToToken(newRow) };
  });

  return result ?? null;
}

export async function getRssToken(id: string): Promise<RssToken | null> {
  const row = db.select().from(rssTokens).where(eq(rssTokens.id, id)).get();
  return row ? rowToToken(row) : null;
}

export async function getVideosForRss(
  filters: RssFilters,
  role: "admin" | "visitor"
): Promise<Array<typeof videos.$inferSelect>> {
  const normalizedFilters = validateAndNormalizeFilters(filters);
  const conditions: SQL[] = [];

  const feedDate = sql<string>`COALESCE(NULLIF(${videos.addedAt}, ''), ${videos.createdAt})`;

  if (role === "visitor") {
    conditions.push(eq(videos.visibility, 1));
  }

  if (normalizedFilters.authors?.length) {
    conditions.push(inArray(videos.author, normalizedFilters.authors));
  }

  if (normalizedFilters.channelUrls?.length) {
    conditions.push(inArray(videos.channelUrl, normalizedFilters.channelUrls));
  }

  if (normalizedFilters.sources?.length) {
    conditions.push(inArray(videos.source, normalizedFilters.sources));
  }

  if (normalizedFilters.dayRange) {
    const cutoff = Date.now() - normalizedFilters.dayRange * 24 * 60 * 60 * 1000;
    conditions.push(gte(feedDate, new Date(cutoff).toISOString()));
  }

  if (normalizedFilters.tags?.length) {
    const tagValues = normalizedFilters.tags.map((tag) => sql`${tag}`);
    conditions.push(sql`EXISTS (
      SELECT 1
      FROM json_each(
        CASE
          WHEN json_valid(${videos.tags}) THEN ${videos.tags}
          ELSE '[]'
        END
      )
      WHERE json_each.value IN (${sql.join(tagValues, sql`, `)})
    )`);
  }

  const maxItems = clampMaxItems(normalizedFilters.maxItems);
  const baseQuery = db.select().from(videos).$dynamic();
  const filteredQuery =
    conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;

  return filteredQuery.orderBy(desc(feedDate)).limit(maxItems).all();
}

export async function recordAccess(tokenId: string): Promise<void> {
  const now = Date.now();
  db.update(rssTokens)
    .set({
      accessCount: sql`${rssTokens.accessCount} + 1`,
      lastAccessedAt: now,
    })
    .where(eq(rssTokens.id, tokenId))
    .run();
}

// --- RSS XML building ---

function escapeXmlText(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeHtml(value: unknown): string {
  return escapeXmlText(value);
}

export function wrapCdata(value: string): string {
  return `<![CDATA[${value.split("]]>").join("]]]]><![CDATA[>")}]]>`;
}

function formatRssDate(
  value: string | number | Date | null | undefined,
  fallback: Date = new Date()
): string {
  if (value == null || value === "") return fallback.toUTCString();
  const parsed = new Date(value as string | number | Date);
  if (Number.isNaN(parsed.getTime())) return fallback.toUTCString();
  return parsed.toUTCString();
}

function buildAbsoluteUrl(baseUrl: string, webPath: string): string {
  if (/^https?:\/\//i.test(webPath)) return webPath;
  return `${baseUrl}${webPath.startsWith("/") ? webPath : `/${webPath}`}`;
}

export function buildRssFeedUrl(baseUrl: string, tokenId: string): string {
  return `${baseUrl}${RSS_FEED_PATH_PREFIX}/${tokenId}`;
}

function buildThumbnailUrl(
  video: typeof videos.$inferSelect,
  baseUrl: string
): string | null {
  const rawPath = video.thumbnailPath || video.thumbnailUrl;
  if (!rawPath) return null;

  if (rawPath.startsWith("cloud:")) {
    return `${baseUrl}/cloud/images/${encodeURIComponent(rawPath.slice("cloud:".length))}`;
  }

  if (
    rawPath.startsWith("/images/") ||
    rawPath.startsWith("/images-small/") ||
    rawPath.startsWith("/videos/")
  ) {
    return buildAbsoluteUrl(baseUrl, rawPath);
  }

  if (/^https?:\/\//i.test(rawPath)) return rawPath;

  return buildAbsoluteUrl(baseUrl, rawPath.replace(/^\/+/, ""));
}

function inferThumbnailMimeType(url: string): string | null {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return IMAGE_MIME_TYPES.get(ext) ?? null;
}

function formatRssDuration(duration: string | null | undefined): string | null {
  if (!duration) return null;
  const trimmed = duration.trim();
  if (!trimmed) return null;
  if (trimmed.includes(":")) return trimmed;

  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds) || seconds <= 0) return trimmed;

  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatRssSource(source: string | null | undefined): string | null {
  if (!source) return null;
  const trimmed = source.trim();
  if (!trimmed) return null;
  return SOURCE_DISPLAY_NAMES.get(trimmed.toLowerCase()) ?? trimmed;
}

function mapLanguage(lang?: string): string {
  if (!lang) return "en-us";
  const lower = lang.toLowerCase();
  if (lower === "zh") return "zh-cn";
  if (lower === "en") return "en-us";
  return lower;
}

export function buildRssXml(
  videoList: Array<typeof videos.$inferSelect>,
  token: RssToken,
  baseUrl: string,
  options?: { language?: string }
): string {
  const feedUrl = buildRssFeedUrl(baseUrl, token.id);
  const language = mapLanguage(options?.language);
  const textLabels = getRssTextLabels(language);
  const now = new Date();

  const lastBuildDateSource =
    videoList.length > 0
      ? (videoList[0].addedAt || videoList[0].createdAt)
      : token.updatedAt;
  const lastBuildDate = formatRssDate(lastBuildDateSource, now);

  const label = token.label || "My Feed";
  const labelEscaped = escapeXmlText(label);
  const channelDescriptionEscaped = escapeXmlText(
    `${textLabels.channelDescriptionPrefix}${label}`
  );
  const feedUrlEscaped = escapeXmlText(feedUrl);
  const baseUrlEscaped = escapeXmlText(baseUrl);

  const items = videoList.map((video) => {
    const pubDateSource = video.addedAt || video.createdAt;
    let pubDate: string;
    if (!pubDateSource) {
      logger.warn(`Video ${video.id} missing both addedAt and createdAt, using current time for pubDate`);
      pubDate = now.toUTCString();
    } else {
      const parsed = new Date(pubDateSource);
      if (Number.isNaN(parsed.getTime())) {
        logger.warn(`Video ${video.id} has invalid date: ${pubDateSource}, using current time for pubDate`);
        pubDate = now.toUTCString();
      } else {
        pubDate = parsed.toUTCString();
      }
    }

    const videoLink = `${baseUrl}/video/${video.id}`;
    const thumbnailUrl = buildThumbnailUrl(video, baseUrl);

    let parsedTags: string[] = [];
    try {
      if (video.tags) parsedTags = JSON.parse(video.tags) as string[];
    } catch {
      if (video.tags) logger.warn(`Video ${video.id} has invalid tags JSON`);
    }

    const descParts: string[] = [];
    if (video.author) {
      descParts.push(
        `<p>${escapeHtml(textLabels.author)}${textLabels.separator}${escapeHtml(video.author)}</p>`
      );
    }
    const sourceLabel = formatRssSource(video.source);
    if (sourceLabel) {
      descParts.push(
        `<p>${escapeHtml(textLabels.source)}${textLabels.separator}${escapeHtml(sourceLabel)}</p>`
      );
    }
    const durationLabel = formatRssDuration(video.duration);
    if (durationLabel) {
      descParts.push(
        `<p>${escapeHtml(textLabels.duration)}${textLabels.separator}${escapeHtml(durationLabel)}</p>`
      );
    }
    // eslint-disable-next-line xss/no-mixed-html -- all dynamic fields in descParts are HTML-escaped before join.
    const descHtml = descParts.join("\n    ");
    // eslint-disable-next-line xss/no-mixed-html -- sanitized description HTML is isolated inside RSS CDATA.
    const descriptionCdata = wrapCdata(`\n    ${descHtml}\n  `);

    const categoryTags = parsedTags
      .map((tag) => `    <category>${escapeXmlText(tag)}</category>`)
      .join("\n");

    const mediaThumbnail = thumbnailUrl
      ? `    <media:thumbnail url="${escapeXmlText(thumbnailUrl)}" />`
      : "";

    let mediaContent = "";
    if (thumbnailUrl) {
      const mimeType = inferThumbnailMimeType(thumbnailUrl);
      mediaContent = mimeType
        ? `    <media:content url="${escapeXmlText(thumbnailUrl)}" medium="image" type="${escapeXmlText(mimeType)}"/>`
        : `    <media:content url="${escapeXmlText(thumbnailUrl)}" medium="image"/>`;
    }

    return `  <item>
    <title>${escapeXmlText(video.title)}</title>
    <link>${escapeXmlText(videoLink)}</link>
    <guid isPermaLink="false">${escapeXmlText(video.id)}</guid>
    <pubDate>${pubDate}</pubDate>
    <description>${descriptionCdata}</description>${video.author ? `\n    <dc:creator>${escapeXmlText(video.author)}</dc:creator>` : ""}
${categoryTags}
${mediaThumbnail}
${mediaContent}
  </item>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"
                   xmlns:dc="http://purl.org/dc/elements/1.1/"
                   xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>MyTube · ${labelEscaped}</title>
    <link>${baseUrlEscaped}</link>
    <description>${channelDescriptionEscaped}</description>
    <language>${escapeXmlText(language)}</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <ttl>${RSS_TTL_MINUTES}</ttl>
    <atom:link href="${feedUrlEscaped}" rel="self" type="application/rss+xml"/>
${items.join("\n")}
  </channel>
</rss>`;
}

export function buildErrorRssXml(opts: {
  title: string;
  link: string;
  description: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXmlText(opts.title)}</title>
    <link>${escapeXmlText(opts.link)}</link>
    <description>${escapeXmlText(opts.description)}</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
  </channel>
</rss>`;
}

type BaseUrlRequest = {
  protocol: string;
  get: (key: string) => string | undefined;
};

function getHostName(host: string | undefined): string {
  if (!host) {
    return "";
  }

  if (host.startsWith("[")) {
    return host.slice(1, host.indexOf("]")).toLowerCase();
  }

  return host.split(":")[0]?.toLowerCase() ?? "";
}

function isLocalHost(host: string | undefined): boolean {
  const hostname = getHostName(host);
  return (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.startsWith("127.") ||
    hostname.endsWith(".localhost")
  );
}

function normalizeProxyProtocol(value: string | undefined): string | null {
  const protocol = value?.split(",")[0]?.trim().toLowerCase();
  return protocol === "http" || protocol === "https" ? protocol : null;
}

function getCloudflareVisitorScheme(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as { scheme?: unknown };
    return typeof parsed.scheme === "string"
      ? normalizeProxyProtocol(parsed.scheme)
      : null;
  } catch {
    return null;
  }
}

function getRequestProtocol(req: BaseUrlRequest): string {
  const proxyProtocol =
    normalizeProxyProtocol(req.get("x-forwarded-proto")) ??
    getCloudflareVisitorScheme(req.get("cf-visitor"));

  if (proxyProtocol) {
    return proxyProtocol;
  }

  if (req.protocol === "http" && !isLocalHost(req.get("host"))) {
    return "https";
  }

  return req.protocol;
}

export function getBaseUrl(req: BaseUrlRequest): string {
  const configured = process.env.MYTUBE_PUBLIC_URL || process.env.BASE_URL;
  const raw = configured || `${getRequestProtocol(req)}://${req.get("host")}`;
  return raw.replace(/\/+$/, "");
}

export function setRssNoStoreHeaders(res: { set: (key: string, value: string) => void }): void {
  res.set("Cache-Control", "private, no-store");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer");
}

export function setRssManagementNoStoreHeaders(res: { set: (key: string, value: string) => void }): void {
  res.set("Cache-Control", "no-store");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("X-Content-Type-Options", "nosniff");
}

export function validateRole(role: unknown): role is "admin" | "visitor" {
  return (VALID_ROLES as readonly unknown[]).includes(role);
}
