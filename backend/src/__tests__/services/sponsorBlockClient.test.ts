import { createHash } from "node:crypto";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveProxiedAxiosConfigForUrl } from "../../services/downloaders/bilibili/bilibiliConfig";
import {
  fetchSponsorSegments,
  normalizeSponsorSegments,
  sponsorBlockHashPrefix,
  SponsorBlockUnavailableError,
} from "../../services/sponsorBlock/client";

vi.mock("axios", () => ({ default: { get: vi.fn(), isAxiosError: vi.fn() } }));
vi.mock("../../services/downloaders/bilibili/bilibiliConfig", () => ({
  resolveProxiedAxiosConfigForUrl: vi.fn(),
}));

const ID = "dQw4w9WgXcQ";
const segment = (overrides: Record<string, unknown> = {}) => ({
  segment: [10, 20],
  UUID: "uuid-1",
  category: "sponsor",
  actionType: "skip",
  videoDuration: 212.1,
  locked: 1,
  votes: 3,
  description: "",
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(resolveProxiedAxiosConfigForUrl).mockReturnValue({ proxy: false });
});

describe("sponsorBlockHashPrefix", () => {
  it("is the first four hex digits of the sha256 of the raw video id", () => {
    const expected = createHash("sha256").update(ID).digest("hex").slice(0, 4);
    expect(sponsorBlockHashPrefix(ID)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{4}$/);
  });
});

describe("fetchSponsorSegments", () => {
  it("asks only for the hash prefix and picks this video out of the matches", async () => {
    vi.mocked(axios.get).mockResolvedValue({
      status: 200,
      data: [
        { videoID: "otherVideo1", segments: [segment({ UUID: "other" })] },
        { videoID: ID, segments: [segment()] },
      ],
    });

    const segments = await fetchSponsorSegments(ID);

    expect(segments).toEqual([
      { uuid: "uuid-1", category: "sponsor", actionType: "skip", start: 10, end: 20, videoDuration: 212.1 },
    ]);
    const [url, config] = vi.mocked(axios.get).mock.calls[0];
    expect(url).toBe(`https://sponsor.ajay.app/api/skipSegments/${sponsorBlockHashPrefix(ID)}`);
    expect(url).not.toContain(ID);
    expect(config).toMatchObject({ proxy: false, maxRedirects: 0, timeout: 8000, maxContentLength: 2 * 1024 * 1024 });
    expect(JSON.parse((config as any).params.categories)).toContain("music_offtopic");
    expect(resolveProxiedAxiosConfigForUrl).toHaveBeenCalledWith(`https://www.youtube.com/watch?v=${ID}`);
  });

  it("treats a 404 and a prefix without this video as no segments", async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ status: 404, data: [] });
    expect(await fetchSponsorSegments(ID)).toEqual([]);
    vi.mocked(axios.get).mockResolvedValueOnce({ status: 200, data: [{ videoID: "otherVideo1", segments: [segment()] }] });
    expect(await fetchSponsorSegments(ID)).toEqual([]);
  });

  it("sends nothing when the configured proxy is unusable", async () => {
    vi.mocked(resolveProxiedAxiosConfigForUrl).mockReturnValue(null);
    await expect(fetchSponsorSegments(ID)).rejects.toMatchObject({ kind: "proxy" });
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("reports 429 apart from other failures", async () => {
    vi.mocked(axios.isAxiosError).mockReturnValue(true);
    vi.mocked(axios.get).mockRejectedValueOnce({ response: { status: 429 } });
    await expect(fetchSponsorSegments(ID)).rejects.toMatchObject({ kind: "rateLimited" });
    vi.mocked(axios.get).mockRejectedValueOnce({ response: { status: 503 } });
    await expect(fetchSponsorSegments(ID)).rejects.toMatchObject({ kind: "upstream" });
  });

  it("rejects a body that is not a list", async () => {
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: "<html>maintenance</html>" });
    await expect(fetchSponsorSegments(ID)).rejects.toBeInstanceOf(SponsorBlockUnavailableError);
  });
});

describe("normalizeSponsorSegments", () => {
  it("drops malformed and unknown segments and keeps the rest in time order", () => {
    const result = normalizeSponsorSegments([
      segment({ UUID: "late", segment: [50, 60] }),
      segment({ UUID: "early", segment: [1, 2], videoDuration: "212" }),
      segment({ UUID: "nan", segment: [Number.NaN, 2] }),
      segment({ UUID: "backwards", segment: [9, 3] }),
      segment({ UUID: "negative", segment: [-1, 3] }),
      segment({ UUID: "chapter", category: "chapter", actionType: "chapter" }),
      segment({ UUID: "unknown-action", actionType: "explode" }),
      segment({ UUID: "x".repeat(129) }),
      segment({ UUID: "" }),
      "not a segment",
      null,
    ]);
    expect(result.map((item) => item.uuid)).toEqual(["early", "late"]);
    expect(result[0].videoDuration).toBe(0);
  });

  it("keeps point and full-video labels for later phases", () => {
    const result = normalizeSponsorSegments([
      segment({ UUID: "poi", category: "poi_highlight", actionType: "poi", segment: [9.7, 9.7] }),
      segment({ UUID: "full", category: "exclusive_access", actionType: "full", segment: [0, 0] }),
    ]);
    expect(result.map((item) => item.actionType)).toEqual(["full", "poi"]);
  });

  it("caps the number of segments", () => {
    const many = Array.from({ length: 250 }, (_, index) => segment({ UUID: `u${index}`, segment: [index, index + 1] }));
    expect(normalizeSponsorSegments(many)).toHaveLength(200);
  });
});
