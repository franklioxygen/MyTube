import { api } from "./apiClient";

/** Multi-instance federation (issue #354): owner-only management API. */

export type FederationScope = "library:read" | "media:read";
export type FederationVisibility = "public" | "owner";
export type FederationTokenStatus = "active" | "suspended" | "expired" | "revoked";

export interface FederationToken {
  id: string;
  label: string;
  scopes: FederationScope[];
  visibilityCeiling: FederationVisibility;
  consumerInstanceId: string | null;
  expiresAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
  status: FederationTokenStatus;
}

/** A credential is returned only by the call that issues it. */
export interface IssuedFederationCredential {
  token: FederationToken;
  credential: string;
}

export interface CreateFederationTokenInput {
  label: string;
  scopes: FederationScope[];
  visibilityCeiling: FederationVisibility;
  expiresAt: number | null;
}

export type FederationPeerStatus =
  | "pending"
  | "ok"
  | "error"
  | "credential_rejected"
  | "credential_missing"
  | "identity_mismatch"
  | "incompatible";

export interface FederationPeer {
  id: string;
  peerInstanceId: string;
  name: string;
  baseUrl: string;
  lanException: boolean;
  audience: FederationVisibility;
  canStreamMedia: boolean;
  enabled: boolean;
  status: FederationPeerStatus;
  lastError: string | null;
  lastSuccessAt: number | null;
}

export interface FederationSyncResult {
  status: FederationPeerStatus;
  changed: boolean;
  upserted?: number;
  tombstoned?: number;
  error?: string;
}

export const federationApi = {
  listTokens: () =>
    api.get<{ instanceId: string; tokens: FederationToken[] }>("/federation/tokens"),
  createToken: (input: CreateFederationTokenInput) =>
    api.post<IssuedFederationCredential>("/federation/tokens", input),
  rotateToken: (id: string) =>
    api.post<IssuedFederationCredential>(`/federation/tokens/${encodeURIComponent(id)}/rotate`),
  revokeToken: (id: string) => api.post(`/federation/tokens/${encodeURIComponent(id)}/revoke`),
  resumeToken: (id: string) => api.post(`/federation/tokens/${encodeURIComponent(id)}/resume`),
  deleteToken: (id: string) => api.delete(`/federation/tokens/${encodeURIComponent(id)}`),
  resetIdentity: () =>
    api.post<{ instanceId: string; revokedTokens: number }>("/federation/identity/reset"),

  listPeers: () => api.get<{ peers: FederationPeer[] }>("/federation/peers"),
  addPeer: (input: { name: string; baseUrl: string; credential: string }) =>
    api.post<{ peer: FederationPeer }>("/federation/peers", input),
  setPeerEnabled: (id: string, enabled: boolean) =>
    api.patch<{ peer: FederationPeer }>(`/federation/peers/${encodeURIComponent(id)}`, { enabled }),
  replacePeerCredential: (id: string, credential: string) =>
    api.put<{ peer: FederationPeer }>(`/federation/peers/${encodeURIComponent(id)}/credential`, {
      credential,
    }),
  syncPeer: (id: string) =>
    api.post<{ result: FederationSyncResult; peer: FederationPeer }>(
      `/federation/peers/${encodeURIComponent(id)}/sync`
    ),
  removePeer: (id: string) =>
    api.delete<{ removedItems: number }>(`/federation/peers/${encodeURIComponent(id)}`),
};
