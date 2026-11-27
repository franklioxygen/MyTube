import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as storageService from "../../services/storageService";
import {
  fetchSponsorSegments,
  SponsorBlockUnavailableError,
  type SponsorSegment,
} from "../../services/sponsorBlock/client";
import {
  getSponsorBlockSegments,
  resetSponsorBlockCacheForTests,
  youtubeIdForVideo,
} from "../../services/sponsorBlock/service";

vi.mock("../../services/storageService", () => ({ getSettings: vi.fn() }));
vi.mock("../../services/sponsorBlock/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/sponsorBlock/client")>()),
  fetchSponsorSegments: vi.fn(),
}));

const HOUR = 60 * 60 * 1000;
const youtube = (id = "dQw4w9WgXcQ") => ({ source: "youtube", sourceVideoId: id });
const sponsor: SponsorSegment = {
  uuid: "u1", category: "sponsor", actionType: "skip", start: 10, end: 20, videoDuration: 100,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T00:00:00Z"));
  resetSponsorBlockCacheForTests();
  vi.mocked(storageService.getSettings).mockReturnValue({ sponsorBlockEnabled: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("youtubeIdForVideo", () => {
  it("uses the stored id of a YouTube video only", () => {
    expect(youtubeIdForVideo(youtube())).toBe("dQw4w9WgXcQ");
    expect(youtubeIdForVideo({ source: "bilibili", sourceVideoId: "dQw4w9WgXcQ" })).toBeNull();
    expect(youtubeIdForVideo({ source: "youtube", sourceVideoId: null })).toBeNull();
    expect(youtubeIdForVideo({ source: "youtube", sourceVideoId: "../../etc/pass" })).toBeNull();
  });
});

describe("getSponsorBlockSegments", () => {
  it("does not reach upstream while the feature is off or the video is not YouTube", async () => {
    vi.mocked(storageService.getSettings).mockReturnValue({ sponsorBlockEnabled: false });
    expect(await getSponsorBlockSegments(youtube())).toEqual({ status: "disabled", segments: [] });
    vi.mocked(storageService.getSettings).mockReturnValue({ sponsorBlockEnabled: true });
    expect(await getSponsorBlockSegments({ source: "twitch", sourceVideoId: "123" })).toEqual({ status: "unsupported", segments: [] });
    expect(fetchSponsorSegments).not.toHaveBeenCalled();
  });

  it("serves a fresh answer from memory", async () => {
    vi.mocked(fetchSponsorSegments).mockResolvedValue([sponsor]);
    expect(await getSponsorBlockSegments(youtube())).toEqual({ status: "ready", segments: [sponsor] });
    vi.setSystemTime(Date.now() + 23 * HOUR);
    expect(await getSponsorBlockSegments(youtube())).toEqual({ status: "ready", segments: [sponsor] });
    expect(fetchSponsorSegments).toHaveBeenCalledTimes(1);
  });

  it("rechecks an empty answer after an hour and a non-empty one after a day", async () => {
    vi.mocked(fetchSponsorSegments).mockResolvedValueOnce([]).mockResolvedValueOnce([sponsor]);
    expect((await getSponsorBlockSegments(youtube())).status).toBe("none");
    vi.setSystemTime(Date.now() + HOUR + 1);
    expect((await getSponsorBlockSegments(youtube())).status).toBe("ready");
    vi.setSystemTime(Date.now() + 2 * HOUR);
    await getSponsorBlockSegments(youtube());
    expect(fetchSponsorSegments).toHaveBeenCalledTimes(2);
  });

  it("keeps an expired answer when the refresh fails, and backs off", async () => {
    vi.mocked(fetchSponsorSegments)
      .mockResolvedValueOnce([sponsor])
      .mockRejectedValueOnce(new SponsorBlockUnavailableError("upstream"));
    await getSponsorBlockSegments(youtube());
    vi.setSystemTime(Date.now() + 25 * HOUR);
    expect(await getSponsorBlockSegments(youtube())).toEqual({ status: "ready", segments: [sponsor] });
    // Backing off: another video is not looked up for a minute.
    expect((await getSponsorBlockSegments(youtube("aaaaaaaaaaa"))).status).toBe("unavailable");
    expect(fetchSponsorSegments).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 61 * 1000);
    vi.mocked(fetchSponsorSegments).mockResolvedValueOnce([]);
    expect((await getSponsorBlockSegments(youtube("aaaaaaaaaaa"))).status).toBe("none");
  });

  it("backs off for five minutes after a 429", async () => {
    vi.mocked(fetchSponsorSegments).mockRejectedValueOnce(new SponsorBlockUnavailableError("rateLimited"));
    expect((await getSponsorBlockSegments(youtube())).status).toBe("unavailable");
    vi.setSystemTime(Date.now() + 4 * 60 * 1000);
    expect((await getSponsorBlockSegments(youtube())).status).toBe("unavailable");
    expect(fetchSponsorSegments).toHaveBeenCalledTimes(1);
  });

  it("keeps a 429's longer backoff when another lookup then fails with a 503", async () => {
    let failSecond!: (error: Error) => void;
    vi.mocked(fetchSponsorSegments)
      .mockRejectedValueOnce(new SponsorBlockUnavailableError("rateLimited"))
      .mockReturnValueOnce(new Promise((_, reject) => { failSecond = reject; }));
    const first = getSponsorBlockSegments(youtube("aaaaaaaaaa1"));
    const second = getSponsorBlockSegments(youtube("aaaaaaaaaa2"));
    await first;
    failSecond(new SponsorBlockUnavailableError("upstream"));
    await second;
    vi.setSystemTime(Date.now() + 2 * 60 * 1000);
    expect((await getSponsorBlockSegments(youtube("aaaaaaaaaa3"))).status).toBe("unavailable");
    expect(fetchSponsorSegments).toHaveBeenCalledTimes(2);
  });

  it("does not back off when a broken proxy meant nothing was sent", async () => {
    vi.mocked(fetchSponsorSegments)
      .mockRejectedValueOnce(new SponsorBlockUnavailableError("proxy"))
      .mockResolvedValueOnce([]);
    expect((await getSponsorBlockSegments(youtube())).status).toBe("unavailable");
    expect((await getSponsorBlockSegments(youtube())).status).toBe("none");
  });

  it("shares one upstream request between concurrent readers of a video", async () => {
    let resolve!: (segments: SponsorSegment[]) => void;
    vi.mocked(fetchSponsorSegments).mockReturnValue(new Promise((done) => { resolve = done; }));
    const first = getSponsorBlockSegments(youtube());
    const second = getSponsorBlockSegments(youtube());
    resolve([sponsor]);
    expect(await first).toEqual(await second);
    expect(fetchSponsorSegments).toHaveBeenCalledTimes(1);
  });

  it("caps how many different videos are looked up at once", async () => {
    vi.mocked(fetchSponsorSegments).mockReturnValue(new Promise(() => undefined));
    const ids = ["aaaaaaaaaa1", "aaaaaaaaaa2", "aaaaaaaaaa3", "aaaaaaaaaa4"];
    ids.forEach((id) => void getSponsorBlockSegments(youtube(id)));
    expect((await getSponsorBlockSegments(youtube("aaaaaaaaaa5"))).status).toBe("unavailable");
    expect(fetchSponsorSegments).toHaveBeenCalledTimes(4);
  });

  it("forgets the least recently used video past the cache limit", async () => {
    vi.mocked(fetchSponsorSegments).mockResolvedValue([]);
    const id = (n: number) => `v${String(n).padStart(10, "0")}`;
    for (let n = 0; n <= 500; n += 1) {
      await getSponsorBlockSegments(youtube(id(n)));
      // Reading video 0 again keeps it the most recently used.
      if (n === 250) await getSponsorBlockSegments(youtube(id(0)));
    }
    vi.mocked(fetchSponsorSegments).mockClear();
    await getSponsorBlockSegments(youtube(id(0)));
    expect(fetchSponsorSegments).not.toHaveBeenCalled();
    await getSponsorBlockSegments(youtube(id(1)));
    expect(fetchSponsorSegments).toHaveBeenCalledTimes(1);
  });
});
