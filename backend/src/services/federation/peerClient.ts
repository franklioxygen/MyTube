import { publicAxiosRequest } from "../../utils/publicAxios";
import { getInstanceId } from "./instanceIdentity";

/**
 * Authenticated requests from this prime to one peer. URLs are built only
 * from the stored base URL and fixed protocol paths; redirects are never
 * followed, and the federation credential goes to that peer alone.
 */

export interface PeerConnection {
  baseUrl: string;
  lanOrigin: string | null;
  credential: string;
}

export type PeerErrorKind =
  /** Unreachable, timed out, or a server fault: keep the last good state. */
  | "unavailable"
  /** The peer refused the credential (revoked, expired, suspended, rebound). */
  | "credential_rejected"
  /** The peer says it is this instance. */
  | "self_connection"
  /** The snapshot was discarded because the library or policy changed. */
  | "stale"
  /** The peer is at its snapshot limit. */
  | "busy"
  /** Not found (an asset or video, or an expired snapshot). */
  | "not_found"
  /** Anything that is not the protocol this instance speaks. */
  | "protocol";

export class PeerError extends Error {
  constructor(
    public readonly kind: PeerErrorKind,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "PeerError";
  }
}

const METADATA_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const CREDENTIAL_CODES = new Set([
  "FEDERATION_UNAUTHORIZED",
  "FEDERATION_TOKEN_REVOKED",
  "FEDERATION_TOKEN_EXPIRED",
  "FEDERATION_TOKEN_SUSPENDED",
  "FEDERATION_CONSUMER_MISMATCH",
  "FEDERATION_SCOPE_REQUIRED",
]);

export const protocolUrl = (peer: PeerConnection, path: string): string =>
  `${peer.baseUrl}/api/federation/v1${path}`;

/** Headers that identify this prime to the peer. */
export const peerAuthHeaders = (peer: PeerConnection): Record<string, string> => ({
  Authorization: `Federation ${peer.credential}`,
  "X-MyTube-Instance-Id": getInstanceId(),
});

const classify = (status: number, code: unknown): PeerError => {
  const label = typeof code === "string" ? code : `HTTP ${status}`;
  if (typeof code === "string" && CREDENTIAL_CODES.has(code)) {
    return new PeerError("credential_rejected", `The peer refused the credential (${label}).`, status);
  }
  if (code === "FEDERATION_SELF_CONNECTION") {
    return new PeerError("self_connection", "The peer is this instance.", status);
  }
  if (code === "FEDERATION_SNAPSHOT_STALE") {
    return new PeerError("stale", "The peer library changed during the sync.", status);
  }
  if (status === 429) return new PeerError("busy", "The peer is busy; retry later.", status);
  if (status === 404) return new PeerError("not_found", `Not found on the peer (${label}).`, status);
  if (status >= 500) return new PeerError("unavailable", `The peer failed (${label}).`, status);
  return new PeerError("protocol", `Unexpected peer response (${label}).`, status);
};

export async function peerJsonRequest(
  peer: PeerConnection,
  method: "get" | "post" | "delete",
  path: string,
  body?: unknown
): Promise<unknown> {
  let response;
  try {
    response = await publicAxiosRequest<unknown>(
      {
        url: protocolUrl(peer, path),
        method,
        headers: {
          ...peerAuthHeaders(peer),
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        data: body === undefined ? undefined : JSON.stringify(body),
        responseType: "json",
        maxRedirects: 0,
        timeout: METADATA_TIMEOUT_MS,
        maxContentLength: MAX_RESPONSE_BYTES,
        maxBodyLength: MAX_RESPONSE_BYTES,
        validateStatus: () => true,
      },
      peer.lanOrigin ?? undefined
    );
  } catch (error) {
    throw new PeerError(
      "unavailable",
      `The peer could not be reached: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (response.status >= 200 && response.status < 300) {
    return response.data;
  }
  const code = (response.data as { code?: unknown } | null)?.code;
  throw classify(response.status, code);
}
