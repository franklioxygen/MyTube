import type {
  FederationSubtitleTrack,
  FederationVideoDetail,
  FederationVideoSummary,
} from "./libraryExport";

/**
 * Validators for what a peer sends a prime (design §5.1). Only known fields
 * survive, each type- and length-checked; unknown optional fields are
 * ignored. The peer builds the same shapes in libraryExport, and contract
 * tests run its real output through these.
 */

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fail = (field: string): never => {
  throw new ProtocolError(`Invalid or missing field: ${field}`);
};

const str = (value: unknown, field: string, max: number): string =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : fail(field);

const optStr = (value: unknown, field: string, max: number): string | null =>
  value === null || value === undefined ? null : typeof value === "string" && value.length <= max ? value : fail(field);

const optNum = (value: unknown, field: string): number | null =>
  value === null || value === undefined
    ? null
    : typeof value === "number" && Number.isFinite(value)
      ? value
      : fail(field);

const bool = (value: unknown, field: string): boolean =>
  typeof value === "boolean" ? value : fail(field);

const strList = (value: unknown, field: string, maxItems: number, maxLength: number): string[] =>
  Array.isArray(value) &&
  value.length <= maxItems &&
  value.every((item) => typeof item === "string" && item.length <= maxLength)
    ? (value as string[])
    : fail(field);

export const MAX_REMOTE_ID_LENGTH = 200;

export interface PeerCapabilities {
  instanceId: string;
  protocolVersions: number[];
  features: string[];
  credential: {
    id: string;
    scopes: string[];
    visibilityCeiling: "public" | "owner";
    policyRevision: string;
  };
  limits: { snapshotPageSize: number };
}

export function parseCapabilities(body: unknown): PeerCapabilities {
  if (!isObject(body) || body.protocol !== "mytube-federation") fail("protocol");
  const caps = body as Json;
  const credential = isObject(caps.credential) ? caps.credential : fail("credential");
  const ceiling = credential.visibilityCeiling;
  const versions = caps.protocolVersions;
  const limits = isObject(caps.limits) ? caps.limits : {};
  const pageSize = optNum(limits.snapshotPageSize, "limits.snapshotPageSize") ?? 500;
  return {
    instanceId: str(caps.instanceId, "instanceId", 64),
    protocolVersions:
      Array.isArray(versions) && versions.every((v) => Number.isInteger(v))
        ? (versions as number[])
        : fail("protocolVersions"),
    features: strList(caps.features, "features", 64, 64),
    credential: {
      id: str(credential.id, "credential.id", 64),
      scopes: strList(credential.scopes, "credential.scopes", 16, 64),
      visibilityCeiling: ceiling === "public" || ceiling === "owner" ? ceiling : fail("credential.visibilityCeiling"),
      policyRevision: str(credential.policyRevision, "credential.policyRevision", 128),
    },
    limits: {
      snapshotPageSize:
        Number.isInteger(pageSize) && pageSize > 0 && pageSize <= 5000 ? pageSize : fail("limits.snapshotPageSize"),
    },
  };
}

export interface LibraryRevision {
  audience: "public" | "owner";
  libraryRevision: string;
  policyRevision: string;
}

const audienceOf = (value: unknown): "public" | "owner" =>
  value === "public" || value === "owner" ? value : fail("audience");

export function parseLibraryRevision(body: unknown): LibraryRevision {
  const revision = isObject(body) ? body : fail("revision");
  return {
    audience: audienceOf(revision.audience),
    libraryRevision: str(revision.libraryRevision, "libraryRevision", 128),
    policyRevision: str(revision.policyRevision, "policyRevision", 128),
  };
}

export interface SnapshotDescriptor extends LibraryRevision {
  snapshotId: string;
  instanceId: string;
  totalCount: number;
  pageSize: number;
}

export function parseSnapshotDescriptor(body: unknown): SnapshotDescriptor {
  const snapshot = isObject(body) ? body : fail("snapshot");
  const totalCount = optNum(snapshot.totalCount, "totalCount");
  const pageSize = optNum(snapshot.pageSize, "pageSize");
  return {
    ...parseLibraryRevision(snapshot),
    snapshotId: str(snapshot.snapshotId, "snapshotId", 128),
    instanceId: str(snapshot.instanceId, "instanceId", 64),
    totalCount: totalCount !== null && Number.isInteger(totalCount) && totalCount >= 0 ? totalCount : fail("totalCount"),
    pageSize: pageSize !== null && Number.isInteger(pageSize) && pageSize > 0 ? pageSize : fail("pageSize"),
  };
}

export function parseSummary(item: unknown): FederationVideoSummary {
  const v = isObject(item) ? item : fail("item");
  const assets = isObject(v.assets) ? v.assets : fail("assets");
  const visibility = v.visibility === 0 || v.visibility === 1 ? v.visibility : fail("visibility");
  return {
    id: str(v.id, "id", MAX_REMOTE_ID_LENGTH),
    title: str(v.title, "title", 4000),
    author: optStr(v.author, "author", 2000),
    date: optStr(v.date, "date", 64),
    source: optStr(v.source, "source", 64),
    sourceUrl: optStr(v.sourceUrl, "sourceUrl", 2048),
    sourceVideoId: optStr(v.sourceVideoId, "sourceVideoId", 200),
    channelUrl: optStr(v.channelUrl, "channelUrl", 2048),
    addedAt: optStr(v.addedAt, "addedAt", 64),
    createdAt: str(v.createdAt, "createdAt", 64),
    updatedAt: optStr(v.updatedAt, "updatedAt", 64),
    partNumber: optNum(v.partNumber, "partNumber"),
    totalParts: optNum(v.totalParts, "totalParts"),
    seriesTitle: optStr(v.seriesTitle, "seriesTitle", 4000),
    rating: optNum(v.rating, "rating"),
    duration: optStr(v.duration, "duration", 64),
    width: optNum(v.width, "width"),
    height: optNum(v.height, "height"),
    fileSize: optStr(v.fileSize, "fileSize", 32),
    mediaType: str(v.mediaType, "mediaType", 32),
    tags: strList(v.tags, "tags", 1000, 500),
    visibility,
    assets: {
      media: bool(assets.media, "assets.media"),
      thumbnail: bool(assets.thumbnail, "assets.thumbnail"),
      avatar: bool(assets.avatar, "assets.avatar"),
      subtitles: bool(assets.subtitles, "assets.subtitles"),
    },
    assetRevision: str(v.assetRevision, "assetRevision", 128),
  };
}

export interface SnapshotPage {
  snapshotId: string;
  totalCount: number;
  items: FederationVideoSummary[];
  nextCursor: string | null;
  complete: boolean;
}

export function parseSnapshotPage(body: unknown, maxItems: number): SnapshotPage {
  const page = isObject(body) ? body : fail("page");
  const items = Array.isArray(page.items) && page.items.length <= maxItems ? page.items : fail("items");
  const totalCount = optNum(page.totalCount, "totalCount");
  const complete = bool(page.complete, "complete");
  const nextCursor = optStr(page.nextCursor, "nextCursor", 512);
  if (complete === (nextCursor !== null)) fail("nextCursor");
  return {
    snapshotId: str(page.snapshotId, "snapshotId", 128),
    totalCount: totalCount !== null && Number.isInteger(totalCount) && totalCount >= 0 ? totalCount : fail("totalCount"),
    items: items.map(parseSummary),
    nextCursor,
    complete,
  };
}

const parseTrack = (track: unknown): FederationSubtitleTrack => {
  const t = isObject(track) ? track : fail("subtitles");
  return {
    trackId: str(t.trackId, "subtitles.trackId", 64),
    language: optStr(t.language, "subtitles.language", 64),
    format: str(t.format, "subtitles.format", 8),
  };
};

export function parseDetail(body: unknown): FederationVideoDetail {
  const detail = isObject(body) ? body : fail("detail");
  const subtitles =
    Array.isArray(detail.subtitles) && detail.subtitles.length <= 100 ? detail.subtitles : fail("subtitles");
  return {
    ...parseSummary(detail),
    description: optStr(detail.description, "description", 1_000_000),
    subtitles: subtitles.map(parseTrack),
  };
}
