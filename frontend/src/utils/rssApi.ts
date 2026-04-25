import { api } from "./apiClient";

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
  feedUrl: string;
}

export interface CreateTokenInput {
  label: string;
  role: "admin" | "visitor";
  filters: RssFilters;
}

export interface UpdateTokenInput {
  label?: string;
  filters?: RssFilters;
  isActive?: boolean;
}

export const rssApi = {
  listTokens: () => api.get<{ tokens: RssToken[] }>("/rss/tokens"),
  createToken: (data: CreateTokenInput) =>
    api.post<{ token: RssToken }>("/rss/tokens", data),
  updateToken: (id: string, patch: UpdateTokenInput) =>
    api.put<{ token: RssToken }>(`/rss/tokens/${id}`, patch),
  deleteToken: (id: string) => api.delete(`/rss/tokens/${id}`),
  resetToken: (id: string) =>
    api.post<{ oldId: string; token: RssToken }>(`/rss/tokens/${id}/reset`),
};
