import axios from "axios";
import { ValidationError } from "../errors/DownloadErrors";
import * as storageService from "./storageService";

export interface TwitchChannelInfo {
  id: string;
  login: string;
  displayName: string;
  description: string;
  profileImageUrl: string | null;
  offlineImageUrl: string | null;
  url: string;
}

export interface TwitchVideoInfo {
  id: string;
  userId: string;
  userLogin: string;
  userName: string;
  title: string;
  description: string;
  url: string;
  thumbnailUrl: string | null;
  createdAt: string;
  publishedAt: string;
  viewCount: number;
  duration: string;
  type: "archive" | "upload" | "highlight";
}

type TwitchTokenState = {
  accessToken: string;
  expiresAt: number;
  clientId: string;
  clientSecret: string;
};

type TwitchUserApiRecord = {
  id: string;
  login: string;
  display_name: string;
  description: string;
  profile_image_url: string | null;
  offline_image_url: string | null;
};

type TwitchVideoApiRecord = {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  title: string;
  description: string;
  url: string;
  thumbnail_url: string | null;
  created_at: string;
  published_at: string;
  view_count: number;
  duration: string;
  type: "archive" | "upload" | "highlight";
};

type TwitchUsersResponse = {
  data: TwitchUserApiRecord[];
};

type TwitchVideosResponse = {
  data: TwitchVideoApiRecord[];
  pagination?: {
    cursor?: string;
  };
};

const TWITCH_OAUTH_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_HELIX_BASE_URL = "https://api.twitch.tv/helix";
const TOKEN_REFRESH_BUFFER_MS = 60_000;
const TWITCH_API_TIMEOUT_MS = Number.parseInt(
  process.env.TWITCH_API_TIMEOUT_MS || "15000",
  10
);

const mapChannelInfo = (record: TwitchUserApiRecord): TwitchChannelInfo => ({
  id: record.id,
  login: record.login,
  displayName: record.display_name,
  description: record.description || "",
  profileImageUrl: record.profile_image_url || null,
  offlineImageUrl: record.offline_image_url || null,
  url: `https://www.twitch.tv/${record.login}`,
});

const mapVideoInfo = (record: TwitchVideoApiRecord): TwitchVideoInfo => ({
  id: record.id,
  userId: record.user_id,
  userLogin: record.user_login,
  userName: record.user_name,
  title: record.title,
  description: record.description || "",
  url: record.url,
  thumbnailUrl: record.thumbnail_url || null,
  createdAt: record.created_at,
  publishedAt: record.published_at,
  viewCount: Number.isFinite(record.view_count) ? record.view_count : 0,
  duration: record.duration,
  type: record.type,
});

export class TwitchApiService {
  private tokenState: TwitchTokenState | null = null;
  private blockedUntil: number | null = null;

  private syncCredentialState(clientId: string, clientSecret: string): void {
    if (
      this.tokenState &&
      (this.tokenState.clientId !== clientId ||
        this.tokenState.clientSecret !== clientSecret)
    ) {
      this.invalidateCache();
    }
  }

  private getClientCredentials(): {
    clientId: string;
    clientSecret: string;
  } {
    const settings = storageService.getSettings();
    const clientId = String(settings.twitchClientId || "").trim();
    const clientSecret = String(settings.twitchClientSecret || "").trim();

    if (!clientId || !clientSecret) {
      throw new ValidationError(
        "Twitch client credentials are required for Twitch API requests.",
        !clientId ? "twitchClientId" : "twitchClientSecret"
      );
    }

    return { clientId, clientSecret };
  }

  private ensureRateLimitAvailable(): void {
    if (this.blockedUntil && Date.now() < this.blockedUntil) {
      throw new Error(
        `Twitch API is temporarily rate limited until ${new Date(
          this.blockedUntil
        ).toISOString()}.`
      );
    }
  }

  private recordRateLimitBlock(headers: Record<string, unknown> | undefined): void {
    const rawReset =
      headers?.["ratelimit-reset"] ??
      headers?.["Ratelimit-Reset"] ??
      headers?.["RateLimit-Reset"];
    const resetSeconds =
      typeof rawReset === "string"
        ? Number.parseInt(rawReset, 10)
        : typeof rawReset === "number"
          ? rawReset
          : NaN;

    this.blockedUntil =
      Number.isFinite(resetSeconds) && resetSeconds > 0
        ? resetSeconds * 1000
        : Date.now() + 60_000;
  }

  private async getAppAccessToken(
    clientId: string,
    clientSecret: string,
    forceRefresh = false
  ): Promise<string> {
    this.syncCredentialState(clientId, clientSecret);
    this.ensureRateLimitAvailable();

    if (
      !forceRefresh &&
      this.tokenState &&
      Date.now() < this.tokenState.expiresAt - TOKEN_REFRESH_BUFFER_MS
    ) {
      return this.tokenState.accessToken;
    }

    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    });
    const response = await axios.post(TWITCH_OAUTH_URL, params, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: TWITCH_API_TIMEOUT_MS,
    });

    const accessToken = response.data?.access_token;
    const expiresIn = Number(response.data?.expires_in || 0);
    if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error("Twitch OAuth token response was missing access token metadata.");
    }

    this.tokenState = {
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
      clientId,
      clientSecret,
    };

    return accessToken;
  }

  private async helixGet<T>(
    path: string,
    params: Record<string, string | number | undefined>,
    allowRetry = true
  ): Promise<T> {
    const { clientId, clientSecret } = this.getClientCredentials();
    this.syncCredentialState(clientId, clientSecret);
    this.ensureRateLimitAvailable();
    const accessToken = await this.getAppAccessToken(clientId, clientSecret);

    try {
      const response = await axios.get<T>(`${TWITCH_HELIX_BASE_URL}${path}`, {
        params,
        headers: {
          "Client-Id": clientId,
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: TWITCH_API_TIMEOUT_MS,
      });

      if (this.blockedUntil && Date.now() >= this.blockedUntil) {
        this.blockedUntil = null;
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;

        if (status === 401 && allowRetry) {
          this.tokenState = null;
          return this.helixGet<T>(path, params, false);
        }

        if (status === 429) {
          this.recordRateLimitBlock(
            error.response?.headers as Record<string, unknown> | undefined
          );
        }
      }

      throw error;
    }
  }

  public ensureConfigured(): void {
    this.getClientCredentials();
  }

  public isConfigured(): boolean {
    try {
      this.getClientCredentials();
      return true;
    } catch {
      return false;
    }
  }

  public invalidateCache(): void {
    this.tokenState = null;
    this.blockedUntil = null;
  }

  public async getChannelByLogin(
    login: string
  ): Promise<TwitchChannelInfo | null> {
    const normalizedLogin = login.trim().toLowerCase();
    if (!normalizedLogin) {
      return null;
    }

    const response = await this.helixGet<TwitchUsersResponse>("/users", {
      login: normalizedLogin,
    });
    return response.data[0] ? mapChannelInfo(response.data[0]) : null;
  }

  public async getChannelById(id: string): Promise<TwitchChannelInfo | null> {
    const normalizedId = id.trim();
    if (!normalizedId) {
      return null;
    }

    const response = await this.helixGet<TwitchUsersResponse>("/users", {
      id: normalizedId,
    });
    return response.data[0] ? mapChannelInfo(response.data[0]) : null;
  }

  public async getVideoById(id: string): Promise<TwitchVideoInfo | null> {
    const normalizedId = id.trim();
    if (!normalizedId) {
      return null;
    }

    const response = await this.helixGet<TwitchVideosResponse>("/videos", {
      id: normalizedId,
    });
    return response.data[0] ? mapVideoInfo(response.data[0]) : null;
  }

  public async listVideosByBroadcaster(
    broadcasterId: string,
    options: {
      after?: string;
      first?: number;
      type?: "archive" | "upload" | "highlight" | "all";
    } = {}
  ): Promise<{ videos: TwitchVideoInfo[]; cursor?: string }> {
    const normalizedBroadcasterId = broadcasterId.trim();
    if (!normalizedBroadcasterId) {
      return { videos: [] };
    }

    const response = await this.helixGet<TwitchVideosResponse>("/videos", {
      user_id: normalizedBroadcasterId,
      after: options.after,
      first: Math.min(options.first ?? 20, 100),
      type: options.type && options.type !== "all" ? options.type : undefined,
    });

    return {
      videos: response.data.map(mapVideoInfo),
      cursor: response.pagination?.cursor,
    };
  }
}

export const twitchApiService = new TwitchApiService();
