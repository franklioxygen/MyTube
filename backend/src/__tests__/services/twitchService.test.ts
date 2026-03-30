import { beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { ValidationError } from "../../errors/DownloadErrors";
import * as storageService from "../../services/storageService";
import { TwitchApiService } from "../../services/twitchService";

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    isAxiosError: vi.fn((error: any) => Boolean(error?.isAxiosError)),
  },
}));

vi.mock("../../services/storageService", () => ({
  getSettings: vi.fn(),
}));

describe("TwitchApiService", () => {
  let service: TwitchApiService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TwitchApiService();

    vi.mocked(storageService.getSettings).mockReturnValue({
      twitchClientId: "client-id",
      twitchClientSecret: "client-secret",
    } as any);
  });

  it("throws a validation error when Twitch credentials are missing", () => {
    vi.mocked(storageService.getSettings).mockReturnValue({} as any);

    expect(() => service.ensureConfigured()).toThrow(ValidationError);
  });

  it("caches the app token across Helix requests until refresh is needed", async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: { access_token: "token-1", expires_in: 3600 },
    } as any);
    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              id: "1",
              login: "streamer",
              display_name: "Streamer",
              description: "",
              profile_image_url: null,
              offline_image_url: null,
            },
          ],
        },
      } as any)
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              id: "2",
              login: "otherstreamer",
              display_name: "Other Streamer",
              description: "",
              profile_image_url: null,
              offline_image_url: null,
            },
          ],
        },
      } as any);

    const first = await service.getChannelByLogin("streamer");
    const second = await service.getChannelById("2");

    expect(first).toMatchObject({
      id: "1",
      login: "streamer",
      url: "https://www.twitch.tv/streamer",
    });
    expect(second).toMatchObject({
      id: "2",
      login: "otherstreamer",
      url: "https://www.twitch.tv/otherstreamer",
    });
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(vi.mocked(axios.get).mock.calls[0]?.[1]).toMatchObject({
      headers: {
        "Client-Id": "client-id",
        Authorization: "Bearer token-1",
      },
      timeout: 15000,
    });
  });

  it("clears the cached token and retries once on a 401 response", async () => {
    vi.mocked(axios.post)
      .mockResolvedValueOnce({
        data: { access_token: "expired-token", expires_in: 3600 },
      } as any)
      .mockResolvedValueOnce({
        data: { access_token: "fresh-token", expires_in: 3600 },
      } as any);

    vi.mocked(axios.get)
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 401 },
      } as any)
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              id: "77",
              login: "retryme",
              display_name: "Retry Me",
              description: "",
              profile_image_url: "https://example.com/avatar.jpg",
              offline_image_url: null,
            },
          ],
        },
      } as any);

    const channel = await service.getChannelByLogin("retryme");

    expect(channel).toMatchObject({
      id: "77",
      login: "retryme",
      profileImageUrl: "https://example.com/avatar.jpg",
    });
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(vi.mocked(axios.get).mock.calls[1]?.[1]).toMatchObject({
      headers: {
        Authorization: "Bearer fresh-token",
      },
    });
  });

  it("records a 429 block and skips later requests until reset", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-30T12:00:00Z"));

    vi.mocked(axios.post).mockResolvedValue({
      data: { access_token: "token-1", expires_in: 3600 },
    } as any);
    vi.mocked(axios.get).mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 429,
        headers: {
          "ratelimit-reset": `${Math.floor(Date.now() / 1000) + 120}`,
        },
      },
    } as any);

    await expect(service.getChannelByLogin("ratelimited")).rejects.toMatchObject({
      response: { status: 429 },
    });
    await expect(service.getChannelById("123")).rejects.toThrow(
      "Twitch API is temporarily rate limited until 2026-03-30T12:02:00.000Z."
    );

    expect(axios.get).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("maps paginated broadcaster videos and omits the Helix type filter for type=all", async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: { access_token: "token-1", expires_in: 3600 },
    } as any);
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: [
          {
            id: "vod-1",
            user_id: "42",
            user_login: "streamer",
            user_name: "Streamer",
            title: "Archive",
            description: "desc",
            url: "https://www.twitch.tv/videos/100",
            thumbnail_url: "https://example.com/thumb.jpg",
            created_at: "2026-03-01T01:00:00Z",
            published_at: "2026-03-01T02:00:00Z",
            view_count: 321,
            duration: "3h1m",
            type: "archive",
          },
        ],
        pagination: { cursor: "next-cursor" },
      },
    } as any);

    const result = await service.listVideosByBroadcaster(" 42 ", {
      after: "cursor-1",
      first: 250,
      type: "all",
    });

    expect(result).toEqual({
      videos: [
        {
          id: "vod-1",
          userId: "42",
          userLogin: "streamer",
          userName: "Streamer",
          title: "Archive",
          description: "desc",
          url: "https://www.twitch.tv/videos/100",
          thumbnailUrl: "https://example.com/thumb.jpg",
          createdAt: "2026-03-01T01:00:00Z",
          publishedAt: "2026-03-01T02:00:00Z",
          viewCount: 321,
          duration: "3h1m",
          type: "archive",
        },
      ],
      cursor: "next-cursor",
    });
    expect(vi.mocked(axios.get).mock.calls[0]?.[1]).toMatchObject({
      params: {
        user_id: "42",
        after: "cursor-1",
        first: 100,
        type: undefined,
      },
      timeout: 15000,
    });
  });

  it("invalidates cached token state when Twitch credentials change", async () => {
    vi.mocked(axios.post)
      .mockResolvedValueOnce({
        data: { access_token: "token-1", expires_in: 3600 },
      } as any)
      .mockResolvedValueOnce({
        data: { access_token: "token-2", expires_in: 3600 },
      } as any);
    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              id: "1",
              login: "streamer",
              display_name: "Streamer",
              description: "",
              profile_image_url: null,
              offline_image_url: null,
            },
          ],
        },
      } as any)
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              id: "2",
              login: "otherstreamer",
              display_name: "Other Streamer",
              description: "",
              profile_image_url: null,
              offline_image_url: null,
            },
          ],
        },
      } as any);

    await service.getChannelByLogin("streamer");

    vi.mocked(storageService.getSettings).mockReturnValue({
      twitchClientId: "new-client-id",
      twitchClientSecret: "new-client-secret",
    } as any);

    await service.getChannelById("2");

    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(vi.mocked(axios.get).mock.calls[1]?.[1]).toMatchObject({
      headers: {
        "Client-Id": "new-client-id",
        Authorization: "Bearer token-2",
      },
    });
  });
});
