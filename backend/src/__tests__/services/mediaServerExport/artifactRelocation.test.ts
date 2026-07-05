import { beforeEach, describe, expect, it, vi } from "vitest";

const getSettingsMock = vi.fn();
const getVideoByIdMock = vi.fn();
const removeMediaServerArtifactsForVideoMock = vi.fn();
const syncMediaServerArtifactsForRecordMock = vi.fn();
const syncMediaServerShowArtifactsForShowRootMock = vi.fn();

vi.mock("../../../services/storageService/settings", () => ({
  getSettings: () => getSettingsMock(),
}));

vi.mock("../../../services/storageService/videos", () => ({
  getVideoById: (id: string) => getVideoByIdMock(id),
}));

vi.mock("../../../services/mediaServerExport/syncService", () => ({
  removeMediaServerArtifactsForVideo: (...args: unknown[]) =>
    removeMediaServerArtifactsForVideoMock(...args),
  syncMediaServerArtifactsForRecord: (...args: unknown[]) =>
    syncMediaServerArtifactsForRecordMock(...args),
  syncMediaServerShowArtifactsForShowRoot: (...args: unknown[]) =>
    syncMediaServerShowArtifactsForShowRootMock(...args),
}));

import { relocateMediaServerArtifactsAroundMove } from "../../../services/mediaServerExport/artifactRelocation";

describe("mediaServerExport/artifactRelocation", () => {
  beforeEach(() => {
    getSettingsMock.mockReset();
    getVideoByIdMock.mockReset();
    removeMediaServerArtifactsForVideoMock.mockReset();
    syncMediaServerArtifactsForRecordMock.mockReset();
    syncMediaServerShowArtifactsForShowRootMock.mockReset();
  });

  it("runs the move without artifact I/O when export is off", () => {
    getSettingsMock.mockReturnValue({ mediaServerExportMode: "off" });
    const performMove = vi.fn().mockReturnValue(true);

    const moved = relocateMediaServerArtifactsAroundMove(
      {
        id: "v1",
        title: "Episode",
        videoPath: "/videos/Old/Season 1/s01e01 - Episode.mp4",
      } as any,
      performMove
    );

    expect(moved).toBe(true);
    expect(performMove).toHaveBeenCalledTimes(1);
    expect(removeMediaServerArtifactsForVideoMock).not.toHaveBeenCalled();
    expect(syncMediaServerArtifactsForRecordMock).not.toHaveBeenCalled();
  });

  it("does not touch artifacts when the move produced no path update", () => {
    getSettingsMock.mockReturnValue({ mediaServerExportMode: "nfo" });

    const moved = relocateMediaServerArtifactsAroundMove(
      {
        id: "v1",
        title: "Episode",
        videoPath: "/videos/Old/Season 1/s01e01 - Episode.mp4",
      } as any,
      vi.fn().mockReturnValue(false)
    );

    expect(moved).toBe(false);
    expect(removeMediaServerArtifactsForVideoMock).not.toHaveBeenCalled();
    expect(syncMediaServerArtifactsForRecordMock).not.toHaveBeenCalled();
  });

  it("removes old artifacts and syncs the updated record after a move", () => {
    getSettingsMock.mockReturnValue({ mediaServerExportMode: "nfo" });
    const videoBefore = {
      id: "v1",
      title: "Episode",
      videoPath: "/videos/Old/Season 1/s01e01 - Episode.mp4",
    } as any;
    const videoAfter = {
      ...videoBefore,
      videoPath: "/videos/New/Season 1/s01e01 - Episode.mp4",
    };
    getVideoByIdMock.mockReturnValue(videoAfter);

    const moved = relocateMediaServerArtifactsAroundMove(
      videoBefore,
      vi.fn().mockReturnValue(true)
    );

    expect(moved).toBe(true);
    expect(removeMediaServerArtifactsForVideoMock).toHaveBeenCalledWith(
      videoBefore
    );
    expect(syncMediaServerShowArtifactsForShowRootMock).toHaveBeenCalledWith(
      "Old",
      { modeOverride: "nfo" }
    );
    expect(syncMediaServerArtifactsForRecordMock).toHaveBeenCalledWith(
      videoAfter,
      { modeOverride: "nfo" }
    );
  });
});
